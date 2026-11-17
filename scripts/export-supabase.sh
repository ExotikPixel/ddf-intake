#!/usr/bin/env bash
# Phase 2, step 1: export the old Supabase database (public schema) and the
# job-files bucket to ~/DDF-Data/legacy-supabase. Safe to re-run: files resume.
# Needs ~/DDF-Data/legacy-supabase/export.env (see LEGACY_IMPORT.md).
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${LEGACY_DIR:-$HOME/DDF-Data/legacy-supabase}"
ENV_FILE="$OUT/export.env"
[ -f "$ENV_FILE" ] || { echo "❌ $ENV_FILE not found — see LEGACY_IMPORT.md, step 2"; exit 1; }
chmod 600 "$ENV_FILE"
set -a; source "$ENV_FILE"; set +a
for v in SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY SUPABASE_DB_URL; do
  [ -n "${!v:-}" ] || { echo "❌ $v is empty in $ENV_FILE"; exit 1; }
done
mkdir -p "$OUT/files"

echo "→ Copying the database (a minute or two)…"
# The URL goes in via the environment so the password isn't on a command line.
docker run --rm -e PGURL="$SUPABASE_DB_URL" -v "$OUT:/out" postgres:17-alpine \
  sh -c 'pg_dump "$PGURL" --schema=public --no-owner --no-privileges -f /out/db.sql.part && mv /out/db.sql.part /out/db.sql'
echo "   database saved: $(du -h "$OUT/db.sql" | cut -f1)"

echo "→ Copying the files (this is the long part)…"
npx tsx scripts/export-supabase-files.ts "$OUT/files"
echo "   files on disk: $(du -sh "$OUT/files" | cut -f1)"
echo "✅ Export done. Your old data is now safe on this PC in $OUT"
