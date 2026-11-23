# Supabase Exit — Phase 2 (Recover the Old Data) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Copy every job, design-library entry, branding setting and client file out of the restricted Supabase project and into the self-hosted system, keeping original job ids so links already emailed to clients work again.

**Architecture:** Export with `pg_dump` (run from a `postgres:17-alpine` container) plus a small script that downloads the `job-files` bucket over Supabase's Storage REST API. Restore the dump into a scratch database `legacy` on the same Postgres container. A single transactional SQL script copies rows across with `postgres_fdw` (types handled by Postgres, ids preserved with `OVERRIDING SYSTEM VALUE`, conflicts skipped). Files are copied with `rsync --ignore-existing`. A verification script reports row counts, missing files and live review links.

**Tech Stack:** Postgres 17 (`postgres_fdw`), Docker, `tsx`, `postgres` (porsager), rsync. Runs on the Windows shop PC in WSL2 Ubuntu (`~/ddf-intake`).

> **Implemented 2026-11-16 (branch `supabase-exit-phase2`).** Tasks 2–5 are now wrapped in scripts; the owner runbook is `LEGACY_IMPORT.md`. Differences from the code below: Task 3's schema diff is built into `db/import-legacy.sql` (it refuses to run if an old column is missing or has a different type, and `--dry-run` rolls back); `scripts/restore-legacy.sh` pre-creates `extensions`/`auth` stand-ins so Supabase defaults and FKs don't stop tables loading; fdw uses the Unix socket (no password var); `scripts/import-legacy.sh` does backup → import → rsync → verify in one go. Tests: `tests/legacy-import.test.ts`, `tests/legacy-scripts.test.ts`.

**Prerequisite:** Phase 1 is live (`docs/superpowers/plans/2026-11-15-supabase-exit-phase1.md`). Spec: section 7 of `docs/superpowers/specs/2026-11-15-supabase-exit-design.md`.

---

### Task 1: Get read access to the old project (owner)

Try in this order; stop at the first that works. Data is safe while you try. Supabase keeps restricted and paused projects.

- [ ] **Route A ($0): support ticket.** supabase.com/dashboard/support → project `pbgyekhyoihietqjrfpb`. Suggested text: *"This project is restricted for exceed_storage_size_quota. We're migrating off Supabase and need either a temporary lift (24–48 h) to export our database and the job-files bucket, or an export of both. We won't add new data."* Send it on go-live day.
- [ ] **Route B ($0): billing-cycle reset.** Organization → Billing → "Upcoming invoice" shows the cycle end date. Restrictions lift when the quota refills; storage is immediately over quota again, so the window may be short. Be ready to run Task 2 the moment the dashboard shows the project healthy.
- [ ] **Route C ($0, unverified): pause and download.** Project → Settings → General → Pause project. Then check the project page for **Download backup** and **storage objects**. Only do this after A and B fail: resuming may be blocked afterwards. If downloads are offered, save the `.backup` file as `~/DDF-Data/legacy-supabase/db.sql` (gunzip first if it ends in `.gz`) and unpack the storage download so files sit at `~/DDF-Data/legacy-supabase/files/uploads/...` (drop any leading `job-files/` folder), then skip to Task 3.
- [ ] **Route D (one-time ~US$25): upgrade, export, downgrade.** Organization → Billing → upgrade to Pro (prorated). Run Task 2 the same day. Then Billing → downgrade to Free. Unused time comes back as Supabase credit.

---

### Task 2: Export the database and files

Run on the shop PC in Ubuntu, in `~/ddf-intake`.

**Files:**
- Create: `scripts/export-supabase-files.ts`, `scripts/export-supabase.sh`

- [ ] **Step 1 [owner]: Collect three values** into `~/DDF-Data/legacy-supabase/export.env` (`chmod 600`):

```bash
SUPABASE_URL=https://pbgyekhyoihietqjrfpb.supabase.co
SUPABASE_SERVICE_ROLE_KEY=   # from the MacBook: ~/DDF-Data/legacy-supabase/env.local.supabase-backup
SUPABASE_DB_URL=             # dashboard → Connect → Session pooler URI, with the DB password filled in
```
If the DB password is unknown: Project → Settings → Database → Reset database password (safe; nothing else uses it any more).

- [ ] **Step 2: Create `scripts/export-supabase-files.ts`**

