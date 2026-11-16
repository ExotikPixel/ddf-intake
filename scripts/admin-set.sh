#!/usr/bin/env bash
# Usage: npm run admin:set -- you@ddfpixel.com
set -euo pipefail
cd "$(dirname "$0")/.."
email="${1:?usage: npm run admin:set -- <email>}"
source .env
export DATABASE_URL="${DATABASE_URL:-postgres://ddf:${POSTGRES_PASSWORD}@127.0.0.1:5433/ddf}"
read -rsp "New password for ${email} (12+ chars): " pw; echo
read -rsp "Repeat: " pw2; echo
[[ "$pw" == "$pw2" ]] || { echo "❌ passwords differ"; exit 1; }
printf '%s' "$pw" | npx tsx scripts/admin-user.ts set "$email"
