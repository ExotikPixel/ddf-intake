#!/usr/bin/env bash
# One time: copy ~/DDF-Data (files, backups, ops-state) into the Docker volumes the stack now uses, and prove every file
# arrived byte for byte. The folder is never changed or deleted. deploy.sh runs this; once done it does nothing.
set -euo pipefail
cd "$(dirname "$0")/.."
src=${DDF_DATA_DIR:-$HOME/DDF-Data}
inops() { docker compose run --rm --no-deps -T --entrypoint bash "$@"; }
if inops ops -c '[[ -f /ddf-data/.moved ]]'; then exit 0; fi
# An existing app that still uses a folder means there IS data to move: never start empty by mistake.
linked=""; for c in $(docker compose ps -aq app); do linked+=$(docker inspect -f '{{range .Mounts}}{{if eq .Type "bind"}}{{.Source}} {{end}}{{end}}' "$c"); done
if [[ -n $linked && ! -d $src/files ]]; then echo "❌ the running app uses a folder, but $src/files does not exist. Set DDF_DATA_DIR and retry. Nothing changed."; exit 1; fi
if [[ ! -d $src/files ]]; then echo "no old data folder at $src: starting with empty volumes"; inops ops -c 'touch /ddf-data/.moved; mkdir -p /ddf-data/files; chown 1000:1000 /ddf-data/files'; exit 0; fi
echo "moving data from $src into Docker volumes (the app is stopped for a moment)"
docker compose stop app ops
old=$(docker compose ps -aq app ops)
back() { echo "❌ the copy did not match: nothing was switched over, starting the old containers again"; docker start $old >/dev/null; exit 1; }
inops -v "$src:/src:ro" ops -c '
  set -euo pipefail
  [[ -d /src/files ]] || { echo "the folder link is empty"; exit 1; }
  cp -a /src/. /ddf-data/
  mkdir -p /ddf-data/files; chown -R 1000:1000 /ddf-data/files      # the app runs as uid 1000
  list() { ( cd "$1" && find . -type f ! -name .moved -print0 | sort -z | xargs -0 -r sha256sum ); }
  diff <(list /src) <(list /ddf-data) && echo "✅ all $(list /src | wc -l) files match" && touch /ddf-data/.moved' || back