```ts
// Download every object in the Supabase `job-files` bucket to <outDir>, keeping keys.
// Re-runnable: skips files already present with the same size.
//   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npx tsx scripts/export-supabase-files.ts ~/DDF-Data/legacy-supabase/files
import { mkdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

const BUCKET = 'job-files'
const base = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '')
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const outDir = process.argv[2]
const headers = { Authorization: `Bearer ${key}`, apikey: key }

type Entry = { name: string; id: string | null; metadata: { size?: number } | null }

async function list(prefix: string): Promise<Entry[]> {
  const all: Entry[] = []
  for (let offset = 0; ; offset += 1000) {
    const res = await fetch(`${base}/storage/v1/object/list/${BUCKET}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }),
    })
    if (!res.ok) throw new Error(`list ${prefix}: HTTP ${res.status} ${await res.text()}`)
    const page = (await res.json()) as Entry[]
    all.push(...page)
    if (page.length < 1000) return all
  }
}

async function walk(prefix: string, out: { key: string; size: number }[]): Promise<void> {
  for (const e of await list(prefix)) {
    const k = prefix ? `${prefix}/${e.name}` : e.name
    if (e.id === null) await walk(k, out)            // folder
    else out.push({ key: k, size: e.metadata?.size ?? -1 })
  }
}

async function download(k: string, size: number): Promise<'skip' | 'ok'> {
  const dest = path.join(outDir, k)
  try { if ((await stat(dest)).size === size) return 'skip' } catch { /* not there yet */ }
  const res = await fetch(`${base}/storage/v1/object/${BUCKET}/${k.split('/').map(encodeURIComponent).join('/')}`, { headers })
  if (!res.ok) throw new Error(`download ${k}: HTTP ${res.status}`)
  await mkdir(path.dirname(dest), { recursive: true })
  await writeFile(dest, Buffer.from(await res.arrayBuffer()))
  return 'ok'
}

async function main() {
  if (!base || !key || !outDir) throw new Error('need SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and <outDir>')
  const objects: { key: string; size: number }[] = []
  await walk('', objects)
  const total = objects.reduce((s, o) => s + Math.max(o.size, 0), 0)
  console.log(`${objects.length} objects, ${(total / 1073741824).toFixed(2)} GB`)
  let done = 0, skipped = 0, failed = 0
  const queue = [...objects]
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (let o = queue.shift(); o; o = queue.shift()) {
      try { (await download(o.key, o.size)) === 'skip' ? skipped++ : done++ }
      catch (e) { failed++; console.error(`❌ ${(e as Error).message}`) }
      if ((done + skipped) % 50 === 0) console.log(`… ${done + skipped}/${objects.length}`)
    }
  }))
  console.log(`✅ downloaded ${done}, already had ${skipped}, failed ${failed}`)
  if (failed) process.exitCode = 1
}

main().catch(e => { console.error(`❌ ${(e as Error).message}`); process.exitCode = 1 })
```

- [ ] **Step 3: Create `scripts/export-supabase.sh`**

```bash
#!/usr/bin/env bash
# Export the legacy Supabase DB (public schema) and the job-files bucket.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="$HOME/DDF-Data/legacy-supabase"
set -a; source "$OUT/export.env"; set +a
mkdir -p "$OUT/files"

echo "→ pg_dump (public schema)"
docker run --rm -v "$OUT:/out" postgres:17-alpine \
  pg_dump "$SUPABASE_DB_URL" --schema=public --no-owner --no-privileges -f /out/db.sql
ls -lh "$OUT/db.sql"

