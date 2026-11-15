# Supabase Exit — Self-Hosted at the Shop — Design Spec (v3)

**Date:** 2026-11-15 · **Repo:** ddf-intake (`jobs.ddfpixel.com`) · **Status:** Draft for owner review
**v3:** self-hosted on the always-on **Windows PC at the shop** (Docker Desktop + WSL2).
The owner's MacBook is used for coding and testing only. (v1 = cloud Neon + R2; v2 = MacBook host.)

## 1. Why

On 2026-11-15 the intake app stopped working. Supabase restricted the free project
`pbgyekhyoihietqjrfpb` for `exceed_storage_size_quota` (1 GB file cap). Every
Supabase service is blocked: DB reads (`/s/ddf` returns 404), admin login, uploads.
The old data is intact but unreachable until Supabase lifts the restriction.

Root cause: large client print files on a capped free tier, and no backups we own.

## 2. Goals and constraints

- **$0 per month.** Hard constraint from the owner.
- **Own the system:** no free-tier caps, no vendor that can lock us out.
- **Host on the always-on Windows shop PC.** Outages only during reboots, power or
  internet failures. The offline page covers those. Moving hosts later is a copy-and-start.
- **Go live first** with an empty database. Old data comes back later (Phase 2).
- No new features. Same UI, flows and Command Centre contracts.

**Non-goals:** Command Centre migration; SaaS/multi-tenant work; guaranteed 24/7 uptime.

## 3. Decisions

