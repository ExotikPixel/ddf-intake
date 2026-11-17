#!/usr/bin/env bash
# Phase 2: load the exported Supabase dump into a scratch database `legacy`
# (same Postgres container as the live `ddf` database, which it never touches).
# Re-runnable: drops and recreates `legacy` each time.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${LEGACY_DIR:-$HOME/DDF-Data/legacy-supabase}"
DUMP="$OUT/db.sql"
LOG="$OUT/restore-errors.log"
[ -s "$DUMP" ] || { echo "❌ $DUMP not found — run ./scripts/export-supabase.sh first"; exit 1; }
pg() { docker compose exec -T db psql -U ddf -v ON_ERROR_STOP=1 "$@"; }

echo "→ Loading the old database into a scratch copy…"
pg -d postgres -q -c "set client_min_messages = warning" -c "drop database if exists legacy" -c "create database legacy"
# Stand-ins for the Supabase schemas the public tables may point at (column
# defaults like extensions.uuid_generate_v4(), foreign keys to auth.users).
# Without them a whole table can fail to load.
pg -d legacy -q <<'SQL'
create schema extensions;
create extension pgcrypto with schema extensions;
create extension "uuid-ossp" with schema extensions;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as 'select null::uuid';
create function auth.role() returns text language sql stable as 'select null::text';
create function auth.jwt() returns jsonb language sql stable as 'select null::jsonb';
SQL
# No ON_ERROR_STOP here: Supabase-only parts (auth, storage, roles, policies)
# fail to load and that's expected. Real problems are listed below.
docker compose exec -T db psql -U ddf -d legacy -q < "$DUMP" > /dev/null 2> "$LOG" || true

unexpected=$(grep -E 'ERROR' "$LOG" \
  | grep -viE 'auth\.|storage\.|"?auth"?|role |policy|polic|tenant_members|already exists|extension|supabase|pgsodium|vault|graphql|realtime|pg_net|cron|must be owner|publication|event trigger' || true)
if [ -n "$unexpected" ]; then
  echo "⚠️  Some unexpected load errors (full log: $LOG):"
  echo "$unexpected" | head -20
fi

echo "→ What's in the old database:"
for t in jobs design_library tenants tenant_settings; do
  n=$(docker compose exec -T db psql -U ddf -d legacy -Atc "select count(*) from public.$t" 2>/dev/null || echo "not found")
  printf '   %-15s %s\n' "$t" "$n"
done
jobs=$(docker compose exec -T db psql -U ddf -d legacy -Atc "select count(*) from public.jobs" 2>/dev/null || echo 0)
[ "$jobs" -gt 0 ] 2>/dev/null || { echo "❌ No old jobs loaded — send $LOG to Claude."; exit 1; }
echo "✅ Old database ready ($jobs jobs)."