echo "→ files"
npx tsx scripts/export-supabase-files.ts "$OUT/files"
du -sh "$OUT/files"
```
Then `chmod +x scripts/export-supabase.sh`.

- [ ] **Step 4: Run it** (as soon as Task 1 gives access)

Run: `./scripts/export-supabase.sh`
Expected: `db.sql` is listed with a non-zero size; `N objects, X GB`; `✅ downloaded N, already had 0, failed 0`. If any file fails, re-run; it resumes. **Once this succeeds, the data is safe on your disk. Downgrade Supabase now if you used Route D.**

- [ ] **Step 5: Commit the scripts** (on the MacBook or the PC, then push)

```bash
git add scripts/export-supabase.sh scripts/export-supabase-files.ts
git commit -m "feat(phase2): supabase export scripts"
```

---

### Task 3: Restore into a scratch database and diff the schema

**Files:**
- Create: `scripts/legacy-schema-diff.sql`
- Possibly modify: `db/schema.sql`

- [ ] **Step 1: Load the dump into `legacy`.** Errors about `auth.*`, `storage.*`, roles or policies are expected and harmless (they're Supabase-only), so this runs **without** `ON_ERROR_STOP`:

```bash
cd ~/ddf-intake
docker compose exec -T db psql -U ddf -d postgres -c "drop database if exists legacy" -c "create database legacy"
docker compose exec -T db psql -U ddf -d legacy -q < ~/DDF-Data/legacy-supabase/db.sql 2> ~/DDF-Data/legacy-supabase/restore-errors.log
docker compose exec -T db psql -U ddf -d legacy -Atc "select count(*) from jobs"
```
Expected: the job count (a number > 0). Skim `restore-errors.log`. Every error should mention `auth`, `storage`, a role, `policy`, or `tenant_members`. Anything else (e.g. on `jobs`) → stop and investigate.

- [ ] **Step 2: Create `scripts/legacy-schema-diff.sql`**

```sql
-- Columns on legacy tables that the new schema lacks (need adding to db/schema.sql),
-- and new-schema columns the legacy table lacks (they'll take their defaults).
with legacy as (
  select table_name, column_name, data_type from information_schema.columns
  where table_catalog = 'legacy' and table_schema = 'public'
)
select 'missing in new schema' as issue, table_name, column_name, data_type
from dblink('dbname=legacy user=ddf', $q$
  select table_name::text, column_name::text, data_type::text from information_schema.columns
  where table_schema = 'public' and table_name in ('jobs','design_library','tenants','tenant_settings')
$q$) as l(table_name text, column_name text, data_type text)
where not exists (
  select 1 from information_schema.columns n
  where n.table_schema = 'public' and n.table_name = l.table_name and n.column_name = l.column_name)
order by 2, 3;
```

- [ ] **Step 3: Run the diff against the live DB**

```bash
docker compose exec -T db psql -U ddf -d ddf -c "create extension if not exists dblink"
docker compose exec -T db psql -U ddf -d ddf -f - < scripts/legacy-schema-diff.sql
```
Expected: ideally `(0 rows)`. For each row returned, add the column to `db/schema.sql` right after the `create table if not exists public.jobs` block (or the relevant table) as an idempotent statement, e.g.:

```sql
alter table public.jobs add column if not exists <column_name> <data_type>;
```
Then commit, push, and run `./scripts/deploy.sh` on the PC, and re-run the diff until it returns 0 rows.

- [ ] **Step 4: Commit**

```bash
git add scripts/legacy-schema-diff.sql db/schema.sql
git commit -m "feat(phase2): legacy schema diff (+ any missing columns)"
```

---

### Task 4: Import rows and files

**Files:**
- Create: `db/import-legacy.sql`

- [ ] **Step 1: Back up the live DB first**

```bash
docker compose exec -T db pg_dump -U ddf -d ddf --no-owner | gzip > ~/DDF-Data/backups/db-before-legacy-import.sql.gz
ls -lh ~/DDF-Data/backups/db-before-legacy-import.sql.gz
```

- [ ] **Step 2: Create `db/import-legacy.sql`**

```sql
-- Copy legacy Supabase rows (database `legacy`) into the live DB (`ddf`).
-- One transaction: all or nothing. Original ids kept; unique conflicts skipped.
-- Run: psql -U ddf -d ddf -v ON_ERROR_STOP=1 -v pw="$POSTGRES_PASSWORD" -f db/import-legacy.sql
\set ON_ERROR_STOP 1
begin;

create extension if not exists postgres_fdw;
drop server if exists legacy_srv cascade;
create server legacy_srv foreign data wrapper postgres_fdw options (dbname 'legacy');
create user mapping for current_user server legacy_srv options (user 'ddf', password :'pw');
drop schema if exists legacy_fdw cascade;
create schema legacy_fdw;
import foreign schema public limit to (jobs, design_library, tenants, tenant_settings)
  from server legacy_srv into legacy_fdw;

do $$
declare
  ddf        uuid;
  cols       text;
  max_legacy bigint;
  before_n   bigint;
  after_n    bigint;
  legacy_n   bigint;
begin
  select id into ddf from public.tenants where slug = 'ddf';

  select max(id), count(*) into max_legacy, legacy_n from legacy_fdw.jobs;
  if max_legacy >= 1000000 then
    raise exception 'legacy job id % collides with the new id range (>= 1,000,000)', max_legacy;
  end if;
  raise notice 'legacy tenants: %', (select string_agg(slug, ', ') from legacy_fdw.tenants);

  -- jobs: every column both sides have, except tenant_id (all mapped to ddf)
  select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position) into cols
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = 'jobs' and c.column_name <> 'tenant_id'
    and exists (select 1 from information_schema.columns l
                where l.table_schema = 'legacy_fdw' and l.table_name = 'jobs' and l.column_name = c.column_name);
  select count(*) into before_n from public.jobs;
  execute format(
    'insert into public.jobs (tenant_id, %1$s) overriding system value
     select %2$L::uuid, %1$s from legacy_fdw.jobs order by id
     on conflict do nothing', cols, ddf);
  select count(*) into after_n from public.jobs;
  raise notice 'jobs: % legacy rows, % imported, % skipped (conflict)', legacy_n, after_n - before_n, legacy_n - (after_n - before_n);

  -- design library
  select count(*) into before_n from public.design_library;
  insert into public.design_library (id, tenant_id, name, path, created_at) overriding system value
  select id, ddf, name, path, created_at from legacy_fdw.design_library order by id
  on conflict do nothing;
  select count(*) into after_n from public.design_library;
  raise notice 'design_library: % imported', after_n - before_n;

  -- DDF branding as it was configured in Supabase
  update public.tenant_settings s
  set business_name = coalesce(l.business_name, s.business_name),
      logo_url      = coalesce(l.logo_url, s.logo_url),
      brand_color   = coalesce(l.brand_color, s.brand_color),
      reply_to_email= coalesce(l.reply_to_email, s.reply_to_email),
      ntfy_topic    = coalesce(l.ntfy_topic, s.ntfy_topic)
  from legacy_fdw.tenant_settings l
  join legacy_fdw.tenants lt on lt.id = l.tenant_id and lt.slug = 'ddf'
  where s.tenant_id = ddf;
end $$;

drop schema legacy_fdw cascade;
drop server legacy_srv cascade;
commit;
```
(Legacy `design_library` max id is also < 1,000,000 because its identity started at 1. The `kanban_sync_queue` and Supabase `auth` tables are deliberately not imported.)

- [ ] **Step 3: Run the import**

```bash
set -a; source .env; set +a
docker compose exec -T db psql -U ddf -d ddf -v ON_ERROR_STOP=1 -v pw="$POSTGRES_PASSWORD" -f - < db/import-legacy.sql
```
Expected: `NOTICE: legacy tenants: ddf`, `NOTICE: jobs: N legacy rows, N imported, 0 skipped (conflict)`, `NOTICE: design_library: M imported`, `COMMIT`. A non-zero "skipped" means a reference number or submission id already existed: note those references for Task 5.

- [ ] **Step 4: Copy the files** (never overwrites a file that's already there)

```bash
rsync -a --ignore-existing ~/DDF-Data/legacy-supabase/files/ "$DDF_DATA_DIR/files/"
du -sh "$DDF_DATA_DIR/files"
```

- [ ] **Step 5: Commit**

```bash
git add db/import-legacy.sql
git commit -m "feat(phase2): transactional legacy import via postgres_fdw"
```

---

### Task 5: Verify, switch off the notice, clean up

**Files:**
- Create: `scripts/verify-legacy-import.ts`

- [ ] **Step 1: Create `scripts/verify-legacy-import.ts`**

```ts
// Verifies the Phase 2 import: row counts, referenced files on disk, and that a
// sample of old review links resolves on the live site.
//   DATABASE_URL=… LEGACY_DATABASE_URL=… FILES_DIR=… REVIEW_LINK_SECRET=… \
//   npx tsx scripts/verify-legacy-import.ts https://jobs.ddfpixel.com
import postgres from 'postgres'
import { createHmac } from 'node:crypto'
import { stat } from 'node:fs/promises'
import path from 'node:path'

const site = (process.argv[2] ?? 'https://jobs.ddfpixel.com').replace(/\/+$/, '')
const need = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`${k} is required`); return v }