| # | Decision | Why |
|---|----------|-----|
| D1 | Run on **Docker Desktop (WSL2 backend) + Docker Compose** on the Windows shop PC. The repo and all data live **inside WSL2 Ubuntu** (`~/ddf-intake`, `~/DDF-Data`). Services: `db`, `app`, `tunnel`, `ops`. | One command to start or move. Fast disk I/O (Windows-folder bind mounts are slow). Docker Desktop is free for businesses under 250 staff and US$10M revenue. |
| D2 | **Cloudflare Tunnel** (free) publishes `jobs.ddfpixel.com` → `app:3000` | No open router ports, free HTTPS, no ISP/IP issues. |
| D3 | `ddfpixel.com` nameservers move **Namecheap → Cloudflare** (free plan) | Tunnel public hostnames need the zone on Cloudflare. |
| D4 | Namecheap email forwarding (`eforward*` MX) is **recreated in Cloudflare Email Routing first** | Namecheap forwarding stops when the nameservers move. Brevo SPF/DKIM records get copied too. |
| D5 | **Offline page:** a Cloudflare Worker (free) on `jobs.ddfpixel.com/*` passes requests through; if the origin is unreachable (HTTP 502/521/522/523/524/530) it serves a branded offline page | Clients see "offline, email us," not a Cloudflare error. |
| D6 | DB: **Postgres 17** container, data in a named Docker volume | Plain Postgres. The schema and plpgsql functions port as-is. |
| D7 | Files: **local disk** in WSL2, bind-mounted from `~/DDF-Data/files/`, **same keys as Supabase** (`uploads/...`) | No caps. Browsable from Windows at `\\wsl$\Ubuntu\home\<user>\DDF-Data`. No DB path rewrites on import. |
| D8 | Uploads: the browser `PUT`s to `/upload/<token>` (outside `/api`, so the proxy never buffers the body) (HMAC token with key, type, size and expiry), streamed to disk. Downloads: `/f/<token>` streams from disk. | Front-end upload code doesn't change (it already PUTs to whatever `signedUrl` it gets). Our own tokens support 30- and 90-day links (emails, Kanban). |
| D9 | **Own admin auth:** `admin_users` table, bcrypt, signed httpOnly JWT cookie (`jose`) | Supabase Auth is what blocked `/admin`. |
| D10 | **Remove the client magic-link login.** The no-login portal (ref # + email) stays. | Already built. No auth vendor. |
| D11 | Drop `tenant_members` (FK to `auth.users`). Keep `tenants` and `tenant_settings`. Admins act in the default `ddf` tenant. | Single-tenant app. |
| D12 | No RLS | Only the app connects. The old policies depend on Supabase's `auth.*`. |
| D13 | `jobs.id` and `design_library.id` identity **start at 1,000,000** | No id collisions when old data is imported with its original ids. Old review/portal links keep working. |
| D14 | `REVIEW_LINK_SECRET` = **the current signing value** (today it falls back to `SUPABASE_SERVICE_ROLE_KEY`). New `FILE_LINK_SECRET` for file tokens. | Review links already emailed keep verifying. File-link rotation is independent. |
| D15 | Data access via `postgres` (porsager), raw SQL, behind small repo modules. Type parsers: `date` → `'YYYY-MM-DD'` string, `timestamptz` → ISO string, `int8` → number. | Matches what Supabase returned, so routes and UI see the same shapes. |
| D16 | **`ops` container loop** (runs while Docker is up): health check every 10 min; DB dump if the last one is > 20 h old; off-site sync if the last one is > 20 h old; Kanban retry every 6 h; digest when the last one is > 7 days old; ntfy on failure | Age-based, so jobs catch up after a reboot or outage. Replaces Vercel cron. |
| D17 | **Off-site backup:** Cloudflare R2 bucket `ddf-backups` (free 10 GB; card on file, $0 under 10 GB). Alert at 8 GB. If the owner refuses the card: Google Drive via rclone, same script. | A laptop is a single point of failure. |
| D18 | Vercel: remove the `jobs.ddfpixel.com` domain and turn off Git auto-deploy for the `ddf-intake` project. **Don't delete it.** | Avoids a second, broken copy. Reversible. |
| D19 | Deploys: in the WSL2 shell on the shop PC, `scripts/deploy.sh` runs `git pull`, applies `db/schema.sql`, `docker compose build app`, `up -d`, then a health check | Replaces "push main → Vercel." |
| D20 | **Reboot resilience on Windows:** a dedicated Windows account with **auto sign-in** (Sysinternals Autologon), Docker Desktop "start on sign-in", BIOS "restore on AC power loss", power plan never sleeps, Windows Update active hours set to business hours (restarts happen at night) | Docker Desktop only runs after a sign-in. This brings the site back unattended. Physical-access trade-off accepted. |
| D21 | **Resource guard:** WSL2 capped at 4 GB RAM / 2 CPUs (`%UserProfile%\.wslconfig`). Image builds run after hours if the PC also drives production equipment. | The PC's role and RAM are unknown. Protects any print RIP or CNC work. |

## 4. Architecture

```
Client browser ──HTTPS──► Cloudflare (DNS + Worker "offline page")
                                │  (Cloudflare Tunnel, outbound from the Mac)
Shop PC · WSL2 · Docker Compose ┘
  ├─ tunnel  (cloudflared)          → app:3000
  ├─ app     (Next.js 16 standalone) → db:5432, /data/files (bind ~/DDF-Data/files)
  │           published on 127.0.0.1:3000 only
  ├─ db      (postgres:17-alpine)    volume ddf_pgdata
  └─ ops     (alpine: pg_dump, rclone, curl loop)
         → ~/DDF-Data/backups (local dumps, 14 kept)
         → r2:ddf-backups (db/ 30 days, files/ copy-only)
         → app:3000/api/cron/kanban-retry · ntfy
Outbound only: Brevo (email), ntfy (phone), Command Centre webhooks
```

## 5. Phase 1 — Go live on the shop PC (empty DB)

### 5.1 Owner setup (one time)
0. **Pre-flight on the shop PC:** RAM ≥ 16 GB (8 GB minimum with the D21 cap), ≥ 50 GB
   free disk, Windows 10 22H2 or 11, and note whether it runs RIP/CNC software.
1. Install **WSL2 + Ubuntu** (`wsl --install -d Ubuntu`), then **Docker Desktop** with
   WSL integration for Ubuntu and "Start when you sign in." Apply D20 and D21.
2. **Cloudflare account** (free): add `ddfpixel.com`. Cloudflare imports the
   Namecheap records. Check them, including Brevo SPF/DKIM and any `www`/site
   records. Set up **Email Routing** with the same forwards Namecheap has today
   (copy from Namecheap → Domain → Redirect Email). **Only then** switch the
   nameservers at Namecheap. Test that a mail to each forward arrives.
3. **Zero Trust → Tunnels:** create tunnel `ddf-intake`, public hostname
   `jobs.ddfpixel.com` → `http://app:3000`. Hand the tunnel token to Claude Code.
4. **R2:** enable it (card verification), create bucket `ddf-backups` and a
   read/write API token for that bucket only.
5. Vercel: remove the domain and turn off Git auto-deploy (D18).

### 5.2 Docker
- `Dockerfile`: multi-stage Node 22 build with `output: 'standalone'`. Runs as a
  non-root user. Files dir is `/data/files`.
- `docker-compose.yml`: `db` (healthcheck `pg_isready`, published on `127.0.0.1:5433`
  only, for scripts and tests),
  `app` (port 3000 published on `127.0.0.1` only, `depends_on: db healthy`,
  bind `~/DDF-Data/files:/data/files`), `tunnel` (`cloudflare/cloudflared`,
  `TUNNEL_TOKEN`), `ops` (built from `ops/Dockerfile`, bind `~/DDF-Data`).
  All `restart: unless-stopped`.
- `.env` (git-ignored) holds every secret. `.env.example` documents them.

### 5.3 Schema — `db/schema.sql` (idempotent, canonical)
Consolidated from `supabase/schema.sql`, `supabase/migrations/0001–0005` and the
root `SUPABASE_*.sql` files, minus Supabase-specific parts (`auth.*`, `storage.*`,
RLS, `is_tenant_member`). Applied automatically on first start
(`/docker-entrypoint-initdb.d`) and by `npm run db:apply`.
- `set_updated_at` plus triggers on `jobs` and `tenant_settings`.
- Tables: `tenants`, `tenant_settings`, `jobs`, `design_library`,
  `kanban_sync_queue`, `admin_users`.
- Functions `update_job_item` and `append_to_job`, copied verbatim.
- Identity `start with 1000000` (D13). Seed the `ddf` tenant and its settings.
- The **jobs column list comes from the code** (every column read or written under
  `src/`). That includes `notify_client boolean not null default false` (from the 2026-06-03 plan), which isn't
  in any repo SQL file. Phase 2 diffs against the real dump.

### 5.4 Code changes (no behaviour change)
- `src/lib/db.ts` (replaces `supabase-server.ts`): lazy `postgres()` client with
  the D15 type parsers.
- `src/lib/jobs-repo.ts`, `src/lib/library-repo.ts`: named query functions. Routes
  call these; no SQL in routes. Dynamic updates only accept whitelisted columns.
- `src/lib/file-store.ts`: `filePath(key)` with traversal guard, `writeStream`,
  `exists`, `remove`, `stat`.
- `src/lib/file-tokens.ts`: `signUploadToken`, `verifyUploadToken`,
  `signFileLink(key, ttl)` (returns `${PUBLIC_BASE_URL}/f/<token>`), `verifyFileLink`.
- Routes: `PUT /upload/[token]` (stream to disk, enforce size, write
  atomically via temp file + rename); `GET /f/[token]` (stream with Content-Type
  from extension, `Cache-Control: private, max-age=300`).
- `src/lib/auth.ts`, plus `POST /api/admin/login`, `POST /api/admin/logout`,
  `GET /api/admin/me`. `requireAdmin()` keeps its shape (`{ user, tenantId }` or
  `{ unauthorized }`). `proxy.ts` gates `/admin/*` by cookie and adds a login limit
  of 5/min/IP. `/login` is admin-only. `scripts/admin-user.ts` sets passwords.
- Portal: token-only (`portal-auth.ts`, `portal/page.tsx`). Delete `auth/callback`.
- `review-token.ts` / `portal-token.ts`: drop the Supabase fallback; require
  `REVIEW_LINK_SECRET`.
- `GET /api/health`: `select 1` plus a write/read of the files dir. 503 on failure.
- **Legacy notice** (`LEGACY_RESTORE_NOTICE=1`) on portal lookup "not found" and on
  unknown review links: *"Jobs submitted before Nov 16 are being restored — email
  hello@ddfevents.ca."*
- Remove `@supabase/*`. Add `postgres`, `jose`, `bcryptjs`, `vitest`. Move
  `SUPABASE_*.sql` to `db/legacy-supabase/`. Update `SYSTEM_STATE.md`,
  `.env.example`, `CLAUDE.md`. Remove the Vercel-only `vercel.json` cron.

### 5.5 Offline page — `cloudflare/offline-worker/`
A Worker (`wrangler deploy`, free plan) on route `jobs.ddfpixel.com/*`:
`fetch(request)`, and if that throws or returns 502/521/522/523/524/530, return
a 503 HTML page with the DDF logo, "offline right now" text,
`hello@ddfevents.ca`, and `Retry-After: 300`. Requests to `/api/*` get JSON
`{"error":"offline"}` (503) instead.

### 5.6 Go-live
1. On the MacBook: unit/DB tests plus a staging smoke run against a dev server.
   On the shop PC (WSL2): clone, `.env`, `scripts/deploy.sh`, smoke against `localhost:3000`.
2. Start the tunnel, deploy the Worker, and run the smoke test against `https://jobs.ddfpixel.com`.
3. Create admin logins. Make one test job, then delete **only that id**.
4. Reboot the shop PC and confirm: the offline page shows during the reboot; after
   auto sign-in the site returns with no one touching it.

## 6. Ops — "never again"
- `ops/loop.sh`, every 10 min while Docker runs:
  - **DB dump** if the last good dump is > 20 h old: `pg_dump | gzip` →
    `~/DDF-Data/backups/db-YYYY-MM-DD-HHMM.sql.gz`, keep the newest 14.
  - **Off-site** if the last good sync is > 20 h old: `rclone copy` backups dir →
    `r2:ddf-backups/db/` and files → `r2:ddf-backups/files/` (copy, never delete).
    R2 lifecycle deletes `db/` after 30 days.
  - **Kanban retry** every 6 h: `curl -H "Authorization: Bearer $CRON_SECRET" app:3000/api/cron/kanban-retry`.
  - **Health** every 10 min: `GET app:3000/api/health`. Not 200 → ntfy p5.
  - **Weekly digest** (when the last one is > 7 days old): DB size, files GB and count,
    `ddf-backups` size, free disk. Warn (ntfy p4) at R2 > 8 GB or disk < 20 GB.
  - Any failure: ntfy p5, at most once per 6 h per job kind. State goes in
    `~/DDF-Data/ops-state/`.
- Optional second local copy: Windows File History on `\\wsl$\...\DDF-Data\backups`.
- `RESTORE.md`: rebuild on any machine with Docker in about an hour (clone, `.env`,
  `docker compose up -d db`, `gunzip | psql` the latest dump, `rclone copy` files back, `up -d`).

## 7. Phase 2 — Recover the old data
### 7.1 Ways to get the data out (try in order)
| Route | Cost | Certainty | Notes |
|---|---|---|---|
| A. Supabase support ticket: "migrating off, need a temporary lift or an export of DB + `job-files`" | $0 | Medium, slow | Send on day 1. |
| B. Billing-cycle reset: restrictions lift when the quota refills | $0 | Low–medium | Date is on Billing → Upcoming invoice. Run the export the moment access returns; the window may be short. |
| C. Pause the project and check whether Studio offers the DB backup and storage download | $0 | **Unverified** | Documented for long-paused projects. Resuming may then be blocked. Owner decides; try only after A and B. |
| D. One-time Pro upgrade (prorated ~US$25), export, downgrade | One-time | High | Last resort. |

### 7.2 `scripts/export-supabase.sh`
`pg_dump` of `public` (session-pooler URL from the Supabase dashboard) plus a full
download of the `job-files` bucket using the service-role key in `.env.local`.
Output: `~/DDF-Data/legacy-supabase/{db.sql,files/}`. Sizes are logged.

### 7.3 `scripts/import-legacy.ts`
1. Restore `db.sql` into a **scratch database** `legacy` on the same Postgres
   container. Ignore errors from Supabase-only objects.
2. Schema diff: add any legacy `jobs` columns missing from `db/schema.sql`, to the
   file and the live DB.
3. Map every legacy `tenant_id` to the new `ddf` tenant. Copy legacy DDF
   `tenant_settings` values.
4. Insert `jobs` and `design_library` with `OVERRIDING SYSTEM VALUE` (original ids).
   `ON CONFLICT` on `reference_number`/`submission_id`: skip and log. Assert legacy
   max id < 1,000,000. Skip `kanban_sync_queue` and `auth.*`.
5. Files: copy `legacy-supabase/files/**` → `~/DDF-Data/files/` with the same keys.
   Never overwrite an existing key.
6. Report: row counts legacy vs. new; referenced keys missing on disk (expect 0);
   a sample of old review tokens resolve (HTTP 200).
7. Set `LEGACY_RESTORE_NOTICE=0`. Delete the Supabase project only after the owner signs off.

## 8. Error handling
- DB unreachable: 503 with a friendly message. The ops health check sends ntfy p5
  (throttled 6 h per kind).
- Upload: token expired or invalid → 403. Body larger than the signed size or 50 MB
  → 413 and the partial file is deleted. Write via temp + rename, so a broken upload
  never leaves a half file under the real key.
- `/f/` with an unknown key → 404. Keys containing `..` or starting with `/` are rejected.
- Shop PC or internet down → the Worker's offline page (5.5).

## 9. Testing
- **Unit (vitest, no services):** type parsers; file tokens (sign/verify, expiry,
  tamper, wrong kind); `filePath` traversal guard; auth (hash/verify, JWT
  sign/verify/expiry/tamper).
- **DB (vitest + local Postgres container, `TEST_DATABASE_URL`):** schema applies
  twice (idempotent); 10 parallel `update_job_item` calls all persist;
  `append_to_job`; repo functions return Supabase-shaped rows (string dates, number
  ids).
- **Routes:** upload PUT (happy path, oversize → 413, bad token → 403), `/f/` stream,
  login/logout/me.
- **Smoke (`scripts/smoke.ts <baseUrl>`):** submit brief with a small PDF, admin
  login, proof upload, review-link approve, portal lookup, add-to-job, final-file
  upload, design-library add, Kanban webhook request sent (assert sent, not accepted).
  Clean up **by exact ids created**.

## 10. Risks and open items
- **Downtime during reboots, power or internet outages at the shop.** The offline page
  mitigates; auto sign-in (D20) brings it back unattended.
- **Auto sign-in** means anyone at that keyboard is signed in to the host account.
  Use a dedicated account without admin rights where possible.
- **Shared PC resources** if it also runs production software (D21).
- **Command Centre → intake status callbacks** sent while the host is down are lost.
  Statuses catch up on the next callback for that job. Admin can Resync.
- **DNS move:** email forwarding must be recreated before switching nameservers (D4).
- **PC loss/theft/disk failure:** covered by the off-site R2 copy (≤ 20 h old).
- **Cloudflare free-plan terms** discourage serving mostly large files through the
  CDN. At this volume (mostly HTML/API, occasional PDFs) the risk is low.
- **Assumption, not verified:** legacy file storage under 10 GB. If it's larger,
  only the off-site R2 copy is affected (alert at 8 GB), not the app.
- **Old jobs and links are unavailable until Phase 2.** The legacy notice covers this.

## 11. Cost
| Item | Monthly |
|---|---|
| Shop PC (existing), Docker Desktop, Postgres | $0 |
| Cloudflare DNS, Tunnel, Worker, Email Routing | $0 |
| Cloudflare R2 off-site (< 10 GB) | $0 (card on file) |
| Brevo, ntfy (existing) | $0 |
| **Total** | **$0** (Phase 2 route D would be one-time ~US$25, only if A–C fail) |
