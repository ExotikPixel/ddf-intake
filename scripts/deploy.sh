#!/usr/bin/env bash
# Deploy on the host (shop PC, WSL2): pull, apply schema, rebuild, restart, verify.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a

mkdir -p "$DDF_DATA_DIR"/files "$DDF_DATA_DIR"/backups "$DDF_DATA_DIR"/ops-state
git pull --ff-only

docker compose up -d db
docker compose exec -T db sh -c 'until pg_isready -U ddf -d ddf; do sleep 1; done'
docker compose exec -T db psql -U ddf -d ddf -v ON_ERROR_STOP=1 -q < db/schema.sql

docker compose build app ops
profiles=()
if [[ -n "${TUNNEL_TOKEN:-}" ]]; then profiles=(--profile public); fi
docker compose ${profiles[@]+"${profiles[@]}"} up -d

for _ in $(seq 1 45); do
  if curl -fsS http://127.0.0.1:3000/api/health >/dev/null; then echo "✅ healthy"; exit 0; fi
  sleep 2
done
echo "❌ app not healthy after 90s"
docker compose logs --tail 80 app
exit 1