function collectKeys(v: unknown, out: Set<string>): void {
  if (typeof v === 'string') { if (v.startsWith('uploads/')) out.add(v); return }
  if (Array.isArray(v)) { v.forEach(x => collectKeys(x, out)); return }
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (k.startsWith('uploads/')) out.add(k); collectKeys(x, out) }
}

function reviewToken(jobId: number, secret: string): string {
  const p = `review:${jobId}`
  return `${Buffer.from(p).toString('base64url')}.${createHmac('sha256', secret).update(p).digest('base64url')}`
}

async function main() {
  const live = postgres(need('DATABASE_URL'), { max: 1, onnotice: () => {} })
  const legacy = postgres(need('LEGACY_DATABASE_URL'), { max: 1, onnotice: () => {} })
  const filesDir = need('FILES_DIR')
  const secret = need('REVIEW_LINK_SECRET')
  let problems = 0
  try {
    const legacyIds = (await legacy<{ id: string }[]>`select id from jobs order by id`).map(r => Number(r.id))
    const liveRows = await live<{ id: string; file_paths: string[]; items: unknown }[]>`
      select id, file_paths, items from jobs where id < 1000000 order by id`
    const liveIds = new Set(liveRows.map(r => Number(r.id)))
    const missingRows = legacyIds.filter(id => !liveIds.has(id))
    console.log(`rows: legacy ${legacyIds.length}, imported ${liveIds.size}, missing ${missingRows.length}`)
    if (missingRows.length) { problems++; console.log(`  missing ids: ${missingRows.slice(0, 20).join(', ')}`) }

    const keys = new Set<string>()
    for (const r of liveRows) { collectKeys(r.file_paths, keys); collectKeys(r.items, keys) }
    for (const r of await live<{ path: string }[]>`select path from design_library`) keys.add(r.path)
    const missingFiles: string[] = []
    for (const k of keys) { try { await stat(path.join(filesDir, k)) } catch { missingFiles.push(k) } }
    console.log(`files referenced: ${keys.size}, missing on disk: ${missingFiles.length}`)
    if (missingFiles.length) { problems++; console.log(missingFiles.slice(0, 30).map(k => `  ${k}`).join('\n')) }

    const sample = [...liveIds].sort(() => Math.random() - 0.5).slice(0, 5)
    for (const id of sample) {
      const res = await fetch(`${site}/api/review/${reviewToken(id, secret)}`)
      console.log(`review link job ${id}: HTTP ${res.status}`)
      if (res.status !== 200) problems++
    }
  } finally {
    await live.end(); await legacy.end()
  }
  console.log(problems ? `⚠️  ${problems} problem group(s) — see above` : '✅ import verified')
  if (problems) process.exitCode = 1
}

