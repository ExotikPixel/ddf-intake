#!/usr/bin/env bash
# Phase 2: copy the old Supabase jobs + files into the live system.
#   ./scripts/import-legacy.sh --dry-run   # check only — changes nothing
#   ./scripts/import-legacy.sh             # the real import (backs up first, then verifies)
# Needs ./scripts/export-supabase.sh to have finished. Run while the print RIP is idle.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
OUT="${LEGACY_DIR:-$HOME/DDF-Data/legacy-supabase}"
DRY=0; [ "${1:-}" = "--dry-run" ] && DRY=1
command -v rsync >/dev/null || { echo "❌ rsync is missing. Run: sudo apt-get install -y rsync"; exit 1; }
[ -d "$OUT/files" ] || { echo "❌ $OUT/files not found — run ./scripts/export-supabase.sh first"; exit 1; }

./scripts/restore-legacy.sh

if [ "$DRY" = 0 ]; then
  mkdir -p "$DDF_DATA_DIR/backups"
  backup="$DDF_DATA_DIR/backups/db-before-legacy-import-$(date +%Y%m%d-%H%M%S).sql.gz"
  echo "→ Backing up the live database first…"
  docker compose exec -T db pg_dump -U ddf -d ddf --no-owner | gzip > "$backup"
  echo "   backup: $backup ($(du -h "$backup" | cut -f1))"
fi

echo "→ Copying jobs, design library and branding…"
docker compose exec -T db psql -U ddf -d ddf -q -v ON_ERROR_STOP=1 -v dry_run="$DRY" < db/import-legacy.sql

# Files: never overwrites anything already in the live files folder.
if [ "$DRY" = 1 ]; then
  n=$(rsync -a --ignore-existing --dry-run --out-format='%n' "$OUT/files/" "$DDF_DATA_DIR/files/" | grep -vc '/$' || true)
  echo "→ Files: would copy $n"
  echo "✅ Dry run finished — nothing changed. If it looks right, run: ./scripts/import-legacy.sh"
  exit 0
fi
echo "→ Copying files…"
rsync -a --ignore-existing "$OUT/files/" "$DDF_DATA_DIR/files/"
echo "   files folder: $(du -sh "$DDF_DATA_DIR/files" | cut -f1)"

echo "→ Checking the result…"
npx tsx scripts/verify-legacy-import.ts "${PUBLIC_BASE_URL:-https://jobs.ddfpixel.com}"
