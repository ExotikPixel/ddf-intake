#!/usr/bin/env bash
# DDF ops loop — runs inside the `ops` container while Docker is up.
# Every job is age-based, so it catches up after a reboot or outage.
set -uo pipefail

DATA="${DATA_DIR:-/ddf-data}"
STATE="$DATA/ops-state"
BACK="$DATA/backups"
FILES="$DATA/files"
BUCKET="${R2_BACKUP_BUCKET:-ddf-backups}"
# Off-site target: R2 by default; OFFSITE_REMOTE (e.g. gdrive:DDF-Backups) with
# $DATA/rclone.conf for any other rclone backend (no-card alternative, spec D17).
REMOTE="${OFFSITE_REMOTE:-r2:$BUCKET}"
mkdir -p "$STATE" "$BACK"
if [[ -f "$DATA/rclone.conf" ]]; then export RCLONE_CONFIG="$DATA/rclone.conf"; fi
offsite_configured() { [[ -n "${OFFSITE_REMOTE:-}" ]] || [[ -n "${R2_ACCOUNT_ID:-}" && -n "${R2_ACCESS_KEY_ID:-}" ]]; }

# rclone remote "r2:" built from env vars (no config file on disk).
export RCLONE_CONFIG_R2_TYPE=s3
export RCLONE_CONFIG_R2_PROVIDER=Cloudflare
export RCLONE_CONFIG_R2_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID:-}"
export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY:-}"
export RCLONE_CONFIG_R2_ENDPOINT="https://${R2_ACCOUNT_ID:-unset}.r2.cloudflarestorage.com"
export RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true

now()  { date +%s; }
age()  { if [[ -f "$STATE/$1" ]]; then echo $(( $(now) - $(cat "$STATE/$1") )); else echo 999999999; fi; }
mark() { now > "$STATE/$1"; }
log()  { echo "[ops $(date -u +%FT%TZ)] $*"; }

# ntfy <priority> <title> <message> [throttle-key: at most one alert per 6 h]
ntfy() {
  [[ -z "${NTFY_TOPIC_URL:-}" ]] && return 0
  local key="${4:-}"
  if [[ -n "$key" ]] && (( $(age "alert-$key") < 21600 )); then return 0; fi
  curl -fsS -m 15 -H "Title: $2" -H "Priority: $1" -d "$3" "$NTFY_TOPIC_URL" >/dev/null || true
  if [[ -n "$key" ]]; then mark "alert-$key"; fi
  return 0
}

check_health() {
  if curl -fsS -m 10 "$APP_URL/api/health" >/dev/null; then
    mark health
  else
    log "health check failed"
    ntfy 5 "DDF intake is DOWN" "Health check failed at $(date). Check Docker on the shop PC." health
  fi
}

do_dump() {
  local f
  f="$BACK/db-$(date -u +%Y-%m-%d-%H%M).sql.gz"
  if timeout 30m pg_dump --no-owner --no-privileges | gzip > "$f.tmp" && mv "$f.tmp" "$f"; then
    ls -1t "$BACK"/db-*.sql.gz 2>/dev/null | tail -n +15 | xargs -r rm -f   # keep newest 14
    mark dump; log "dump ok: $(basename "$f")"
  else
    rm -f "$f.tmp"; log "dump FAILED"
    ntfy 5 "DDF backup FAILED" "pg_dump failed at $(date)." dump
  fi
}

do_offsite() {
  if ! offsite_configured; then
    log "off-site skipped (not configured)"; mark offsite; return
  fi
  if timeout 3h rclone copy "$BACK" "$REMOTE/db" --include 'db-*.sql.gz' --max-age 25h \
     && timeout 3h rclone copy "$FILES" "$REMOTE/files" --ignore-existing; then
    mark offsite; log "off-site ok"
  else
    log "off-site FAILED (error or 3 h timeout)"
    ntfy 5 "DDF off-site backup FAILED" "rclone to $REMOTE failed or timed out at $(date)." offsite
  fi
}

do_kanban() {
  if curl -fsS -m 300 -H "Authorization: Bearer ${CRON_SECRET:-}" "$APP_URL/api/cron/kanban-retry" >/dev/null; then
    mark kanban
  else
    log "kanban retry call failed"
    ntfy 4 "Kanban retry run failed" "The 6-hourly Kanban retry call failed at $(date)." kanban
  fi
}

free_gb() { df -Pk "$DATA" | awk 'NR==2 { printf "%.0f", $4 / 1048576 }'; }
check_disk() {
  local f; f=$(free_gb)
  if (( f < 20 )); then
    log "low disk: ${f} GB free"
    ntfy 4 "DDF disk space low" "Only ${f} GB free on the shop PC at $(date)." disk
  fi
}

gb() { awk -v b="$1" 'BEGIN { printf "%.2f", b / 1073741824 }'; }

do_digest() {
  local db_mb files_bytes files_n r2_bytes free_gb warn="" pri=3
  db_mb=$(psql -Atc "select round(pg_database_size(current_database()) / 1048576.0)" 2>/dev/null || echo "?")
  files_bytes=$(du -sb "$FILES" 2>/dev/null | cut -f1); files_bytes=${files_bytes:-0}
  files_n=$(find "$FILES" -type f 2>/dev/null | wc -l | tr -d ' ')
  r2_bytes=0
  if offsite_configured; then
    r2_bytes=$(rclone size "$REMOTE" --json 2>/dev/null | sed -nE 's/.*"bytes":([0-9]+).*/\1/p'); r2_bytes=${r2_bytes:-0}
  fi
  free_gb=$(free_gb)
  if (( r2_bytes > 8 * 1073741824 )); then pri=4; warn+=" ⚠️ Off-site copy is over 8 GB (free tier is 10 GB)."; fi
  if (( free_gb < 20 )); then pri=4; warn+=" ⚠️ Less than 20 GB disk free."; fi
  ntfy "$pri" "DDF weekly report" "DB ${db_mb} MB · files $(gb "$files_bytes") GB (${files_n}) · off-site $(gb "$r2_bytes") GB · disk free ${free_gb} GB.${warn}"
  mark digest; log "digest sent"
}

log "ops loop starting"
sleep 60   # let the app finish starting
while true; do
  check_health
  check_disk
  if (( $(age dump)    > 72000  )); then do_dump;    fi   # 20 h
  if (( $(age offsite) > 72000  )); then do_offsite; fi   # 20 h
  if (( $(age kanban)  > 21600  )); then do_kanban;  fi   # 6 h
  if (( $(age digest)  > 604800 )); then do_digest;  fi   # 7 days
  sleep 600
done
