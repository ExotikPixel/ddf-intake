# Restore ddf-intake on a new machine (≈1 hour)

Works on any machine with Docker (Windows + WSL2 Ubuntu, Linux, or macOS).

1. **Get the code and secrets**
   ```bash
   git clone https://github.com/ExotikPixel/ddf-intake.git ~/ddf-intake && cd ~/ddf-intake && npm ci
   cp .env.example .env   # fill in from the password manager — REVIEW_LINK_SECRET must be the old value
   mkdir -p ~/DDF-Data/files ~/DDF-Data/backups ~/DDF-Data/ops-state
   ```
2. **Get the latest backup** (from the old machine's `~/DDF-Data`, or from R2):
   ```bash
   export RCLONE_CONFIG_R2_TYPE=s3 RCLONE_CONFIG_R2_PROVIDER=Cloudflare \
     RCLONE_CONFIG_R2_ACCESS_KEY_ID=… RCLONE_CONFIG_R2_SECRET_ACCESS_KEY=… \
     RCLONE_CONFIG_R2_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
   rclone copy r2:ddf-backups/files ~/DDF-Data/files
   rclone copy r2:ddf-backups/db ~/DDF-Data/backups
   ```
3. **Start the database and load the newest dump**
   ```bash
   docker compose up -d --wait db   # waits for first-boot init to finish (TCP healthcheck)
   latest=$(ls -1t ~/DDF-Data/backups/db-*.sql.gz | head -1)
   docker compose exec -T db psql -U ddf -d postgres -c "drop database ddf" -c "create database ddf"
   gunzip -c "$latest" | docker compose exec -T db psql -U ddf -d ddf -v ON_ERROR_STOP=1 -q
   ```
4. **Start everything:** `./scripts/deploy.sh` → `✅ healthy`.
5. **Point the tunnel here:** use the same `TUNNEL_TOKEN` (stop the old machine's `tunnel` container first), or create a new tunnel in Cloudflare Zero Trust and update `.env`.
6. **Check:** `https://jobs.ddfpixel.com/api/health`, admin login, one portal lookup.

Admin logins live in the database (`admin_users`), so they come back with the dump. Reset one with `npm run admin:set -- <email>`.