main().catch(e => { console.error(`❌ ${(e as Error).message}`); process.exitCode = 1 })
```

- [ ] **Step 2: Run it**

```bash
set -a; source .env; set +a
DATABASE_URL="postgres://ddf:${POSTGRES_PASSWORD}@127.0.0.1:5433/ddf" \
LEGACY_DATABASE_URL="postgres://ddf:${POSTGRES_PASSWORD}@127.0.0.1:5433/legacy" \
FILES_DIR="$DDF_DATA_DIR/files" \
npx tsx scripts/verify-legacy-import.ts https://jobs.ddfpixel.com
```
Expected: `missing 0`, `missing on disk: 0`, five `HTTP 200`, `✅ import verified`.
- Review links return 401/404 → `REVIEW_LINK_SECRET` isn't the old value. If the old value is truly lost, old emailed links can't be revived. The admin sends fresh links from the admin page when clients ask.
- Missing files → check `~/DDF-Data/legacy-supabase/files` for them (re-run the export if the project is still reachable). Otherwise list them for the owner.

- [ ] **Step 3: Spot-check in the browser:** open three old jobs in `/admin` (thumbnails show), look one up in `/portal` by its reference + email, open one old review link from a real client email.

- [ ] **Step 4: Turn off the legacy notice.** In `~/ddf-intake/.env` set `LEGACY_RESTORE_NOTICE=0`, then `docker compose up -d --force-recreate app`.

- [ ] **Step 5: Force a fresh off-site sync** (the import added many files):

```bash
rm -f ~/DDF-Data/ops-state/offsite ~/DDF-Data/ops-state/digest
docker compose restart ops
```
The next weekly digest arrives within ~10 minutes. If off-site is over 8 GB, the owner decides: accept a few cents/month on R2 or switch `OFFSITE_REMOTE` to Google Drive (Phase 1, Task 20 Step 8).

- [ ] **Step 6: Clean up the scratch database** (after the owner has checked old jobs for a few days)

```bash
docker compose exec -T db psql -U ddf -d postgres -c "drop database legacy"
```
Keep `~/DDF-Data/legacy-supabase/` (dump + files) as a cold archive.

- [ ] **Step 7 [owner]: Retire Supabase and Vercel leftovers** — only after signing off on the import:
  - Supabase → project `pbgyekhyoihietqjrfpb` → Settings → General → **Delete project** (irreversible; the export in `~/DDF-Data/legacy-supabase/` is the archive). If Command Centre still uses Supabase, leave **that** project and organization alone.
  - Vercel → ddf-intake → Environment Variables: delete the `SUPABASE_*` vars (or the whole project if nothing else needs it).
  - Delete `~/DDF-Data/legacy-supabase/export.env` and the MacBook's `env.local.supabase-backup` (they hold the service-role key).

- [ ] **Step 8: Commit and record**

```bash
git add scripts/verify-legacy-import.ts
git commit -m "feat(phase2): import verification script"
```
Add a line to `SYSTEM_STATE.md` → "Self-hosting": *Legacy Supabase data imported on <date> (ids < 1,000,000); archive at `~/DDF-Data/legacy-supabase/` on the shop PC.* Commit and push.
