# Supabase Exit — Phase 1 (Self-Hosted Go-Live) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove every Supabase dependency from ddf-intake and run it self-hosted (Postgres + local files + own admin login) in Docker on the always-on Windows shop PC, published at `https://jobs.ddfpixel.com` through a Cloudflare Tunnel, with backups and alerts. $0/month.

**Architecture:** Next.js 16 app in a standalone Docker image talks to a Postgres 17 container through small repo modules (`postgres` library, raw SQL). Files are stored on disk under the same keys Supabase used (`uploads/...`). Uploads and downloads go through HMAC-signed app URLs (`/upload/<token>`, `/f/<token>`). An `ops` container does health checks, dumps, off-site sync to R2, and Kanban retries. A Cloudflare Worker shows an offline page when the shop PC is unreachable.

**Tech Stack:** Next.js 16.2.6, React 19, TypeScript, `postgres` (porsager) v3, `jose`, `bcryptjs`, `vitest`, `tsx`, Docker Compose, Postgres 17, cloudflared, Cloudflare Workers (wrangler), rclone.

**Spec:** `docs/superpowers/specs/2026-11-15-supabase-exit-design.md` (v3). Read it first.
**Phase 2 (old data import):** `docs/superpowers/plans/2026-11-15-supabase-exit-phase2.md`.

---

## Ground rules for whoever executes this

- This repo's `AGENTS.md` says: *this Next.js version has breaking changes — read the relevant guide in `node_modules/next/dist/docs/` before writing code.* Do that for route handlers, `proxy.ts`, and `output: 'standalone'`.
- **Never bulk-delete by query** in a shared table. Delete only the exact ids a test or smoke run created (see `SYSTEM_STATE.md`, "Hard-learned rules").
- **Back up `.env.local` before touching it.** It holds `SUPABASE_SERVICE_ROLE_KEY`, which Phase 2 needs and which may be the review-link signing secret (Task 15).
- Coding and testing happen on the **MacBook** (`~/Documents/Claude/ddf-intake`). Production runs on the **Windows shop PC**, inside WSL2 Ubuntu (`~/ddf-intake`). Docker Desktop is required on both.
- Work on branch `supabase-exit`. Commit after every task. Don't merge to `main` until Task 20.
- Run commands from the repo root unless a step says otherwise.

## File map

| File | Status | Responsibility |
|---|---|---|
| `db/schema.sql` | create | Canonical, idempotent Postgres schema + DDF seed |
| `db/test-db.sql` | create | First-boot init: creates `ddf_test` and `ddf_dev` databases |
| `src/lib/pg-time.ts` | create | Postgres timestamp text → ISO string |
| `src/lib/db.ts` | create | Lazy `postgres()` client with Supabase-compatible type parsers |
| `src/lib/jobs-repo.ts` | create | All `jobs` queries; `{ data, error }` results |
| `src/lib/library-repo.ts` | create | `design_library` queries |
| `src/lib/file-store.ts` | create | Safe key → path, atomic streaming writes, exists/remove/stat/read |
| `src/lib/file-tokens.ts` | create | HMAC upload tokens and long-lived file links |
| `src/app/upload/[token]/route.ts` | create | `PUT` upload endpoint (streams to disk) |
| `src/app/f/[token]/route.ts` | create | `GET` file endpoint (streams from disk) |
| `src/lib/session.ts` | create | Admin JWT cookie sign/verify (`jose`, edge-safe, no `server-only`) |
| `src/lib/admin-users.ts` | create | `admin_users` queries + bcrypt helpers |
| `src/app/api/admin/login/route.ts` | create | Admin password login |
| `src/app/api/admin/logout/route.ts` | create | Clear admin cookie |
| `src/app/api/admin/me/route.ts` | create | Who am I (used by the admin page) |
| `src/app/api/health/route.ts` | create | DB + files health |
| `src/lib/admin-auth.ts` | rewrite | `requireAdmin()` from cookie (same return shape) |
| `src/proxy.ts` | rewrite | Rate limits + `/admin` cookie gate |
| `src/app/login/page.tsx` | rewrite | Admin-only login form |
| `src/lib/portal-auth.ts` | rewrite | Portal token only |
| `src/lib/tenant.ts`, `tenant-public.ts`, `tenant-settings.ts` | modify | SQL instead of Supabase |
| `src/lib/proof-sign.ts`, `kanban-sync.ts` | modify | SQL + file links |
| `src/lib/review-token.ts`, `portal-token.ts` | modify | Require `REVIEW_LINK_SECRET` |
| 20 route files under `src/app/api/**` | modify | Call repos / file-store instead of Supabase |
| `src/app/admin/page.tsx`, `src/app/portal/page.tsx`, `src/app/review/[token]/ReviewClient.tsx` | modify | Drop Supabase browser client; legacy notice |
| `src/lib/supabase-*.ts`, `src/app/auth/callback/` | delete | — |
| `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `ops/Dockerfile`, `ops/loop.sh` | create | Runtime |
| `scripts/deploy.sh`, `scripts/admin-user.ts`, `scripts/admin-set.sh`, `scripts/smoke.ts` | create | Operations |
| `cloudflare/offline-worker/{wrangler.toml,src/index.ts}` | create | Offline page |
| `tests/**` | create | vitest suites |
| `RESTORE.md`, `.env.example`, `SYSTEM_STATE.md`, `CLAUDE.md`, `vercel.json`, `next.config.ts`, `tsconfig.json`, `package.json` | modify | Docs and config |

---

### Task 1: Branch, safety copies, test tooling

**Files:**
- Create: `vitest.config.ts`, `tests/empty.ts`
- Modify: `package.json`, `tsconfig.json`

- [ ] **Step 1: Branch and save the spec**

```bash
git checkout -b supabase-exit
git add docs/superpowers/specs/2026-11-15-supabase-exit-design.md docs/superpowers/plans/
git commit -m "docs: supabase exit spec (v3) and phase plans"
```

- [ ] **Step 2: Safety-copy the Supabase credentials** (needed for Phase 2 and Task 15)

```bash
mkdir -p ~/DDF-Data/legacy-supabase
cp .env.local ~/DDF-Data/legacy-supabase/env.local.supabase-backup
chmod 600 ~/DDF-Data/legacy-supabase/env.local.supabase-backup
grep -c SUPABASE_SERVICE_ROLE_KEY ~/DDF-Data/legacy-supabase/env.local.supabase-backup
```
Expected: `1`.

- [ ] **Step 3: Install dependencies**

```bash
npm install postgres@^3.4 jose@^6 bcryptjs@^3
npm install -D vitest@^3 tsx@^4
```

- [ ] **Step 4: Create `tests/empty.ts`** (stands in for `server-only` under vitest)

```ts
export {}
```

- [ ] **Step 5: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 20_000,
    // DB suites truncate shared tables, so files must not run in parallel.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      'server-only': path.resolve(__dirname, 'tests/empty.ts'),
    },
  },
})
```

- [ ] **Step 6: Add scripts to `package.json`** (merge into the existing `"scripts"` object)

```json
"test": "vitest run",
"test:watch": "vitest",
"typecheck": "tsc --noEmit",
"admin:set": "bash scripts/admin-set.sh",
"smoke": "tsx scripts/smoke.ts"
```

- [ ] **Step 7: Keep Next's type-check away from scripts and the Worker.** In `tsconfig.json`, change

```json
"exclude": ["node_modules"]
```
to
```json
"exclude": ["node_modules", "scripts", "cloudflare"]
```

- [ ] **Step 8: Verify vitest runs** (no tests yet)

Run: `npx vitest run --passWithNoTests`
Expected: exits 0, "No test files found".

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json vitest.config.ts tests/empty.ts tsconfig.json
git commit -m "chore: vitest + tsx tooling for supabase exit"
```

---

### Task 2: Postgres container and canonical schema

**Files:**
- Create: `db/schema.sql`, `db/test-db.sql`, `docker-compose.yml` (db service only; Task 16 adds the rest), `tests/helpers/db.ts`, `tests/schema.test.ts`
- Create (local only, git-ignored): `.env`

- [ ] **Step 1: Create a local `.env` with a DB password** (git-ignored already by `.env*` in `.gitignore`; confirm with `git check-ignore .env`)

```bash
printf 'POSTGRES_PASSWORD=%s\nDDF_DATA_DIR=%s\n' "$(openssl rand -hex 24)" "$HOME/DDF-Data" > .env
git check-ignore .env
```
Expected: prints `.env`.

- [ ] **Step 2: Create `db/test-db.sql`**

```sql
-- Runs once, on the very first start of the db container (empty volume).
-- ddf_test: wiped by the test suite. ddf_dev: used by `npm run dev` for staging smoke runs.
create database ddf_test;
create database ddf_dev;
```

- [ ] **Step 3: Create `db/schema.sql`**

```sql
-- db/schema.sql — canonical schema for ddf-intake (plain Postgres 17).
-- Idempotent: safe to run on every deploy (scripts/deploy.sh does).
-- Replaces supabase/schema.sql, supabase/migrations/*, and root SUPABASE_*.sql.
-- No RLS: only the app's server code connects (spec D12).

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── Tenants (single default tenant 'ddf') ───────────────────────────
create table if not exists public.tenants (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  created_at  timestamptz not null default now()
);

create table if not exists public.tenant_settings (
  tenant_id               uuid primary key references public.tenants(id) on delete cascade,
  business_name           text,
  logo_url                text,
  brand_color             text,
  reply_to_email          text,
  ntfy_topic              text,
  plan                    text not null default 'trial'
                          check (plan in ('trial','solo','studio','pro')),
  plan_status             text not null default 'trialing'
                          check (plan_status in ('trialing','active','past_due','canceled')),
  trial_ends_at           timestamptz,
  square_customer_id      text,
  square_subscription_id  text,
  updated_at              timestamptz not null default now()
);

drop trigger if exists tenant_settings_updated_at on public.tenant_settings;
create trigger tenant_settings_updated_at
  before update on public.tenant_settings
  for each row execute function public.set_updated_at();

insert into public.tenants (slug, name) values ('ddf', 'DDF x Pixel')
on conflict (slug) do nothing;

insert into public.tenant_settings (tenant_id, business_name, reply_to_email, brand_color, logo_url, plan, plan_status)
select id, 'DDF x Pixel', 'hello@ddfevents.ca', '#b8955a', '/logo-ddfpixel.png', 'pro', 'active'
from public.tenants where slug = 'ddf'
on conflict (tenant_id) do nothing;

-- ── Jobs ─────────────────────────────────────────────────────────────
-- ids start at 1,000,000 so Phase 2 can import legacy rows with their original
-- ids (old review/portal links sign the job id) without collisions (spec D13).
create table if not exists public.jobs (
  id                bigint generated always as identity (start with 1000000) primary key,
  tenant_id         uuid not null references public.tenants(id),
  reference_number  text not null unique,
  submission_id     uuid not null unique,
  client_name       text not null,
  company_name      text not null,
  contact_email     text not null,
  event_name        text,
  date_required     date not null,
  notes             text,
  setup_location    text,
  setup_time        text,
  removal_location  text,
  removal_time      text,
  items             jsonb not null default '[]'::jsonb,
  file_paths        text[] not null default '{}',
  production        jsonb not null default '{}'::jsonb,
  notify_client     boolean not null default false,
  status            text not null default 'pending'
                    check (status in ('pending','received','in_progress','completed','cancelled')),
  submitted_at      timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

do $$
declare ddf uuid;
begin
  select id into ddf from public.tenants where slug = 'ddf';
  execute format('alter table public.jobs alter column tenant_id set default %L', ddf);
end $$;

drop trigger if exists jobs_updated_at on public.jobs;
create trigger jobs_updated_at
  before update on public.jobs
  for each row execute function public.set_updated_at();

create index if not exists jobs_contact_email_idx  on public.jobs (contact_email);
create index if not exists jobs_status_idx         on public.jobs (status);
create index if not exists jobs_submitted_at_idx   on public.jobs (submitted_at desc);
create index if not exists jobs_tenant_idx         on public.jobs (tenant_id);
create index if not exists jobs_reference_lower_idx on public.jobs (lower(reference_number));

-- ── Design library ───────────────────────────────────────────────────
create table if not exists public.design_library (
  id          bigint generated always as identity (start with 1000000) primary key,
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null,
  path        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists design_library_tenant_idx
  on public.design_library (tenant_id, created_at desc);

-- ── Kanban retry queue ───────────────────────────────────────────────
create table if not exists public.kanban_sync_queue (
  job_id          bigint primary key references public.jobs(id) on delete cascade,
  job_label       text not null,
  reason          text not null,
  last_error      text,
  attempts        int  not null default 0,
  first_failed_at timestamptz not null default now(),
  last_attempt_at timestamptz not null default now()
);

-- ── Admin logins (replaces Supabase Auth) ────────────────────────────
create table if not exists public.admin_users (
  id             bigint generated always as identity primary key,
  email          text not null unique check (email = lower(btrim(email))),
  password_hash  text not null,
  created_at     timestamptz not null default now(),
  last_login_at  timestamptz
);

-- ── Atomic item update (verbatim from SUPABASE_APPROVAL_RACE_FIX.sql) ─
create or replace function public.update_job_item(
  p_job_id          bigint,
  p_index           int,
  p_patch           jsonb,
  p_append_message  jsonb default null
) returns jsonb
language plpgsql
as $$
declare
  v_items jsonb;
  v_item  jsonb;
begin
  select items into v_items from jobs where id = p_job_id for update;
  if v_items is null then
    raise exception 'job % not found', p_job_id;
  end if;

  v_item := v_items -> p_index;
  if v_item is null then
    raise exception 'item % not found in job %', p_index, p_job_id;
  end if;

  v_item := v_item || p_patch;

  if p_append_message is not null then
    v_item := jsonb_set(
      v_item,
      '{messages}',
      coalesce(v_item -> 'messages', '[]'::jsonb) || jsonb_build_array(p_append_message)
    );
  end if;

  v_items := jsonb_set(v_items, array[p_index::text], v_item);
  update jobs set items = v_items where id = p_job_id;
  return v_items;
end;
$$;

-- ── Atomic append (verbatim from SUPABASE_APPEND_TO_JOB.sql) ─────────
create or replace function public.append_to_job(
  p_job_id  bigint,
  p_items   jsonb,
  p_files   text[] default '{}'
) returns jsonb
language plpgsql
as $$
declare
  v_items jsonb;
  v_files text[];
begin
  select items, file_paths into v_items, v_files
  from jobs where id = p_job_id for update;
  if v_items is null then
    raise exception 'job % not found', p_job_id;
  end if;

  v_items := v_items || coalesce(p_items, '[]'::jsonb);
  v_files := array_cat(coalesce(v_files, '{}'), coalesce(p_files, '{}'));

  update jobs set items = v_items, file_paths = v_files where id = p_job_id;

  return jsonb_build_object('items', v_items, 'file_paths', to_jsonb(v_files));
end;
$$;
```

- [ ] **Step 4: Prove no `jobs` column is missing.** The live Supabase DB had columns added in its dashboard (e.g. `notify_client`). List every column name the code touches and compare:

```bash
grep -rhoE "\.select\('[^']+'\)|\.update\(\{[^}]*\}|\.insert\(\{" src | head -50
grep -rhoE "\b(patch|body)\.[a-z_]+\b" src/app/api | sort -u
```
Every `jobs` column found must exist in `db/schema.sql`. Known set: `id, tenant_id, reference_number, submission_id, client_name, company_name, contact_email, event_name, date_required, notes, setup_location, setup_time, removal_location, removal_time, items, file_paths, production, notify_client, status, submitted_at, updated_at`. If grep shows another top-level column, add it to `db/schema.sql` (nullable, no default) before continuing.

- [ ] **Step 5: Create `docker-compose.yml` (db only for now)**

```yaml
name: ddf-intake

services:
  db:
    image: postgres:17-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: ddf
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD in .env}
      POSTGRES_DB: ddf
    volumes:
      - ddf_pgdata:/var/lib/postgresql/data
      - ./db/schema.sql:/docker-entrypoint-initdb.d/10-schema.sql:ro
      - ./db/test-db.sql:/docker-entrypoint-initdb.d/20-test-db.sql:ro
    ports:
      - "127.0.0.1:5433:5432"   # localhost only — for scripts and tests
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ddf -d ddf"]
      interval: 5s
      timeout: 3s
      retries: 20

volumes:
  ddf_pgdata:
```

- [ ] **Step 6: Start it and apply the schema to the extra databases**

```bash
docker compose up -d db
docker compose exec -T db sh -c 'until pg_isready -U ddf -d ddf; do sleep 1; done'
for d in ddf_test ddf_dev; do docker compose exec -T db psql -U ddf -d $d -v ON_ERROR_STOP=1 -q < db/schema.sql; done
docker compose exec -T db psql -U ddf -d ddf -Atc "select slug from tenants"
```
Expected: last command prints `ddf`.

- [ ] **Step 7: Add the test DB URL to `.env`**

```bash
source .env && echo "TEST_DATABASE_URL=postgres://ddf:${POSTGRES_PASSWORD}@127.0.0.1:5433/ddf_test" >> .env
```

- [ ] **Step 8: Create `tests/helpers/db.ts`**

```ts
import postgres from 'postgres'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

// Loads TEST_DATABASE_URL from .env when not already in the environment.
function loadDotEnv(): void {
  if (process.env.TEST_DATABASE_URL) return
  try {
    for (const line of readFileSync('.env', 'utf8').split('\n')) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
    }
  } catch { /* no .env — DB suites will skip */ }
}
loadDotEnv()

export const TEST_URL = process.env.TEST_DATABASE_URL ?? ''
export const hasDb = TEST_URL !== ''

/** Apply db/schema.sql to ddf_test via psql inside the container ($$ bodies need psql). */
export function applySchema(): void {
  execFileSync(
    'docker',
    ['compose', 'exec', '-T', 'db', 'psql', '-U', 'ddf', '-d', 'ddf_test', '-v', 'ON_ERROR_STOP=1', '-q'],
    { input: readFileSync('db/schema.sql') },
  )
}

/** Empty every app table (tenants stay seeded) and restart identities at their START values. */
export async function resetTables(): Promise<void> {
  const sql = postgres(TEST_URL, { max: 1, onnotice: () => {} })
  await sql`truncate jobs, design_library, kanban_sync_queue, admin_users restart identity cascade`
  await sql.end()
}

/** A throwaway client for assertions that bypass the app code. */
export function rawSql() {
  return postgres(TEST_URL, { max: 1, onnotice: () => {} })
}
```

- [ ] **Step 9: Write the failing schema test — `tests/schema.test.ts`**

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { hasDb, applySchema, resetTables, rawSql } from './helpers/db'

describe.skipIf(!hasDb)('db/schema.sql', () => {
  beforeAll(() => applySchema())

  it('is idempotent (applies twice without error)', () => {
    expect(() => applySchema()).not.toThrow()
  })

  it('seeds the ddf tenant with branding', async () => {
    const sql = rawSql()
    const [row] = await sql`
      select t.slug, s.brand_color, s.reply_to_email
      from tenants t join tenant_settings s on s.tenant_id = t.id where t.slug = 'ddf'`
    await sql.end()
    expect(row).toEqual({ slug: 'ddf', brand_color: '#b8955a', reply_to_email: 'hello@ddfevents.ca' })
  })

  it('starts job ids at 1,000,000 and defaults tenant_id + notify_client', async () => {
    await resetTables()
    const sql = rawSql()
    const [row] = await sql`
      insert into jobs (reference_number, submission_id, client_name, company_name, contact_email, date_required)
      values ('DDF-SCHEMA-1', gen_random_uuid(), 'A', 'B', 'a@b.co', '2030-01-01')
      returning id::int as id, tenant_id is not null as has_tenant, notify_client, status`
    await sql.end()
    expect(row).toEqual({ id: 1000000, has_tenant: true, notify_client: false, status: 'pending' })
  })

  it('rejects a non-normalized admin email', async () => {
    const sql = rawSql()
    await expect(sql`insert into admin_users (email, password_hash) values ('Tony@X.com', 'h')`).rejects.toThrow()
    await sql.end()
  })
})
```

- [ ] **Step 10: Run it**

Run: `npx vitest run tests/schema.test.ts`
Expected: 4 passed. (If the suite shows "skipped", `TEST_DATABASE_URL` isn't in `.env` — redo Step 7.)

- [ ] **Step 11: Commit**

```bash
git add db/ docker-compose.yml tests/helpers/db.ts tests/schema.test.ts
git commit -m "feat(db): canonical Postgres schema + local db container"
```

---

### Task 3: DB client with Supabase-compatible types

Supabase (PostgREST) returned `date` as `'YYYY-MM-DD'`, `timestamptz` as ISO strings, and `bigint` ids as JSON numbers. The `postgres` library defaults to `Date` objects and bigint *strings*, which would silently break `j.id === jobId` comparisons and date logic. These parsers keep every route seeing the same shapes.

**Files:**
- Create: `src/lib/pg-time.ts`, `src/lib/db.ts`, `tests/pg-time.test.ts`, `tests/db.test.ts`

- [ ] **Step 1: Write the failing test — `tests/pg-time.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { pgTimestampToIso } from '@/lib/pg-time'

describe('pgTimestampToIso', () => {
  it.each([
    ['2026-06-22 14:03:11.123456+00', '2026-06-22T14:03:11.123+00:00'],
    ['2026-06-22 14:03:11+00',        '2026-06-22T14:03:11.000+00:00'],
    ['2026-06-22 09:03:11.5-05',      '2026-06-22T09:03:11.500-05:00'],
    ['2026-06-22 14:03:11.1+05:30',   '2026-06-22T14:03:11.100+05:30'],
  ])('%s → %s', (input, expected) => {
    expect(pgTimestampToIso(input)).toBe(expected)
  })

  it('produces the same instant JS Date would expect', () => {
    expect(new Date(pgTimestampToIso('2026-06-22 09:03:11.5-05')).toISOString()).toBe('2026-06-22T14:03:11.500Z')
  })

  it('passes unknown formats through unchanged', () => {
    expect(pgTimestampToIso('infinity')).toBe('infinity')
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/pg-time.test.ts`
Expected: FAIL — cannot find module `@/lib/pg-time`.

- [ ] **Step 3: Implement `src/lib/pg-time.ts`**

```ts
// Postgres sends timestamptz as text like "2026-06-22 14:03:11.123456+00".
// Supabase/PostgREST returned ISO strings, and app code expects strings, so
// convert to "2026-06-22T14:03:11.123+00:00" (millisecond precision).
const TS = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d+)?([+-]\d{2})(?::?(\d{2}))?$/

export function pgTimestampToIso(value: string): string {
  const m = TS.exec(value)
  if (!m) return value
  const [, date, time, frac, offH, offM = '00'] = m
  const ms = frac ? frac.slice(0, 4).padEnd(4, '0') : '.000'
  return `${date}T${time}${ms}${offH}:${offM}`
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run tests/pg-time.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Write the failing DB-client test — `tests/db.test.ts`**

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { hasDb, TEST_URL } from './helpers/db'

describe.skipIf(!hasDb)('db() type parsers', () => {
  let db: typeof import('@/lib/db').db
  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_URL
    db = (await import('@/lib/db')).db
  })

  it('returns date as YYYY-MM-DD, timestamptz as ISO string, int8 as number', async () => {
    const [row] = await db()`select '2026-06-22'::date as d, '2026-06-22 14:03:11.5+00'::timestamptz as t, 1000001::bigint as b`
    expect(row.d).toBe('2026-06-22')
    expect(row.t).toBe('2026-06-22T14:03:11.500+00:00')
    expect(row.b).toBe(1000001)
  })

  it('parses jsonb and text[]', async () => {
    const [row] = await db()`select '{"a":[1,2]}'::jsonb as j, array['x','y']::text[] as arr, '{}'::text[] as empty`
    expect(row.j).toEqual({ a: [1, 2] })
    expect(row.arr).toEqual(['x', 'y'])
    expect(row.empty).toEqual([])
  })

})
```

- [ ] **Step 6: Run it to see it fail**

Run: `npx vitest run tests/db.test.ts`
Expected: FAIL — cannot find module `@/lib/db`.

- [ ] **Step 7: Implement `src/lib/db.ts`**

```ts
import 'server-only'
import postgres from 'postgres'
import { pgTimestampToIso } from '@/lib/pg-time'

// One lazily-created connection pool per server process. Created on first use
// (not at import) so `next build` works without a database.
export function makeSql(url: string) {
  return postgres(url, {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {},
    types: {
      // Parsers are keyed by Postgres type OID and override the library defaults.
      date: {
        to: 1082,
        from: [1082],
        serialize: (x: string) => x,
        parse: (x: string) => x, // keep 'YYYY-MM-DD'
      },
      timestamptz: {
        to: 1184,
        from: [1114, 1184],
        serialize: (x: string | Date) => (x instanceof Date ? x.toISOString() : x),
        parse: (x: string) => pgTimestampToIso(x),
      },
      int8: {
        to: 20,
        from: [20],
        serialize: (x: number | bigint) => x.toString(),
        parse: (x: string) => Number(x), // ids stay < 2^53
      },
    },
  })
}

export type Sql = ReturnType<typeof makeSql>

let client: Sql | null = null

export function db(): Sql {
  if (client) return client
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  client = makeSql(url)
  return client
}
```

- [ ] **Step 8: Run it to see it pass**

Run: `npx vitest run tests/db.test.ts`
Expected: 2 passed. If `row.t` or `row.b` comes back as a `Date`/string, the library ignored the override — check `node_modules/postgres/README.md` ("Custom Types") for the current option shape and adjust `types` until the test passes. Don't change the test.

- [ ] **Step 9: Commit**

```bash
git add src/lib/pg-time.ts src/lib/db.ts tests/pg-time.test.ts tests/db.test.ts
git commit -m "feat(db): postgres client with Supabase-compatible type parsers"
```

---

### Task 4: Repos for jobs and the design library

Routes keep their `const { data, error } = await …` shape; only the call changes. Repo functions never throw — they log and return `{ data: null, error }`.

**Files:**
- Create: `src/lib/jobs-repo.ts`, `src/lib/library-repo.ts`, `tests/jobs-repo.test.ts`, `tests/library-repo.test.ts`
- Modify: `src/lib/tenant.ts` (needed by tests; full change in Task 10, done here)

- [ ] **Step 1: Switch `src/lib/tenant.ts` to SQL now** (the repo tests need `getDefaultTenantId`). Replace the whole file with:

```ts
import 'server-only'
import { db } from '@/lib/db'

// Tenant resolution. Only the server connects to the database, so tenant
// isolation on server paths is enforced HERE, in app code, by always scoping
// queries to a resolved tenant_id.

export const DEFAULT_TENANT_SLUG = 'ddf'

// Cache slug → id for the lifetime of the server instance (tenants are static).
const idBySlug = new Map<string, string>()

/** Resolve a tenant's id from its slug, or null if it doesn't exist. */
export async function getTenantIdBySlug(slug: string): Promise<string | null> {
  const cached = idBySlug.get(slug)
  if (cached) return cached
  try {
    const rows = await db()<{ id: string }[]>`select id from tenants where slug = ${slug}`
    if (!rows[0]) return null
    idBySlug.set(slug, rows[0].id)
    return rows[0].id
  } catch (e) {
    console.error('[tenant] lookup failed:', e)
    return null
  }
}

/** The default workspace id (DDF). Throws if the tenant row is missing. */
export async function getDefaultTenantId(): Promise<string> {
  const id = await getTenantIdBySlug(DEFAULT_TENANT_SLUG)
  if (!id) throw new Error(`Default tenant "${DEFAULT_TENANT_SLUG}" not found — apply db/schema.sql`)
  return id
}
```
(`getTenantIdForUser` is gone: there is no `tenant_members` table any more — spec D11.)

- [ ] **Step 2: Write the failing test — `tests/jobs-repo.test.ts`**

```ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { hasDb, TEST_URL, applySchema, resetTables } from './helpers/db'

describe.skipIf(!hasDb)('jobs-repo', () => {
  let repo: typeof import('@/lib/jobs-repo')
  let tenantId: string

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_URL
    applySchema()
    repo = await import('@/lib/jobs-repo')
    tenantId = await (await import('@/lib/tenant')).getDefaultTenantId()
  })
  beforeEach(async () => { await resetTables() })

  const newJob = (over: Partial<import('@/lib/jobs-repo').NewJob> = {}): import('@/lib/jobs-repo').NewJob => ({
    tenant_id: tenantId,
    reference_number: `DDF-TEST-${randomUUID().slice(0, 6).toUpperCase()}`,
    client_name: 'Ana', company_name: 'Acme', contact_email: 'ana@acme.co',
    event_name: null, date_required: '2030-01-02', notes: null,
    setup_location: null, setup_time: null, removal_location: null, removal_time: null,
    items: [{ name: 'Item', quantity: 1 }], file_paths: [],
    submission_id: randomUUID(), submitted_at: new Date().toISOString(), status: 'pending',
    ...over,
  })

  it('insertJob → ids from 1,000,000; getJob returns Supabase-shaped values', async () => {
    const ins = await repo.insertJob(newJob())
    expect(ins.error).toBeNull()
    expect(ins.data!.id).toBe(1000000)
    const { data: row } = await repo.getJob(ins.data!.id, ['id', 'date_required', 'submitted_at', 'items', 'file_paths', 'notify_client'])
    expect(row).toMatchObject({ id: 1000000, date_required: '2030-01-02', file_paths: [], notify_client: false, items: [{ name: 'Item', quantity: 1 }] })
    expect(row!.submitted_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/)
  })

  it('getJob scopes by tenant and returns null data when missing', async () => {
    const { data } = await repo.insertJob(newJob())
    expect((await repo.getJob(data!.id, ['id'], '00000000-0000-0000-0000-000000000000')).data).toBeNull()
    expect((await repo.getJob(999, ['id'])).data).toBeNull()
  })

  it('updateJob writes whitelisted columns, including json and empty arrays', async () => {
    const { data } = await repo.insertJob(newJob({ file_paths: ['uploads/a.pdf'] }))
    const upd = await repo.updateJob(data!.id, { status: 'received', file_paths: [], production: { '2030-01-02': 'done' }, notify_client: true }, tenantId)
    expect(upd).toEqual({ data: 1, error: null })
    const { data: row } = await repo.getJob(data!.id, ['status', 'file_paths', 'production', 'notify_client'])
    expect(row).toEqual({ status: 'received', file_paths: [], production: { '2030-01-02': 'done' }, notify_client: true })
  })

  it('updateJob refuses columns that are not whitelisted', async () => {
    const { data } = await repo.insertJob(newJob())
    const res = await repo.updateJob(data!.id, { reference_number: 'HACK' })
    expect(res.data).toBeNull()
    expect(res.error?.message).toMatch(/not allowed/)
  })

  it('updateJobItem: 10 parallel approvals all persist (row lock)', async () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ name: `I${i}`, quantity: 1 }))
    const { data } = await repo.insertJob(newJob({ items }))
    const results = await Promise.all(items.map((_, i) => repo.updateJobItem(data!.id, i, { approval_status: 'approved' }, null)))
    expect(results.every(r => r.error === null)).toBe(true)
    const { data: row } = await repo.getJob(data!.id, ['items'])
    expect((row!.items as { approval_status?: string }[]).every(it => it.approval_status === 'approved')).toBe(true)
  })

  it('updateJobItem appends a chat message and returns the items', async () => {
    const { data } = await repo.insertJob(newJob())
    const msg = { from: 'client', text: 'Hi', at: '2030-01-01T00:00:00Z' }
    const { data: items } = await repo.updateJobItem(data!.id, 0, { client_note: 'Hi' }, msg)
    expect(items![0]).toMatchObject({ client_note: 'Hi', messages: [msg] })
  })

  it('updateJobItem reports an error for a missing item', async () => {
    const { data } = await repo.insertJob(newJob())
    expect((await repo.updateJobItem(data!.id, 5, { a: 1 }, null)).error).not.toBeNull()
  })

  it('appendToJob appends items and files', async () => {
    const { data } = await repo.insertJob(newJob({ file_paths: ['uploads/a.pdf'] }))
    const { data: res } = await repo.appendToJob(data!.id, [{ name: 'New', quantity: 2 }], ['uploads/b.pdf'])
    expect(res!.items).toHaveLength(2)
    expect(res!.file_paths).toEqual(['uploads/a.pdf', 'uploads/b.pdf'])
  })

  it('finds by reference (case-insensitive), by reference exact, and by submission id', async () => {
    const job = newJob({ reference_number: 'DDF-20300101-ABC123' })
    const { data } = await repo.insertJob(job)
    expect((await repo.findJobsByReferenceCI('ddf-20300101-abc123')).data).toEqual([{ id: data!.id, contact_email: 'ana@acme.co' }])
    expect((await repo.getJobByReference('DDF-20300101-ABC123', ['id'])).data).toEqual({ id: data!.id })
    expect((await repo.findJobBySubmissionId(job.submission_id)).data).toEqual({ reference_number: 'DDF-20300101-ABC123' })
  })

  it('listJobs is newest-first; listJobFiles returns paths and items', async () => {
    await repo.insertJob(newJob({ submitted_at: '2030-01-01T00:00:00Z', file_paths: ['uploads/old.pdf'] }))
    await repo.insertJob(newJob({ submitted_at: '2030-02-01T00:00:00Z' }))
    const { data: list } = await repo.listJobs(tenantId)
    expect(list!.map(j => j.submitted_at.slice(0, 7))).toEqual(['2030-02', '2030-01'])
    const { data: files } = await repo.listJobFiles(tenantId)
    expect(files!.flatMap(f => f.file_paths)).toContain('uploads/old.pdf')
  })
})
```

- [ ] **Step 3: Run it to see it fail**

Run: `npx vitest run tests/jobs-repo.test.ts`
Expected: FAIL — cannot find module `@/lib/jobs-repo`.

- [ ] **Step 4: Implement `src/lib/jobs-repo.ts`**

```ts
import 'server-only'
import type postgres from 'postgres'
import { db } from '@/lib/db'

// All `jobs` queries. Results mirror supabase-js ({ data, error }) so routes keep
// their existing control flow. Functions never throw.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>
export type Result<T> = { data: T | null; error: Error | null }

export type JobColumn =
  | 'id' | 'tenant_id' | 'reference_number' | 'submission_id' | 'client_name' | 'company_name'
  | 'contact_email' | 'event_name' | 'date_required' | 'notes' | 'setup_location' | 'setup_time'
  | 'removal_location' | 'removal_time' | 'items' | 'file_paths' | 'production' | 'notify_client'
  | 'status' | 'submitted_at' | 'updated_at'

export interface NewJob {
  tenant_id: string
  reference_number: string
  client_name: string
  company_name: string
  contact_email: string
  event_name: string | null
  date_required: string
  notes: string | null
  setup_location: string | null
  setup_time: string | null
  removal_location: string | null
  removal_time: string | null
  items: unknown[]
  file_paths: string[]
  submission_id: string
  submitted_at: string
  status: string
}

const UPDATABLE = new Set<string>([
  'status', 'notify_client', 'date_required', 'event_name', 'notes', 'setup_location', 'setup_time',
  'removal_location', 'removal_time', 'items', 'file_paths', 'production',
])
const JSON_COLUMNS = new Set<string>(['items', 'production'])
const ARRAY_COLUMNS = new Set<string>(['file_paths'])

async function attempt<T>(label: string, fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { data: await fn(), error: null }
  } catch (e) {
    console.error(`[jobs-repo] ${label} failed:`, e)
    return { data: null, error: e instanceof Error ? e : new Error(String(e)) }
  }
}

const json = (v: unknown) => db().json(v as postgres.JSONValue)

export function getJob(id: number, columns: JobColumn[], tenantId?: string): Promise<Result<Row>> {
  return attempt('getJob', async () => {
    const sql = db()
    const rows = tenantId
      ? await sql`select ${sql(columns)} from jobs where id = ${id} and tenant_id = ${tenantId}`
      : await sql`select ${sql(columns)} from jobs where id = ${id}`
    return (rows[0] as Row | undefined) ?? null
  })
}

export function getJobByReference(reference: string, columns: JobColumn[]): Promise<Result<Row>> {
  return attempt('getJobByReference', async () => {
    const sql = db()
    const rows = await sql`select ${sql(columns)} from jobs where reference_number = ${reference}`
    return (rows[0] as Row | undefined) ?? null
  })
}

export function findJobBySubmissionId(submissionId: string): Promise<Result<Row>> {
  return attempt('findJobBySubmissionId', async () => {
    const rows = await db()`select reference_number from jobs where submission_id = ${submissionId}`
    return (rows[0] as Row | undefined) ?? null
  })
}

/** Case-insensitive reference match (clients retype these by hand). Equality, not LIKE. */
export function findJobsByReferenceCI(reference: string): Promise<Result<Row[]>> {
  return attempt('findJobsByReferenceCI', async () => {
    const rows = await db()`
      select id, contact_email from jobs where lower(reference_number) = lower(${reference}) limit 5`
    return rows as unknown as Row[]
  })
}

export function listJobs(tenantId: string): Promise<Result<Row[]>> {
  return attempt('listJobs', async () => {
    const rows = await db()`select * from jobs where tenant_id = ${tenantId} order by submitted_at desc`
    return rows as unknown as Row[]
  })
}

export function listJobFiles(tenantId: string): Promise<Result<Row[]>> {
  return attempt('listJobFiles', async () => {
    const rows = await db()`select file_paths, items from jobs where tenant_id = ${tenantId}`
    return rows as unknown as Row[]
  })
}

export function insertJob(j: NewJob): Promise<Result<{ id: number }>> {
  return attempt('insertJob', async () => {
    const sql = db()
    const [row] = await sql`
      insert into jobs (
        tenant_id, reference_number, client_name, company_name, contact_email, event_name,
        date_required, notes, setup_location, setup_time, removal_location, removal_time,
        items, file_paths, submission_id, submitted_at, status
      ) values (
        ${j.tenant_id}, ${j.reference_number}, ${j.client_name}, ${j.company_name}, ${j.contact_email}, ${j.event_name},
        ${j.date_required}, ${j.notes}, ${j.setup_location}, ${j.setup_time}, ${j.removal_location}, ${j.removal_time},
        ${json(j.items)}, ${sql.array(j.file_paths)}::text[], ${j.submission_id}, ${j.submitted_at}, ${j.status}
      ) returning id`
    return { id: row.id as number }
  })
}

/**
 * Update whitelisted columns. Returns the number of rows changed (0 when the
 * job doesn't exist or belongs to another tenant — same as supabase-js).
 */
export function updateJob(id: number, patch: Record<string, unknown>, tenantId?: string): Promise<Result<number>> {
  return attempt('updateJob', async () => {
    const sql = db()
    const keys = Object.keys(patch)
    if (keys.length === 0) return 0
    const values: Record<string, unknown> = {}
    for (const k of keys) {
      if (!UPDATABLE.has(k)) throw new Error(`updateJob: column not allowed: ${k}`)
      const v = patch[k]
      values[k] = JSON_COLUMNS.has(k) ? json(v) : ARRAY_COLUMNS.has(k) ? sql.array((v ?? []) as string[]) : v
    }
    const rows = tenantId
      ? await sql`update jobs set ${sql(values, keys)} where id = ${id} and tenant_id = ${tenantId} returning id`
      : await sql`update jobs set ${sql(values, keys)} where id = ${id} returning id`
    return rows.length
  })
}

/** Row-locked single-item update (replaces rpc('update_job_item')). Returns the full items array. */
export function updateJobItem(jobId: number, index: number, patch: unknown, appendMessage: unknown): Promise<Result<unknown[]>> {
  return attempt('updateJobItem', async () => {
    const msg = appendMessage === null || appendMessage === undefined ? null : json(appendMessage)
    const [row] = await db()`select update_job_item(${jobId}, ${index}, ${json(patch)}, ${msg}) as items`
    return row.items as unknown[]
  })
}

/** Row-locked append (replaces rpc('append_to_job')). */
export function appendToJob(jobId: number, items: unknown[], files: string[]): Promise<Result<{ items: unknown[]; file_paths: string[] }>> {
  return attempt('appendToJob', async () => {
    const sql = db()
    const [row] = await sql`select append_to_job(${jobId}, ${json(items)}, ${sql.array(files)}::text[]) as result`
    return row.result as { items: unknown[]; file_paths: string[] }
  })
}
```

- [ ] **Step 5: Run it to see it pass**

Run: `npx vitest run tests/jobs-repo.test.ts`
Expected: 10 passed. If an empty-array case fails with a type error from `sql.array([])`, pass the text-array OID explicitly: `sql.array(v, 1009)` (check the signature in `node_modules/postgres/types/index.d.ts`). Re-run until green.

- [ ] **Step 6: Write the failing test — `tests/library-repo.test.ts`**

```ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { hasDb, TEST_URL, applySchema, resetTables } from './helpers/db'

describe.skipIf(!hasDb)('library-repo', () => {
  let lib: typeof import('@/lib/library-repo')
  let tenantId: string
  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_URL
    applySchema()
    lib = await import('@/lib/library-repo')
    tenantId = await (await import('@/lib/tenant')).getDefaultTenantId()
  })
  beforeEach(async () => { await resetTables() })

  it('inserts, lists newest-first, and deletes only within the tenant', async () => {
    const a = await lib.insertLibraryEntry(tenantId, 'White stage', 'uploads/a.png')
    const b = await lib.insertLibraryEntry(tenantId, 'Backdrop', 'uploads/b.png')
    expect(a.data).toMatchObject({ id: 1000000, name: 'White stage', path: 'uploads/a.png' })
    expect((await lib.listLibrary(tenantId)).data!.map(r => r.name)).toEqual(['Backdrop', 'White stage'])
    expect((await lib.deleteLibraryEntry(b.data!.id, '00000000-0000-0000-0000-000000000000')).data).toBe(0)
    expect((await lib.deleteLibraryEntry(b.data!.id, tenantId)).data).toBe(1)
    expect((await lib.listLibrary(tenantId)).data).toHaveLength(1)
  })
})
```

- [ ] **Step 7: Run it to see it fail**

Run: `npx vitest run tests/library-repo.test.ts`
Expected: FAIL — cannot find module `@/lib/library-repo`.

- [ ] **Step 8: Implement `src/lib/library-repo.ts`**

```ts
import 'server-only'
import { db } from '@/lib/db'
import type { Result } from '@/lib/jobs-repo'

export interface LibraryRow { id: number; name: string; path: string; created_at: string }

async function attempt<T>(label: string, fn: () => Promise<T>): Promise<Result<T>> {
  try { return { data: await fn(), error: null } }
  catch (e) {
    console.error(`[library-repo] ${label} failed:`, e)
    return { data: null, error: e instanceof Error ? e : new Error(String(e)) }
  }
}

export function listLibrary(tenantId: string): Promise<Result<LibraryRow[]>> {
  return attempt('list', async () =>
    db()<LibraryRow[]>`select id, name, path, created_at from design_library
      where tenant_id = ${tenantId} order by created_at desc, id desc`)
}

export function insertLibraryEntry(tenantId: string, name: string, path: string): Promise<Result<LibraryRow>> {
  return attempt('insert', async () => {
    const [row] = await db()<LibraryRow[]>`insert into design_library (tenant_id, name, path)
      values (${tenantId}, ${name}, ${path}) returning id, name, path, created_at`
    return row
  })
}

/** Returns rows deleted (0 when the id isn't in this tenant). Never deletes the file itself. */
export function deleteLibraryEntry(id: number, tenantId: string): Promise<Result<number>> {
  return attempt('delete', async () =>
    (await db()`delete from design_library where id = ${id} and tenant_id = ${tenantId} returning id`).length)
}
```

- [ ] **Step 9: Run both suites**

Run: `npx vitest run tests/jobs-repo.test.ts tests/library-repo.test.ts`
Expected: all passed.

- [ ] **Step 10: Commit**

```bash
git add src/lib/jobs-repo.ts src/lib/library-repo.ts src/lib/tenant.ts tests/jobs-repo.test.ts tests/library-repo.test.ts
git commit -m "feat(db): jobs + design-library repos (supabase-shaped results)"
```

---

### Task 5: File store (local disk, same keys as Supabase)

**Files:**
- Create: `src/lib/file-store.ts`, `tests/file-store.test.ts`

- [ ] **Step 1: Write the failing test — `tests/file-store.test.ts`**

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { isSafeKey, filePath, writeStream, exists, remove, TooLargeError } from '@/lib/file-store'

const dir = mkdtempSync(path.join(tmpdir(), 'ddf-files-'))
const streamOf = (buf: Buffer) => new Blob([buf]).stream()

describe('file-store', () => {
  beforeAll(() => { process.env.FILES_DIR = dir })

  it('accepts real upload keys and rejects traversal / odd keys', () => {
    expect(isSafeKey('uploads/1763241122000-k3j2h1.pdf')).toBe(true)
    for (const bad of ['../etc/passwd', '/abs.pdf', 'uploads/../x', 'uploads//x', '', 'a b.pdf', 'x'.repeat(301)]) {
      expect(isSafeKey(bad)).toBe(false)
    }
    expect(() => filePath('../x')).toThrow(/unsafe/)
  })

  it('writes atomically and reports existence', async () => {
    const n = await writeStream('uploads/a.pdf', streamOf(Buffer.from('hello')), 100)
    expect(n).toBe(5)
    expect(readFileSync(path.join(dir, 'uploads/a.pdf'), 'utf8')).toBe('hello')
    expect(await exists('uploads/a.pdf')).toBe(true)
    expect(await exists('uploads/nope.pdf')).toBe(false)
  })

  it('rejects oversize bodies and leaves no partial file', async () => {
    await expect(writeStream('uploads/big.pdf', streamOf(Buffer.alloc(200)), 100)).rejects.toBeInstanceOf(TooLargeError)
    expect(existsSync(path.join(dir, 'uploads/big.pdf'))).toBe(false)
    expect(readdirSync(path.join(dir, 'uploads')).some(f => f.includes('.part-'))).toBe(false)
  })

  it('remove deletes safe keys and ignores unsafe or missing ones', async () => {
    await remove(['uploads/a.pdf', '../x', 'uploads/missing.pdf'])
    expect(await exists('uploads/a.pdf')).toBe(false)
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/file-store.test.ts`
Expected: FAIL — cannot find module `@/lib/file-store`.

- [ ] **Step 3: Implement `src/lib/file-store.ts`**

```ts
import 'server-only'
import path from 'node:path'
import { promises as fsp, createReadStream, createWriteStream } from 'node:fs'
import { randomBytes } from 'node:crypto'

// Client files on local disk, under the exact keys Supabase Storage used
// (e.g. "uploads/1763241122000-k3j2h1.pdf"), so DB paths never need rewriting.

export function filesRoot(): string {
  return process.env.FILES_DIR || '/data/files'
}

const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/

export function isSafeKey(key: string): boolean {
  return key.length > 0 && key.length <= 300 && KEY_RE.test(key) && !key.includes('..') && !key.includes('//')
}

export function filePath(key: string): string {
  if (!isSafeKey(key)) throw new Error(`unsafe file key: ${key}`)
  const root = path.resolve(filesRoot())
  const full = path.resolve(root, key)
  if (!full.startsWith(root + path.sep)) throw new Error(`unsafe file key: ${key}`)
  return full
}

export class TooLargeError extends Error {
  constructor() { super('file too large') }
}

export async function exists(key: string): Promise<boolean> {
  try { return (await fsp.stat(filePath(key))).isFile() } catch { return false }
}

export async function stat(key: string) {
  return fsp.stat(filePath(key))
}

export function readStream(key: string) {
  return createReadStream(filePath(key))
}

/** Delete files; unsafe keys and missing files are ignored (mirrors storage.remove). */
export async function remove(keys: string[]): Promise<void> {
  await Promise.all(keys.filter(isSafeKey).map(k => fsp.rm(filePath(k), { force: true })))
}

/**
 * Stream a request body to `key`. Written to a temp file and renamed into place,
 * so a failed or oversize upload never leaves a partial file under the real key.
 */
export async function writeStream(key: string, body: ReadableStream<Uint8Array>, maxBytes: number): Promise<number> {
  const dest = filePath(key)
  await fsp.mkdir(path.dirname(dest), { recursive: true })
  const tmp = `${dest}.part-${randomBytes(6).toString('hex')}`
  const out = createWriteStream(tmp, { flags: 'wx' })
  const reader = body.getReader()
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) throw new TooLargeError()
      if (!out.write(value)) await new Promise<void>(resolve => out.once('drain', () => resolve()))
    }
    await new Promise<void>((resolve, reject) => { out.once('error', reject); out.end(() => resolve()) })
    await fsp.rename(tmp, dest)
    return total
  } catch (e) {
    out.destroy()
    await reader.cancel().catch(() => {})
    await fsp.rm(tmp, { force: true })
    throw e
  }
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run tests/file-store.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/file-store.ts tests/file-store.test.ts
git commit -m "feat(files): local file store with atomic streaming writes"
```

---

### Task 6: Signed upload tokens and long-lived file links

Supabase signed URLs were used for 1 hour (UI), 30 days (submit email) and 90 days (Kanban tickets). Our own HMAC tokens support any TTL.

**Files:**
- Create: `src/lib/file-tokens.ts`, `tests/file-tokens.test.ts`

- [ ] **Step 1: Write the failing test — `tests/file-tokens.test.ts`**

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { signUploadToken, verifyUploadToken, signUploadPath, signFileLink, verifyFileToken } from '@/lib/file-tokens'

describe('file-tokens', () => {
  beforeAll(() => {
    process.env.FILE_LINK_SECRET = 'test-file-secret-0123456789abcdef0123456789'
    process.env.PUBLIC_BASE_URL = 'https://jobs.example.com/'
  })

  it('round-trips an upload token', () => {
    const t = signUploadToken('uploads/a.pdf', 'application/pdf', 123)
    expect(verifyUploadToken(t)).toMatchObject({ key: 'uploads/a.pdf', type: 'application/pdf', size: 123 })
  })

  it('upload paths are relative (work on any host)', () => {
    expect(signUploadPath('uploads/a.pdf', 'application/pdf', 1)).toMatch(/^\/upload\/[\w-]+\.[\w-]+$/)
  })

  it('file links are absolute on PUBLIC_BASE_URL and verify', () => {
    const url = signFileLink('uploads/a.pdf', 60)
    expect(url.startsWith('https://jobs.example.com/f/')).toBe(true)
    expect(verifyFileToken(url.split('/f/')[1])?.key).toBe('uploads/a.pdf')
  })

  it('rejects expired links', () => {
    const tok = signFileLink('uploads/a.pdf', 60).split('/f/')[1]
    expect(verifyFileToken(tok, Date.now() + 61_000)).toBeNull()
  })

  it('rejects a tampered payload', () => {
    const tok = signFileLink('uploads/a.pdf', 60).split('/f/')[1]
    const sig = tok.split('.')[1]
    const forged = Buffer.from(JSON.stringify({ k: 'get', key: 'uploads/other.pdf', exp: 9_999_999_999 })).toString('base64url')
    expect(verifyFileToken(`${forged}.${sig}`)).toBeNull()
  })

  it('rejects an upload token used as a download link, and garbage', () => {
    expect(verifyFileToken(signUploadToken('uploads/a.pdf', 'x', 1))).toBeNull()
    expect(verifyFileToken('nope')).toBeNull()
    expect(verifyUploadToken('a.b')).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/file-tokens.test.ts`
Expected: FAIL — cannot find module `@/lib/file-tokens`.

- [ ] **Step 3: Implement `src/lib/file-tokens.ts`**

```ts
import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'

// Stateless HMAC tokens for uploads (PUT /upload/<token>) and downloads
// (GET /f/<token>). Rotate FILE_LINK_SECRET to invalidate every outstanding link.

type UploadClaims = { k: 'put'; key: string; type: string; size: number; exp: number }
type FileClaims = { k: 'get'; key: string; exp: number }

function secret(): string {
  const s = process.env.FILE_LINK_SECRET
  if (!s) throw new Error('FILE_LINK_SECRET is not set')
  return s
}

const mac = (payload: string) => createHmac('sha256', secret()).update(payload).digest('base64url')
const nowSeconds = () => Math.floor(Date.now() / 1000)

function sign(claims: UploadClaims | FileClaims): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  return `${payload}.${mac(payload)}`
}

function verify<T extends UploadClaims | FileClaims>(token: string, kind: T['k'], now = Date.now()): T | null {
  const dot = token.lastIndexOf('.')
  if (dot < 1) return null
  const payload = token.slice(0, dot)
  const expected = Buffer.from(mac(payload))
  const got = Buffer.from(token.slice(dot + 1))
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null
  let claims: T
  try { claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as T } catch { return null }
  if (claims.k !== kind || typeof claims.exp !== 'number' || claims.exp * 1000 < now) return null
  return claims
}

export function baseUrl(): string {
  return (process.env.PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '')
}

export function signUploadToken(key: string, type: string, size: number, ttlSeconds = 600): string {
  return sign({ k: 'put', key, type, size, exp: nowSeconds() + ttlSeconds })
}

/** Relative URL the browser PUTs the file to (same contract as Supabase's signedUrl). */
export function signUploadPath(key: string, type: string, size: number): string {
  return `/upload/${signUploadToken(key, type, size)}`
}

export function verifyUploadToken(token: string, now?: number): UploadClaims | null {
  return verify<UploadClaims>(token, 'put', now)
}

/** Absolute download link, safe to put in emails and Command Centre tickets. */
export function signFileLink(key: string, ttlSeconds: number): string {
  return `${baseUrl()}/f/${sign({ k: 'get', key, exp: nowSeconds() + ttlSeconds })}`
}

export function verifyFileToken(token: string, now?: number): FileClaims | null {
  return verify<FileClaims>(token, 'get', now)
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run tests/file-tokens.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/file-tokens.ts tests/file-tokens.test.ts
git commit -m "feat(files): HMAC upload tokens and long-lived file links"
```

---

### Task 7: Upload and download routes; switch `/api/upload-url`

The routes live **outside `/api`**, so `src/proxy.ts` (matcher `/api/*`, `/admin/*`) never runs on them and never buffers a 50 MB body.

**Files:**
- Create: `src/app/upload/[token]/route.ts`, `src/app/f/[token]/route.ts`, `tests/file-routes.test.ts`
- Modify: `src/app/api/upload-url/route.ts`

- [ ] **Step 1: Read the route-handler docs** for this Next version: `ls node_modules/next/dist/docs/` and open the route-handlers guide. Confirm `params` is a Promise and streaming `Response` bodies are supported.

- [ ] **Step 2: Write the failing test — `tests/file-routes.test.ts`**

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'

process.env.FILES_DIR = mkdtempSync(path.join(tmpdir(), 'ddf-routes-'))
process.env.FILE_LINK_SECRET = 'test-file-secret-0123456789abcdef0123456789'
process.env.PUBLIC_BASE_URL = 'http://localhost'

const ctx = (token: string) => ({ params: Promise.resolve({ token }) })

describe('/upload/[token] and /f/[token]', () => {
  let PUT: typeof import('@/app/upload/[token]/route').PUT
  let GET: typeof import('@/app/f/[token]/route').GET
  let tokens: typeof import('@/lib/file-tokens')
  beforeAll(async () => {
    PUT = (await import('@/app/upload/[token]/route')).PUT
    GET = (await import('@/app/f/[token]/route')).GET
    tokens = await import('@/lib/file-tokens')
  })

  const put = (token: string, body: Buffer, type: string) =>
    PUT(new NextRequest(`http://localhost/upload/${token}`, {
      method: 'PUT', body, headers: { 'content-type': type, 'content-length': String(body.length) },
    }), ctx(token))

  it('stores an upload and serves it back', async () => {
    const t = tokens.signUploadToken('uploads/r1.pdf', 'application/pdf', 5)
    expect((await put(t, Buffer.from('hello'), 'application/pdf')).status).toBe(200)
    const ft = tokens.signFileLink('uploads/r1.pdf', 60).split('/f/')[1]
    const res = await GET(new NextRequest(`http://localhost/f/${ft}`), ctx(ft))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(await res.text()).toBe('hello')
  })

  it('413 when the body is bigger than the signed size', async () => {
    const t = tokens.signUploadToken('uploads/r2.pdf', 'application/pdf', 3)
    expect((await put(t, Buffer.from('hello'), 'application/pdf')).status).toBe(413)
  })

  it('400 on content-type mismatch, 403 on a bad token', async () => {
    const t = tokens.signUploadToken('uploads/r3.pdf', 'application/pdf', 5)
    expect((await put(t, Buffer.from('hello'), 'image/png')).status).toBe(400)
    expect((await put('bad.token', Buffer.from('x'), 'application/pdf')).status).toBe(403)
  })

  it('404 for a missing file; 403 for a bad link', async () => {
    const ft = tokens.signFileLink('uploads/missing.pdf', 60).split('/f/')[1]
    expect((await GET(new NextRequest(`http://localhost/f/${ft}`), ctx(ft))).status).toBe(404)
    expect((await GET(new NextRequest('http://localhost/f/x.y'), ctx('x.y'))).status).toBe(403)
  })

  it('serves SVG with a script-blocking CSP (same-origin XSS guard)', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')
    const t = tokens.signUploadToken('uploads/r4.svg', 'image/svg+xml', svg.length)
    expect((await put(t, svg, 'image/svg+xml')).status).toBe(200)
    const ft = tokens.signFileLink('uploads/r4.svg', 60).split('/f/')[1]
    const res = await GET(new NextRequest(`http://localhost/f/${ft}`), ctx(ft))
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'")
  })
})
```

- [ ] **Step 3: Run it to see it fail**

Run: `npx vitest run tests/file-routes.test.ts`
Expected: FAIL — cannot find the route modules.

- [ ] **Step 4: Implement `src/app/upload/[token]/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { verifyUploadToken } from '@/lib/file-tokens'
import { writeStream, TooLargeError } from '@/lib/file-store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Receives the browser's PUT of a file to the URL returned by /api/upload-url.
// The token fixes the key, content type and maximum size.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const claims = verifyUploadToken(token)
  if (!claims) return NextResponse.json({ error: 'Upload link expired — please try again.' }, { status: 403 })

  const type = (req.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim()
  if (type !== claims.type) return NextResponse.json({ error: 'File type mismatch' }, { status: 400 })

  const declared = Number(req.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > claims.size) {
    return NextResponse.json({ error: 'File too large' }, { status: 413 })
  }
  if (!req.body) return NextResponse.json({ error: 'Empty upload' }, { status: 400 })

  try {
    await writeStream(claims.key, req.body, claims.size)
  } catch (e) {
    if (e instanceof TooLargeError) return NextResponse.json({ error: 'File too large' }, { status: 413 })
    console.error('[upload] write failed:', e)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
  return new NextResponse(null, { status: 200 })
}
```

- [ ] **Step 5: Implement `src/app/f/[token]/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { Readable } from 'node:stream'
import path from 'node:path'
import { verifyFileToken } from '@/lib/file-tokens'
import { stat, readStream } from '@/lib/file-store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const TYPES: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  heic: 'image/heic', svg: 'image/svg+xml', pdf: 'application/pdf',
  ai: 'application/postscript', eps: 'application/postscript',
}

// Streams a stored file for a signed link. Files are now served from the app's
// own origin (Supabase used a separate one), so SVGs get a CSP that blocks scripts.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const claims = verifyFileToken(token)
  if (!claims) return new NextResponse('This file link has expired.', { status: 403 })

  let size: number
  try { size = (await stat(claims.key)).size } catch { return new NextResponse('File not found', { status: 404 }) }

  const ext = path.extname(claims.key).slice(1).toLowerCase()
  const headers: Record<string, string> = {
    'Content-Type': TYPES[ext] ?? 'application/octet-stream',
    'Content-Length': String(size),
    'Cache-Control': 'private, max-age=300',
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': 'inline',
  }
  if (ext === 'svg') headers['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'; sandbox"

  const body = Readable.toWeb(readStream(claims.key)) as unknown as ReadableStream<Uint8Array>
  return new NextResponse(body, { headers })
}
```

- [ ] **Step 6: Run it to see it pass**

Run: `npx vitest run tests/file-routes.test.ts`
Expected: 5 passed.

- [ ] **Step 7: Switch `src/app/api/upload-url/route.ts` to signed upload paths.** Replace the import

```ts
import { supabaseAdmin } from '@/lib/supabase-server'
```
with
```ts
import { signUploadPath } from '@/lib/file-tokens'
```
Change the comment above `ALLOWED_EXTS` to `// Allowed upload extensions — keep in sync with ALLOWED_TYPES.` Then replace the whole results loop (from `const results` to just before `return NextResponse.json({ uploads: results })`) with:

```ts
  const results: { path: string; signedUrl: string }[] = []
  for (const f of files) {
    const ext = f.name.split('.').pop()?.toLowerCase() ?? 'bin'
    const path = `uploads/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
    // Sign the exact type the browser will send (they all send `type || octet-stream`).
    results.push({ path, signedUrl: signUploadPath(path, f.type || 'application/octet-stream', f.size) })
  }
```
The front end (IntakeForm, portal, admin, proof-preview) already does `PUT signedUrl` with `Content-Type: file.type || 'application/octet-stream'`, so it needs no change.

- [ ] **Step 8: Commit**

```bash
git add src/app/upload src/app/f src/app/api/upload-url/route.ts tests/file-routes.test.ts
git commit -m "feat(files): /upload and /f routes; upload-url signs local upload paths"
```

---

### Task 8: Admin sessions and admin users

`session.ts` is imported by `proxy.ts`, so it must not import `server-only`, the DB, or bcrypt.

**Files:**
- Create: `src/lib/session.ts`, `src/lib/admin-users.ts`, `tests/session.test.ts`, `tests/admin-users.test.ts`

- [ ] **Step 1: Write the failing test — `tests/session.test.ts`**

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { signSession, verifySession } from '@/lib/session'

describe('admin session JWT', () => {
  beforeAll(() => { process.env.AUTH_SECRET = 'a'.repeat(64) })

  it('round-trips', async () => {
    const t = await signSession({ id: 7, email: 'tony@ddfpixel.com' })
    expect(await verifySession(t)).toEqual({ id: 7, email: 'tony@ddfpixel.com' })
  })

  it('rejects expired, tampered, wrong-secret, and missing tokens', async () => {
    expect(await verifySession(await signSession({ id: 7, email: 'x@y.z' }, -10))).toBeNull()
    const t = await signSession({ id: 7, email: 'x@y.z' })
    expect(await verifySession(t.slice(0, -2) + 'xx')).toBeNull()
    process.env.AUTH_SECRET = 'b'.repeat(64)
    expect(await verifySession(t)).toBeNull()
    expect(await verifySession(undefined)).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/session.test.ts`
Expected: FAIL — cannot find module `@/lib/session`.

- [ ] **Step 3: Implement `src/lib/session.ts`**

```ts
import { SignJWT, jwtVerify } from 'jose'

// Admin login session: an HS256 JWT in an httpOnly cookie. Edge-safe (used by
// src/proxy.ts) — no server-only, no DB, no bcrypt in this file.

export const ADMIN_COOKIE = 'ddf_admin'
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30

export interface AdminSession { id: number; email: string }

function key(): Uint8Array {
  const s = process.env.AUTH_SECRET
  if (!s || s.length < 32) throw new Error('AUTH_SECRET must be set (32+ characters)')
  return new TextEncoder().encode(s)
}

export async function signSession(s: AdminSession, ttlSeconds = SESSION_TTL_SECONDS): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({ email: s.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(s.id))
    .setIssuedAt(now)
    .setExpirationTime(now + ttlSeconds)
    .sign(key())
}

export async function verifySession(token: string | undefined): Promise<AdminSession | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ['HS256'] })
    const id = Number(payload.sub)
    if (!Number.isInteger(id) || typeof payload.email !== 'string') return null
    return { id, email: payload.email }
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run tests/session.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Write the failing test — `tests/admin-users.test.ts`**

```ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { hasDb, TEST_URL, applySchema, resetTables } from './helpers/db'

describe.skipIf(!hasDb)('admin-users', () => {
  let au: typeof import('@/lib/admin-users')
  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_URL
    applySchema()
    au = await import('@/lib/admin-users')
  })
  beforeEach(async () => { await resetTables() })

  it('upserts, finds case-insensitively, verifies the password', async () => {
    const id = await au.upsertAdmin('Tony@DDFpixel.com ', 'correct horse battery')
    const found = await au.findAdminByEmail('tony@ddfpixel.com')
    expect(found?.id).toBe(id)
    expect(await au.checkPassword('correct horse battery', found!.password_hash)).toBe(true)
    expect(await au.checkPassword('wrong', found!.password_hash)).toBe(false)
  })

  it('upsert replaces the password; adminExists/touch work', async () => {
    const id = await au.upsertAdmin('a@b.co', 'first password!!')
    await au.upsertAdmin('a@b.co', 'second password!!')
    const found = await au.findAdminByEmail('a@b.co')
    expect(await au.checkPassword('second password!!', found!.password_hash)).toBe(true)
    expect(await au.adminExists(id)).toBe(true)
    expect(await au.adminExists(999)).toBe(false)
    await au.touchAdminLogin(id)
  })

  it('dummyHash makes unknown-user checks cost the same and fail', async () => {
    expect(await au.checkPassword('anything', await au.dummyHash())).toBe(false)
  })
})
```

- [ ] **Step 6: Run it to see it fail**

Run: `npx vitest run tests/admin-users.test.ts`
Expected: FAIL — cannot find module `@/lib/admin-users`.

- [ ] **Step 7: Implement `src/lib/admin-users.ts`**

```ts
import 'server-only'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'

export interface AdminUserRow { id: number; email: string; password_hash: string }

const COST = 12
const norm = (email: string) => email.trim().toLowerCase()

export const hashPassword = (pw: string) => bcrypt.hash(pw, COST)
export const checkPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash)

let dummy: Promise<string> | null = null
/** A real bcrypt hash to compare against when the email is unknown (equal timing). */
export function dummyHash(): Promise<string> {
  dummy ??= bcrypt.hash('not-a-real-password-' + Math.random(), COST)
  return dummy
}

export async function findAdminByEmail(email: string): Promise<AdminUserRow | null> {
  const rows = await db()<AdminUserRow[]>`select id, email, password_hash from admin_users where email = ${norm(email)}`
  return rows[0] ?? null
}

export async function adminExists(id: number): Promise<boolean> {
  return (await db()`select 1 from admin_users where id = ${id}`).length === 1
}

export async function touchAdminLogin(id: number): Promise<void> {
  await db()`update admin_users set last_login_at = now() where id = ${id}`
}

export async function upsertAdmin(email: string, password: string): Promise<number> {
  const [row] = await db()<{ id: number }[]>`
    insert into admin_users (email, password_hash) values (${norm(email)}, ${await hashPassword(password)})
    on conflict (email) do update set password_hash = excluded.password_hash
    returning id`
  return row.id
}
```

- [ ] **Step 8: Run both suites**

Run: `npx vitest run tests/session.test.ts tests/admin-users.test.ts`
Expected: all passed.

- [ ] **Step 9: Commit**

```bash
git add src/lib/session.ts src/lib/admin-users.ts tests/session.test.ts tests/admin-users.test.ts
git commit -m "feat(auth): admin JWT sessions + admin_users with bcrypt"
```

---

### Task 9: Wire admin login (routes, `requireAdmin`, proxy, login page, admin page, CLI)

**Files:**
- Create: `src/app/api/admin/login/route.ts`, `src/app/api/admin/logout/route.ts`, `src/app/api/admin/me/route.ts`, `scripts/admin-user.ts`, `scripts/admin-set.sh`, `tests/admin-login.test.ts`
- Rewrite: `src/lib/admin-auth.ts`, `src/proxy.ts`, `src/app/login/page.tsx`
- Modify: `src/app/admin/page.tsx`

- [ ] **Step 1: Write the failing test — `tests/admin-login.test.ts`**

```ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { hasDb, TEST_URL, applySchema, resetTables } from './helpers/db'

describe.skipIf(!hasDb)('POST /api/admin/login', () => {
  let POST: typeof import('@/app/api/admin/login/route').POST
  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_URL
    process.env.AUTH_SECRET = 'c'.repeat(64)
    applySchema()
    POST = (await import('@/app/api/admin/login/route')).POST
  })
  beforeEach(async () => {
    await resetTables()
    await (await import('@/lib/admin-users')).upsertAdmin('tony@ddfpixel.com', 'a very long password')
  })

  const login = (email: string, password: string) =>
    POST(new NextRequest('http://localhost/api/admin/login', {
      method: 'POST', body: JSON.stringify({ email, password }), headers: { 'content-type': 'application/json' },
    }))

  it('sets an httpOnly ddf_admin cookie on success (email is case-insensitive)', async () => {
    const res = await login('Tony@DDFpixel.com', 'a very long password')
    expect(res.status).toBe(200)
    const cookie = res.headers.get('set-cookie') ?? ''
    expect(cookie).toMatch(/^ddf_admin=/)
    expect(cookie.toLowerCase()).toContain('httponly')
  })

  it('401 with one generic message for a wrong password or unknown email', async () => {
    const a = await login('tony@ddfpixel.com', 'nope')
    const b = await login('ghost@ddfpixel.com', 'nope')
    expect(a.status).toBe(401)
    expect(b.status).toBe(401)
    expect(await a.json()).toEqual(await b.json())
  })

  it('400 when fields are missing', async () => {
    expect((await login('', '')).status).toBe(400)
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/admin-login.test.ts`
Expected: FAIL — cannot find the login route.

- [ ] **Step 3: Create `src/app/api/admin/login/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { normalizeEmail } from '@/lib/normalize-email'
import { findAdminByEmail, checkPassword, dummyHash, touchAdminLogin } from '@/lib/admin-users'
import { signSession, ADMIN_COOKIE, SESSION_TTL_SECONDS } from '@/lib/session'

export const dynamic = 'force-dynamic'

const FAILED = { error: 'Wrong email or password.' }

export async function POST(req: NextRequest) {
  let body: { email?: unknown; password?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  const email = normalizeEmail(typeof body.email === 'string' ? body.email : '')
  const password = typeof body.password === 'string' ? body.password : ''
  if (!email || !password) return NextResponse.json({ error: 'Enter your email and password.' }, { status: 400 })

  let admin
  try { admin = await findAdminByEmail(email) } catch (e) {
    console.error('[admin/login] lookup failed:', e)
    return NextResponse.json({ error: 'Sign-in is unavailable right now.' }, { status: 503 })
  }
  // Always run bcrypt so unknown emails take as long as wrong passwords.
  const ok = await checkPassword(password, admin?.password_hash ?? (await dummyHash()))
  if (!admin || !ok) return NextResponse.json(FAILED, { status: 401 })

  await touchAdminLogin(admin.id).catch(e => console.error('[admin/login] touch failed:', e))
  const res = NextResponse.json({ ok: true })
  res.cookies.set(ADMIN_COOKIE, await signSession({ id: admin.id, email: admin.email }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  })
  return res
}
```

- [ ] **Step 4: Create `src/app/api/admin/logout/route.ts`**

```ts
import { NextResponse } from 'next/server'
import { ADMIN_COOKIE } from '@/lib/session'

export const dynamic = 'force-dynamic'

export async function POST() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set(ADMIN_COOKIE, '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 0 })
  return res
}
```

- [ ] **Step 5: Create `src/app/api/admin/me/route.ts`**

```ts
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

export async function GET() {
  const auth = await requireAdmin()
  if ('unauthorized' in auth) return auth.unauthorized
  return NextResponse.json({ email: auth.user.email })
}
```

- [ ] **Step 6: Rewrite `src/lib/admin-auth.ts`** (same exported name and return shape, so the ~10 admin routes don't change)

```ts
import 'server-only'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, ADMIN_COOKIE, type AdminSession } from '@/lib/session'
import { adminExists } from '@/lib/admin-users'
import { getDefaultTenantId } from '@/lib/tenant'

// `tenantId` is the workspace this admin acts within. Always scope job queries
// to it. Single-tenant today: every admin acts in the default 'ddf' tenant.
type AdminAuthResult = { user: AdminSession; tenantId: string } | { unauthorized: NextResponse }

const unauthorized = () => ({ unauthorized: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) })

export async function requireAdmin(): Promise<AdminAuthResult> {
  const store = await cookies()
  const user = await verifySession(store.get(ADMIN_COOKIE)?.value)
  if (!user) return unauthorized()
  // Removing someone from admin_users revokes access immediately, even with a valid cookie.
  try {
    if (!(await adminExists(user.id))) return unauthorized()
  } catch (e) {
    console.error('[admin-auth] admin lookup failed:', e)
    return { unauthorized: NextResponse.json({ error: 'Service unavailable' }, { status: 503 }) }
  }
  return { user, tenantId: await getDefaultTenantId() }
}
```

- [ ] **Step 7: Run the login test**

Run: `npx vitest run tests/admin-login.test.ts`
Expected: 3 passed.

- [ ] **Step 8: Read the proxy docs** (`node_modules/next/dist/docs/`, search "proxy") to confirm the `proxy` export name and `config.matcher` are unchanged in 16.2.6.

- [ ] **Step 9: Rewrite `src/proxy.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { verifySession, ADMIN_COOKIE } from '@/lib/session'

const ipMap = new Map<string, { count: number; resetAt: number }>()
const WINDOW_MS = 60_000
// A client uploading final artwork makes several POSTs per item (signed URL,
// preview, save), so signed-URL requests get their own, looser budget.
const MAX_REQUESTS = 20
const MAX_UPLOAD_URL_REQUESTS = 60
const MAX_LOGIN_REQUESTS = 5

function clientIp(req: NextRequest): string {
  // Behind Cloudflare Tunnel the real client IP is in CF-Connecting-IP.
  return req.headers.get('cf-connecting-ip')
    ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? 'unknown'
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Rate limit POST /api/*
  if (req.method === 'POST' && pathname.startsWith('/api/')) {
    const kind = pathname === '/api/upload-url' ? 'upload' : pathname === '/api/admin/login' ? 'login' : 'api'
    const limit = kind === 'upload' ? MAX_UPLOAD_URL_REQUESTS : kind === 'login' ? MAX_LOGIN_REQUESTS : MAX_REQUESTS
    const bucket = `${clientIp(req)}:${kind}`
    const now = Date.now()
    const entry = ipMap.get(bucket)
    if (!entry || now > entry.resetAt) {
      ipMap.set(bucket, { count: 1, resetAt: now + WINDOW_MS })
    } else {
      entry.count++
      if (entry.count > limit) {
        return NextResponse.json(
          { error: 'Too many requests. Please wait a moment and try again.' },
          { status: 429, headers: { 'Retry-After': '60' } }
        )
      }
    }
  }

  // /admin pages need a valid admin session cookie. API routes re-check with
  // requireAdmin() (which also confirms the admin still exists).
  if (pathname.startsWith('/admin')) {
    const session = await verifySession(req.cookies.get(ADMIN_COOKIE)?.value)
    if (!session) {
      const loginUrl = new URL('/login', req.url)
      loginUrl.searchParams.set('next', pathname)
      return NextResponse.redirect(loginUrl)
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/api/:path*', '/admin/:path*'],
}
```

- [ ] **Step 10: Rewrite `src/app/login/page.tsx`** (admin-only; clients use the no-login portal)

```tsx
'use client'

import { useEffect, useState, FormEvent } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [next, setNext] = useState('/admin')

  useEffect(() => {
    const n = new URLSearchParams(location.search).get('next') ?? '/admin'
    // Clients don't sign in any more — the portal uses reference # + email.
    if (!n.startsWith('/admin')) { router.replace('/portal'); return }
    setNext(n)
  }, [router])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      if (res.ok) { router.push(next); return }
      if (res.status === 429) setError('Too many attempts — wait a minute and try again.')
      else setError((await res.json().catch(() => null))?.error ?? 'Sign-in failed.')
    } catch {
      setError('Network error — please try again.')
    }
    setLoading(false)
  }

  const input = { width: '100%', padding: '10px 14px', border: '1.5px solid var(--charcoal-border)', fontSize: 15, outline: 'none', boxSizing: 'border-box' as const, fontFamily: 'var(--font-body)' }
  const label = { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6, color: 'var(--charcoal)' }

  return (
    <main style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-body)' }}>
      <div style={{ background: '#fff', padding: '48px 40px', width: '100%', maxWidth: 420, border: '1px solid var(--charcoal-border)' }}>
        <div style={{ marginBottom: 32 }}>
          <img src="/logo-ddfpixel.png" alt="DDF x Pixel" style={{ height: '54px', width: 'auto', marginBottom: 16 }} />
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: 'var(--charcoal)' }}>Admin</h1>
          <p style={{ margin: '8px 0 0', color: 'var(--charcoal-60)', fontSize: 14 }}>Sign in to manage jobs</p>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <label style={label}>Email address</label>
            <input type="email" required autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} placeholder="admin@ddfevents.ca" style={input} />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={label}>Password</label>
            <input type="password" required autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" style={input} />
          </div>
          {error && <p style={{ color: 'var(--red-err)', fontSize: 13, marginBottom: 16 }}>{error}</p>}
          <button type="submit" disabled={loading} style={{ width: '100%', background: loading ? '#999' : 'var(--coral)', color: '#fff', border: 'none', padding: '12px', fontSize: 15, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', letterSpacing: 0.5 }}>
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </main>
  )
}
```

- [ ] **Step 11: Update `src/app/admin/page.tsx`** (three edits)

Delete the import:
```ts
import { createClient } from '@/lib/supabase-browser'
```
Replace the auth `useEffect` (the one calling `supabase.auth.getUser()`) with:
```ts
  useEffect(() => {
    fetch('/api/admin/me').then(res => {
      if (!res.ok) { router.push('/login?next=/admin'); return }
      fetchJobs()
    }).catch(() => router.push('/login?next=/admin'))
  }, [router])
```
Replace `signOut()` with:
```ts
  async function signOut() {
    await fetch('/api/admin/logout', { method: 'POST' }).catch(() => {})
    router.push('/login?next=/admin')
  }
```

- [ ] **Step 12: Create `scripts/admin-user.ts`** (standalone — no `@/` imports, so `server-only` is never loaded)

```ts
// Manage admin logins.
//   set <email>     — reads the password from stdin (use scripts/admin-set.sh to be prompted)
//   list            — list admins
//   remove <email>  — remove an admin (their cookie stops working immediately)
// Needs DATABASE_URL, e.g. postgres://ddf:<pw>@127.0.0.1:5433/ddf
import postgres from 'postgres'
import bcrypt from 'bcryptjs'

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const c of process.stdin) chunks.push(c as Buffer)
  return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '')
}

async function main() {
  const [cmd, emailArg] = process.argv.slice(2)
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is required')
  const sql = postgres(url, { max: 1, onnotice: () => {} })
  const email = (emailArg ?? '').trim().toLowerCase()
  try {
    if (cmd === 'set') {
      if (!email.includes('@')) throw new Error('usage: admin-user.ts set <email>  (password on stdin)')
      const password = await readStdin()
      if (password.length < 12) throw new Error('password must be at least 12 characters')
      const hash = await bcrypt.hash(password, 12)
      await sql`insert into admin_users (email, password_hash) values (${email}, ${hash})
        on conflict (email) do update set password_hash = excluded.password_hash`
      console.log(`✅ admin ${email} saved`)
    } else if (cmd === 'list') {
      const rows = await sql`select id, email, created_at, last_login_at from admin_users order by id`
      console.table(rows)
    } else if (cmd === 'remove') {
      const rows = await sql`delete from admin_users where email = ${email} returning id`
      console.log(rows.length ? `🗑️  removed ${email}` : `no admin ${email}`)
    } else {
      throw new Error('commands: set <email> | list | remove <email>')
    }
  } finally {
    await sql.end()
  }
}

main().catch(e => { console.error(`❌ ${(e as Error).message}`); process.exitCode = 1 })
```

- [ ] **Step 13: Create `scripts/admin-set.sh`** (prompts without echoing; the password never lands in shell history)

```bash
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
```
Then: `chmod +x scripts/admin-set.sh`.

- [ ] **Step 14: Try the CLI against the dev database**

```bash
source .env
printf 'a very long password' | DATABASE_URL="postgres://ddf:${POSTGRES_PASSWORD}@127.0.0.1:5433/ddf_dev" npx tsx scripts/admin-user.ts set dev@ddfpixel.com
DATABASE_URL="postgres://ddf:${POSTGRES_PASSWORD}@127.0.0.1:5433/ddf_dev" npx tsx scripts/admin-user.ts list
```
Expected: `✅ admin dev@ddfpixel.com saved`, then a table with one row.

- [ ] **Step 15: Commit**

```bash
git add src/app/api/admin/login src/app/api/admin/logout src/app/api/admin/me src/lib/admin-auth.ts src/proxy.ts src/app/login/page.tsx src/app/admin/page.tsx scripts/admin-user.ts scripts/admin-set.sh tests/admin-login.test.ts
git commit -m "feat(auth): own admin login (cookie JWT), proxy gate, admin CLI"
```

---

### Task 10: Tenant branding queries

**Files:**
- Modify: `src/lib/tenant-public.ts`, `src/lib/tenant-settings.ts`

- [ ] **Step 1: `src/lib/tenant-public.ts`.** Replace `import { supabaseAdmin } from '@/lib/supabase-server'` with `import { db } from '@/lib/db'`, and replace the query block in `getPublicTenant`

```ts
  const { data } = await supabaseAdmin
    .from('tenant_settings')
    .select('business_name, brand_color, reply_to_email, logo_url')
    .eq('tenant_id', id)
    .maybeSingle()
```
with
```ts
  type Settings = { business_name: string | null; brand_color: string | null; reply_to_email: string | null; logo_url: string | null }
  let data: Settings | null = null
  try {
    const rows = await db()<Settings[]>`
      select business_name, brand_color, reply_to_email, logo_url from tenant_settings where tenant_id = ${id}`
    data = rows[0] ?? null
  } catch (e) {
    console.error('[tenant-public] settings lookup failed:', e)
  }
```

- [ ] **Step 2: `src/lib/tenant-settings.ts`.** Same import swap; replace the query block in `getTenantBranding`

```ts
  const { data } = await supabaseAdmin
    .from('tenant_settings')
    .select('business_name, brand_color, reply_to_email, ntfy_topic, logo_url')
    .eq('tenant_id', tenantId)
    .maybeSingle()
```
with
```ts
  type Settings = { business_name: string | null; brand_color: string | null; reply_to_email: string | null; ntfy_topic: string | null; logo_url: string | null }
  let data: Settings | null = null
  try {
    const rows = await db()<Settings[]>`
      select business_name, brand_color, reply_to_email, ntfy_topic, logo_url from tenant_settings where tenant_id = ${tenantId}`
    data = rows[0] ?? null
  } catch (e) {
    console.error('[tenant-settings] lookup failed:', e)
  }
```

- [ ] **Step 3: Type-check just these files compile** — `npx tsc --noEmit 2>&1 | grep -E "tenant-(public|settings)\.ts" || echo "tenant files OK"`
Expected: `tenant files OK` (errors elsewhere are expected until Task 15).

- [ ] **Step 4: Commit**

```bash
git add src/lib/tenant-public.ts src/lib/tenant-settings.ts
git commit -m "refactor(tenant): read branding with SQL"
```

---

### Task 11: Admin API routes

Every edit below swaps one Supabase call for a repo call with the same `{ data, error }` shape. Leave the surrounding logic alone.

**Files:**
- Modify: `src/app/api/admin/jobs/route.ts`, `src/app/api/admin/jobs/[id]/route.ts`, `src/app/api/admin/jobs/[id]/resync/route.ts`, `src/app/api/admin/jobs/[id]/review-link/route.ts`, `src/app/api/admin/send-to-cc/route.ts`, `src/app/api/admin/files/route.ts`
- Rewrite: `src/app/api/admin/library/route.ts`

- [ ] **Step 1: `admin/jobs/route.ts`.** Import: replace `import { supabaseAdmin } from '@/lib/supabase-server'` with `import { listJobs } from '@/lib/jobs-repo'`. Replace the query (`supabaseAdmin.from('jobs').select('*').eq('tenant_id', …).order('submitted_at', …)`) with:

```ts
  const { data, error } = await listJobs(auth.tenantId)
```

- [ ] **Step 2: `admin/jobs/[id]/route.ts`.** Import: replace the Supabase import with

```ts
import { getJob, updateJob, updateJobItem } from '@/lib/jobs-repo'
import { remove as removeFiles } from '@/lib/file-store'
```
Then make these replacements, top to bottom:

```ts
// notify_client toggle (was .from('jobs').update({ notify_client }).eq('id').eq('tenant_id'))
    const { error } = await updateJob(jobId, { notify_client: parsed.data.notify_client }, auth.tenantId)

// status update (was .update({ status: body.status }) …)
    const { error } = await updateJob(jobId, { status: body.status }, auth.tenantId)

// job for the status email (was .select('reference_number, client_name, contact_email, notify_client') … .single())
      const { data: job } = await getJob(jobId, ['reference_number', 'client_name', 'contact_email', 'notify_client'], auth.tenantId)

// itemPatch: tenant gate (was .select('items, reference_number, company_name') … .single())
    const { data: cur } = await getJob(jobId, ['items', 'reference_number', 'company_name'], auth.tenantId)

// itemPatch: atomic update (was supabaseAdmin.rpc('update_job_item', { … }))
    const { data: updatedItems, error } = await updateJobItem(jobId, index, itemPatch, appendMessage)

// brief edit: current items (was .select('items') … .single())
      const { data: cur } = await getJob(jobId, ['items'], auth.tenantId)

// brief edit: current file paths (was .select('file_paths') … .single())
      const { data: current } = await getJob(jobId, ['file_paths'], auth.tenantId)

// brief edit: delete removed files (was supabaseAdmin.storage.from('job-files').remove(removed))
        await removeFiles(removed)

// brief edit: write (was .from('jobs').update(patch).eq('id').eq('tenant_id'))
    const { error } = await updateJob(jobId, patch, auth.tenantId)
```

- [ ] **Step 3: `admin/jobs/[id]/resync/route.ts` and `admin/jobs/[id]/review-link/route.ts`.** In both: import `{ getJob } from '@/lib/jobs-repo'` instead of Supabase, and replace the `.select('id').eq('id', jobId).eq('tenant_id', auth.tenantId).maybeSingle()` block with

```ts
  const { data: job } = await getJob(jobId, ['id'], auth.tenantId)
```

- [ ] **Step 4: `admin/send-to-cc/route.ts`.** Import `{ getJob }` from `@/lib/jobs-repo`; replace the query with

```ts
  const { data: job, error } = await getJob(
    jobId,
    ['reference_number', 'client_name', 'contact_email', 'date_required', 'event_name', 'notes', 'items'],
    auth.tenantId,
  )
```

- [ ] **Step 5: `admin/files/route.ts`.** Import `{ listJobFiles }` from `@/lib/jobs-repo`; replace the query with

```ts
  const { data: tenantJobs } = await listJobFiles(auth.tenantId)
```

- [ ] **Step 6: Rewrite `admin/library/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { listLibrary, insertLibraryEntry, deleteLibraryEntry } from '@/lib/library-repo'
import { exists } from '@/lib/file-store'
import { signFileLink } from '@/lib/file-tokens'

export const dynamic = 'force-dynamic'

// The admin's reusable design library — stock images (a white stage, standard
// backdrops, …) attached to items without re-uploading. Files live in the
// files store; this table is the catalogue.

const URL_TTL = 60 * 60

async function urlFor(path: string): Promise<string | null> {
  return (await exists(path)) ? signFileLink(path, URL_TTL) : null
}

export async function GET() {
  const auth = await requireAdmin()
  if ('unauthorized' in auth) return auth.unauthorized

  const { data, error } = await listLibrary(auth.tenantId)
  if (error) return NextResponse.json({ error: 'Failed to load library' }, { status: 500 })

  const rows = data ?? []
  const items = await Promise.all(rows.map(async r => ({ ...r, url: await urlFor(r.path) })))
  return NextResponse.json({ items })
}

// Register a file already uploaded via /api/upload-url as a library entry.
export async function POST(req: NextRequest) {
  const auth = await requireAdmin()
  if ('unauthorized' in auth) return auth.unauthorized

  const body = await req.json().catch(() => ({}))
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const path = typeof body.path === 'string' ? body.path : ''
  if (!name || !path.startsWith('uploads/') || path.includes('..')) {
    return NextResponse.json({ error: 'Invalid name or path' }, { status: 400 })
  }

  const { data, error } = await insertLibraryEntry(auth.tenantId, name.slice(0, 120), path)
  if (error || !data) return NextResponse.json({ error: 'Failed to save library entry' }, { status: 500 })
  return NextResponse.json({ item: { ...data, url: await urlFor(path) } })
}

// Remove from the catalogue only — the file stays, so jobs that already
// attached this design keep their proofs/examples intact.
export async function DELETE(req: NextRequest) {
  const auth = await requireAdmin()
  if ('unauthorized' in auth) return auth.unauthorized

  const body = await req.json().catch(() => ({}))
  if (typeof body.id !== 'number') {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }
  const { error } = await deleteLibraryEntry(body.id, auth.tenantId)
  if (error) return NextResponse.json({ error: 'Failed to delete' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 7: Verify no Supabase left in admin routes**

Run: `grep -rn "supabase" src/app/api/admin || echo "admin routes clean"`
Expected: `admin routes clean`.

- [ ] **Step 8: Commit**

```bash
git add src/app/api/admin
git commit -m "refactor(admin-api): use jobs/library repos and local files"
```

---

### Task 12: Portal (routes, auth, page) + legacy notice on lookup

**Files:**
- Modify: `src/app/api/portal/lookup/route.ts`, `src/app/api/portal/me/route.ts`, `src/app/api/portal/files/route.ts`, `src/app/api/portal/jobs/[id]/route.ts`, `src/app/api/portal/jobs/[id]/approve/route.ts`, `src/app/api/portal/jobs/[id]/add/route.ts`, `src/app/api/portal/jobs/[id]/final/route.ts`, `src/app/portal/page.tsx`
- Rewrite: `src/lib/portal-auth.ts`
- Create: `src/lib/legacy-notice.ts`

- [ ] **Step 1: Create `src/lib/legacy-notice.ts`**

```ts
// While old Supabase jobs are being restored (Phase 2), tell clients why their
// older job or link isn't found. Set LEGACY_RESTORE_NOTICE=0 after the import.
export const LEGACY_NOTICE = 'Jobs submitted before Nov 16, 2026 are being restored — email hello@ddfevents.ca and we’ll help right away.'

export function legacyNoticeOn(): boolean {
  return process.env.LEGACY_RESTORE_NOTICE === '1'
}
```

- [ ] **Step 2: Rewrite `src/lib/portal-auth.ts`** (token only; same signature so callers don't change)

```ts
import 'server-only'
import { cookies } from 'next/headers'
import { verifyPortalToken, PORTAL_COOKIE } from '@/lib/portal-token'

// A client reaches a job through the no-login portal: reference # + email
// mints a job-scoped portal_token cookie (/api/portal/lookup). Every portal
// endpoint funnels its ownership check through here.
// (The second parameter is kept for call-site compatibility; magic-link
// sessions no longer exist.)
export async function portalCanAccess(jobId: number, _jobContactEmail?: string | null): Promise<boolean> {
  const cookieStore = await cookies()
  return verifyPortalToken(cookieStore.get(PORTAL_COOKIE)?.value) === jobId
}
```

- [ ] **Step 3: `portal/lookup/route.ts`.** Imports: replace Supabase with

```ts
import { findJobsByReferenceCI } from '@/lib/jobs-repo'
import { LEGACY_NOTICE, legacyNoticeOn } from '@/lib/legacy-notice'
```
Replace the `.ilike('reference_number', reference)` query block with

```ts
  const { data: rows } = await findJobsByReferenceCI(reference)
```
and replace the not-found response with

```ts
  if (!match) {
    // One generic message — never reveal which of the two was wrong.
    const base = 'We couldn’t find a job with that reference number and email. Please check both and try again.'
    return NextResponse.json({ error: legacyNoticeOn() ? `${base} ${LEGACY_NOTICE}` : base }, { status: 404 })
  }
```

- [ ] **Step 4: `portal/me/route.ts`.** Import `{ getJob }` from `@/lib/jobs-repo`; replace the query with

```ts
  const { data: job } = await getJob(jobId, ['id', 'reference_number', 'event_name', 'date_required', 'notes', 'status', 'submitted_at', 'items', 'file_paths', 'contact_email'])
```
and update the comment "when there's no Supabase session" → "the portal page's only data source".

- [ ] **Step 5: `portal/files/route.ts`.** Import `{ getJob }`; replace the query with

```ts
  const { data: job } = await getJob(jobId, ['contact_email', 'items'])
```

- [ ] **Step 6: `portal/jobs/[id]/route.ts`.** Imports:

```ts
import { getJob, updateJob } from '@/lib/jobs-repo'
import { remove as removeFiles } from '@/lib/file-store'
```
Replacements:

```ts
  const { data: job } = await getJob(jobId, ['contact_email', 'status', 'file_paths', 'items'])
// …
      await removeFiles(removed)
// …
  const { error } = await updateJob(jobId, patch)
```

- [ ] **Step 7: `portal/jobs/[id]/approve/route.ts`.** Import `{ getJob, updateJobItem }`; replacements:

```ts
  const { data: job } = await getJob(jobId, ['contact_email', 'reference_number', 'client_name', 'items', 'tenant_id'])
// …
  const { data: updatedItems, error } = await updateJobItem(jobId, itemIndex, patch, appendMessage)
```

- [ ] **Step 8: `portal/jobs/[id]/add/route.ts`.** Import `{ getJob, appendToJob }`; replacements:

```ts
  const { data: job } = await getJob(jobId, ['contact_email', 'reference_number', 'company_name', 'client_name', 'status', 'tenant_id'])
// …
  const { data: result, error } = await appendToJob(jobId, stamped, newFilePaths)
```
(`stamped` and `newFilePaths` are the same variables the RPC call used. If `newFilePaths` can be `undefined` there, pass `newFilePaths ?? []`.)

- [ ] **Step 9: `portal/jobs/[id]/final/route.ts`.** Imports:

```ts
import { getJob, updateJobItem } from '@/lib/jobs-repo'
import { exists } from '@/lib/file-store'
```
Replacements:

```ts
  const { data: job } = await getJob(jobId, ['contact_email', 'reference_number', 'client_name', 'company_name', 'items', 'status'])
```
The existence check loop becomes:
```ts
  for (const p of [...paths, ...Object.values(previewMap)]) {
    if (!(await exists(p))) {
      return NextResponse.json({ error: 'One of the uploaded files could not be found' }, { status: 400 })
    }
  }
```
and the RPC call:
```ts
  const { data: updatedItems, error } = await updateJobItem(jobId, itemIndex, patch, appendMessage)
```

- [ ] **Step 10: `src/app/portal/page.tsx`.** Delete `import { createClient } from '@/lib/supabase-browser'`. Replace `loadPortal()` with

```ts
  // Load the client's job from their no-login portal token (reference # + email
  // lookup). No token → show the lookup form.
  async function loadPortal() {
    setLoading(true)
    const res = await fetch('/api/portal/me')
    if (res.ok) {
      const { jobs: list, email } = await res.json()
      setEmail(email ?? '')
      setUsingToken(true)
      setNeedsLookup(false)
      showJobs((list ?? []) as Job[])
    } else {
      setNeedsLookup(true)
      setLoading(false)
    }
  }
```
Replace `signOut()` with

```ts
  async function signOut() {
    // Clear the portal token and return to the lookup form.
    await fetch('/api/portal/lookup', { method: 'DELETE' }).catch(() => {})
    setJobs([]); setEmail(''); setUsingToken(false)
    setNeedsLookup(true)
  }
```
If `router`/`useRouter` is now unused in this file, remove both.

- [ ] **Step 11: Verify**

Run: `grep -rn "supabase" src/app/api/portal src/app/portal src/lib/portal-auth.ts || echo "portal clean"`
Expected: `portal clean`.

- [ ] **Step 12: Commit**

```bash
git add src/app/api/portal src/app/portal/page.tsx src/lib/portal-auth.ts src/lib/legacy-notice.ts
git commit -m "refactor(portal): repos, token-only access, legacy restore notice"
```

---

### Task 13: Review links, Command Centre callback, submit

**Files:**
- Modify: `src/app/api/review/[token]/route.ts`, `src/app/api/review/[token]/approve/route.ts`, `src/app/api/review/[token]/approve-all/route.ts`, `src/app/review/[token]/ReviewClient.tsx`, `src/app/api/cc/status-callback/route.ts`, `src/app/api/submit/route.ts`

- [ ] **Step 1: `review/[token]/route.ts`.** Imports: replace Supabase with

```ts
import { getJob } from '@/lib/jobs-repo'
import { LEGACY_NOTICE, legacyNoticeOn } from '@/lib/legacy-notice'
```
Replace the query and the not-found line with

```ts
  const { data: job } = await getJob(jobId, ['reference_number', 'event_name', 'date_required', 'items', 'client_name', 'tenant_id'])

  // A validly-signed link whose job isn't here yet is a pre-migration job (Phase 2).
  if (!job) return NextResponse.json({ error: 'Not found', ...(legacyNoticeOn() ? { legacy: LEGACY_NOTICE } : {}) }, { status: 404 })
```

- [ ] **Step 2: `review/[token]/approve/route.ts`.** Import `{ getJob, updateJobItem }`; replacements:

```ts
  const { data: job } = await getJob(jobId, ['reference_number', 'client_name', 'contact_email', 'items', 'tenant_id'])
// …
  const { data: updatedItems, error } = await updateJobItem(jobId, itemIndex, patch, appendMessage)
```

- [ ] **Step 3: `review/[token]/approve-all/route.ts`.** Import `{ getJob, updateJobItem }`; replacements:

```ts
  const { data: job } = await getJob(jobId, ['reference_number', 'client_name', 'items', 'tenant_id'])
// … inside the loop
    const { error } = await updateJobItem(jobId, idx, patch, null)
// … after the loop
  const { data: fresh } = await getJob(jobId, ['items'])
```

- [ ] **Step 4: `ReviewClient.tsx` shows the legacy notice.** Add state next to `invalid`:

```ts
  const [legacy, setLegacy] = useState('')
```
In the initial load effect, replace `if (!res.ok) { setInvalid(true); return }` with

```ts
        if (!res.ok) {
          const j = await res.json().catch(() => null)
          if (j?.legacy) setLegacy(j.legacy)
          setInvalid(true)
          return
        }
```
In the `if (invalid || !data)` block, replace the paragraph text with

```tsx
            {legacy || 'This approval link is invalid or has expired. Please ask us to send you a fresh one.'}
```

- [ ] **Step 5: `cc/status-callback/route.ts`.** Import `{ getJobByReference, updateJob }`; replacements:

```ts
    const { data: job } = await getJobByReference(referenceNumber, ['id', 'status', 'production', 'items', 'date_required', 'reference_number', 'client_name', 'contact_email', 'notify_client', 'tenant_id'])
// …
    await updateJob(job.id, patch)
```

- [ ] **Step 6: `submit/route.ts`.** Imports: replace Supabase with

```ts
import { findJobBySubmissionId, insertJob, updateJob } from '@/lib/jobs-repo'
import { exists } from '@/lib/file-store'
import { signFileLink } from '@/lib/file-tokens'
```
Replacements:

```ts
  const { data: existing } = await findJobBySubmissionId(data.submissionId)
```
```ts
  const { data: inserted, error: insertError } = await insertJob({
    tenant_id: tenantId,
    reference_number: referenceNumber,
    client_name: data.clientName,
    company_name: data.companyName,
    contact_email: data.contactEmail,
    event_name: data.eventName ?? null,
    date_required: data.dateRequired,
    notes: data.notes ?? null,
    setup_location: data.setupLocation ?? null,
    setup_time: data.setupTime ?? null,
    removal_location: data.removalLocation ?? null,
    removal_time: data.removalTime ?? null,
    items,
    file_paths: data.filePaths,
    submission_id: data.submissionId,
    submitted_at: submittedAt,
    status: 'pending',
  })

  if (insertError || !inserted) {
    console.error('[submit] insert error:', insertError)
    return NextResponse.json({ error: 'Failed to save job. Please try again.' }, { status: 500 })
  }

  // Update status to received
  await updateJob(inserted.id, { status: 'received' })
```
(Delete the old `if (insertError) {…}` block and the old reference-number update; the block above replaces both.) The email links:

```ts
  // File links for the notification email (valid 30 days)
  const signedFileUrls: string[] = []
  for (const path of data.filePaths) {
    if (await exists(path)) signedFileUrls.push(signFileLink(path, 60 * 60 * 24 * 30))
  }
```

- [ ] **Step 7: Verify**

Run: `grep -rn "supabase" src/app/api/review src/app/review src/app/api/cc src/app/api/submit || echo "clean"`
Expected: `clean`.

- [ ] **Step 8: Commit**

```bash
git add src/app/api/review src/app/review src/app/api/cc src/app/api/submit
git commit -m "refactor(review,submit,cc): repos, file links, legacy notice"
```

---

### Task 14: Kanban sync and proof signing

**Files:**
- Modify: `src/lib/kanban-sync.ts`, `src/lib/proof-sign.ts`

- [ ] **Step 1: `proof-sign.ts`.** Imports: replace Supabase with

```ts
import { exists } from '@/lib/file-store'
import { signFileLink } from '@/lib/file-tokens'
```
Replace the two lines that build `results`/`signed`:

```ts
  const results = await Promise.all(list.map(p => supabaseAdmin.storage.from('job-files').createSignedUrl(p, TTL)))
  const signed: Record<string, string> = {}
  results.forEach((r, i) => { if (r.data?.signedUrl) signed[list[i]] = r.data.signedUrl })
```
with

```ts
  // Only sign files that exist, so a missing file falls back to a tile (as before).
  const present = await Promise.all(list.map(p => exists(p)))
  const signed: Record<string, string> = {}
  list.forEach((p, i) => { if (present[i]) signed[p] = signFileLink(p, TTL) })
```

- [ ] **Step 2: `kanban-sync.ts` imports.** Replace `import { supabaseAdmin } from '@/lib/supabase-server'` with

```ts
import { db } from '@/lib/db'
import { getJob } from '@/lib/jobs-repo'
import { exists } from '@/lib/file-store'
import { signFileLink } from '@/lib/file-tokens'
```
and change the header comment `(see SUPABASE_KANBAN_RETRY_QUEUE.sql)` → `(table in db/schema.sql)`.

- [ ] **Step 3: `drainKanbanQueue` queue read.** Replace the `const { data: rows, error } = await supabaseAdmin.from('kanban_sync_queue')…limit(limit)` block and its `if (error) {…}` with

```ts
  type QueueRow = { job_id: number; job_label: string; attempts: number; first_failed_at: string }
  let rows: QueueRow[]
  try {
    rows = await db()<QueueRow[]>`
      select job_id, job_label, attempts, first_failed_at from kanban_sync_queue
      where last_attempt_at < ${cutoff} order by first_failed_at asc limit ${limit}`
  } catch (error) {
    console.error('[kanban-retry] queue read failed:', error)
    return { checked: 0, recovered: [], failing: [] }
  }
```
Change `for (const row of rows ?? [])` → `for (const row of rows)` and `checked: rows?.length ?? 0` → `checked: rows.length`. Replace the failing-row update with

```ts
      await db()`
        update kanban_sync_queue
        set attempts = ${row.attempts + 1},
            last_error = ${'detail' in r ? r.detail : 'webhook env vars missing'},
            last_attempt_at = now()
        where job_id = ${row.job_id}`
```

- [ ] **Step 4: `clearQueued` and `enqueueForRetry`.** Replace both functions with

```ts
async function clearQueued(jobId: number): Promise<void> {
  try {
    await db()`delete from kanban_sync_queue where job_id = ${jobId}`
  } catch (error) {
    console.error('[kanban-retry] dequeue failed:', error)
  }
}

/** Returns false when the row couldn't be written. */
async function enqueueForRetry(jobId: number, label: string, reason: string, detail: string): Promise<boolean> {
  try {
    await db()`
      insert into kanban_sync_queue (job_id, job_label, reason, last_error)
      values (${jobId}, ${label}, ${reason}, ${detail})
      on conflict (job_id) do update
        set reason = excluded.reason,
            last_error = excluded.last_error,
            attempts = kanban_sync_queue.attempts + 1,
            last_attempt_at = now()`
    return true
  } catch (error) {
    console.error('[kanban-retry] enqueue failed:', error)
    return false
  }
}
```
(The upsert does in one statement what the old select-then-insert/update did.)

- [ ] **Step 5: Job fetch and proof links inside `attemptSync`.**

```ts
    const { data: job } = await getJob(jobId, ['reference_number', 'client_name', 'company_name', 'contact_email', 'event_name', 'date_required', 'notes', 'items'])
```
and

```ts
      const signed = await Promise.all(allPaths.map(async path =>
        (await exists(path)) ? signFileLink(path, PROOF_TTL_SECONDS) : undefined))
```

- [ ] **Step 6: Verify**

Run: `grep -n "supabase" src/lib/kanban-sync.ts src/lib/proof-sign.ts || echo "clean"`
Expected: `clean`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/kanban-sync.ts src/lib/proof-sign.ts
git commit -m "refactor(kanban,proofs): SQL queue + long-lived file links"
```

---

### Task 15: Keep review links valid, add `/api/health`, remove Supabase

**Files:**
- Modify: `src/lib/review-token.ts`, `src/lib/portal-token.ts`, `package.json`
- Create: `src/app/api/health/route.ts`, `tests/health.test.ts`
- Delete: `src/lib/supabase-server.ts`, `src/lib/supabase-browser.ts`, `src/lib/supabase-middleware.ts`, `src/app/auth/callback/route.ts`
- Move: `SUPABASE_*.sql`, `supabase/` → `db/legacy-supabase/`

- [ ] **Step 1: Find the secret that signed the review links clients already have.** Review and portal tokens use `REVIEW_LINK_SECRET`, falling back to `SUPABASE_SERVICE_ROLE_KEY`. Check production:

```bash
npx vercel env ls production 2>/dev/null | grep -E "REVIEW_LINK_SECRET|SUPABASE_SERVICE_ROLE_KEY" || echo "vercel CLI not linked — check the Vercel dashboard → ddf-intake → Settings → Environment Variables"
```
- If **`REVIEW_LINK_SECRET` is listed**: `npx vercel env pull --environment=production /tmp/ddf-prod.env && grep '^REVIEW_LINK_SECRET=' /tmp/ddf-prod.env`. If the value is empty (a "sensitive" var can't be read back), ask the owner whether they saved it. If nobody has it, old review links will break: say so in the go-live notes, and the admin re-sends links after Phase 2.
- If **it is not listed**: the links were signed with the service-role key. Take it from the safety copy: `grep '^SUPABASE_SERVICE_ROLE_KEY=' ~/DDF-Data/legacy-supabase/env.local.supabase-backup | cut -d= -f2-`.

Save the value for the shop PC's `.env` and delete the temp file:
```bash
umask 077; printf '%s\n' '<the value>' > ~/DDF-Data/legacy-supabase/REVIEW_LINK_SECRET.txt
rm -f /tmp/ddf-prod.env
```

- [ ] **Step 2: Require `REVIEW_LINK_SECRET`.** In both `src/lib/review-token.ts` and `src/lib/portal-token.ts`, replace `secret()` with

```ts
function secret(): string {
  // Must stay equal to the value that signed links already in clients' inboxes
  // (historically the Supabase service-role key). Rotating it invalidates all links.
  const s = process.env.REVIEW_LINK_SECRET
  if (!s) throw new Error('REVIEW_LINK_SECRET is not set')
  return s
}
```
Update the comment block above it in `review-token.ts` to drop the sentence about falling back to the service-role key.

- [ ] **Step 3: Write the failing test — `tests/health.test.ts`**

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { hasDb, TEST_URL } from './helpers/db'

describe.skipIf(!hasDb)('GET /api/health', () => {
  let GET: typeof import('@/app/api/health/route').GET
  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_URL
    GET = (await import('@/app/api/health/route')).GET
  })

  it('200 when DB and files dir are OK', async () => {
    process.env.FILES_DIR = mkdtempSync(path.join(tmpdir(), 'ddf-health-'))
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ db: 'ok', files: 'ok' })
  })

  it('503 when the files dir is missing', async () => {
    process.env.FILES_DIR = '/nonexistent/ddf-files'
    const res = await GET()
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ db: 'ok', files: 'down' })
  })
})
```

- [ ] **Step 4: Run it to see it fail**

Run: `npx vitest run tests/health.test.ts`
Expected: FAIL — cannot find the route.

- [ ] **Step 5: Create `src/app/api/health/route.ts`**

```ts
import { NextResponse } from 'next/server'
import { promises as fsp, constants } from 'node:fs'
import { db } from '@/lib/db'
import { filesRoot } from '@/lib/file-store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Used by the ops loop (every 10 min) and the uptime check. Reveals nothing but up/down.
export async function GET() {
  const status = { db: 'down', files: 'down' }
  try { await db()`select 1`; status.db = 'ok' } catch (e) { console.error('[health] db:', e) }
  try { await fsp.access(filesRoot(), constants.W_OK); status.files = 'ok' } catch (e) { console.error('[health] files:', e) }
  const ok = status.db === 'ok' && status.files === 'ok'
  return NextResponse.json(status, { status: ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } })
}
```

- [ ] **Step 6: Run it to see it pass**

Run: `npx vitest run tests/health.test.ts`
Expected: 2 passed.

- [ ] **Step 7: Remove Supabase**

```bash
git rm src/lib/supabase-server.ts src/lib/supabase-browser.ts src/lib/supabase-middleware.ts src/app/auth/callback/route.ts
mkdir -p db/legacy-supabase
git mv SUPABASE_*.sql db/legacy-supabase/
git mv supabase db/legacy-supabase/supabase
npm uninstall @supabase/ssr @supabase/supabase-js
```
Add a one-line `db/legacy-supabase/README.md`:
```md
Historical Supabase SQL, kept for reference and for Phase 2 schema diffs. Not applied anywhere. The live schema is `db/schema.sql`.
```

- [ ] **Step 8: Prove nothing references Supabase**

Run: `grep -rni "supabase" src || echo "src clean"`
Expected: `src clean`. (Fix any leftover comments or imports it finds.)

- [ ] **Step 9: Full type-check, tests, build**

```bash
npx tsc --noEmit
npx vitest run
npx next build
```
Expected: tsc prints nothing; vitest all green (DB suites run because `.env` has `TEST_DATABASE_URL`); `next build` succeeds. Fix any type errors at their call sites; don't loosen the repo types.

- [ ] **Step 10: Commit**

```bash
git add -A src package.json package-lock.json db/legacy-supabase tests/health.test.ts
git commit -m "feat: health endpoint; require REVIEW_LINK_SECRET; remove Supabase"
```

---

### Task 16: Docker runtime, ops loop, deploy script

**Files:**
- Modify: `next.config.ts`, `docker-compose.yml`, `.env.example`
- Create: `Dockerfile`, `.dockerignore`, `ops/Dockerfile`, `ops/loop.sh`, `scripts/deploy.sh`
- Delete: `vercel.json`

- [ ] **Step 1: Read the standalone-output guide** in `node_modules/next/dist/docs/` (search "standalone") and confirm the output layout (`.next/standalone/server.js`, plus `.next/static` and `public` copied in).

- [ ] **Step 2: `next.config.ts`**

```ts
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Self-contained server for the Docker image (see Dockerfile).
  output: 'standalone',
}

export default nextConfig
```

- [ ] **Step 3: `Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 FILES_DIR=/data/files
# The `node` user is uid 1000 — the same as the first WSL2/Linux user, so the
# bind-mounted ~/DDF-Data/files is writable without chmod tricks.
RUN mkdir -p /data/files && chown -R node:node /data
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
```

- [ ] **Step 4: `.dockerignore`**

```
node_modules
.next
.git
.env
.env.*
.vercel
.claude
.gstack
node-compile-cache
tsconfig.tsbuildinfo
Brand Guidelines
docs
tests
scripts
cloudflare
ops
db/legacy-supabase
*.md
```

- [ ] **Step 5: `ops/Dockerfile`**

```dockerfile
FROM alpine:3.21
RUN apk add --no-cache bash curl coreutils findutils gzip postgresql17-client rclone tzdata
COPY loop.sh /loop.sh
RUN chmod +x /loop.sh
CMD ["/loop.sh"]
```

- [ ] **Step 6: `ops/loop.sh`**

```bash
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
  if pg_dump --no-owner --no-privileges | gzip > "$f.tmp" && mv "$f.tmp" "$f"; then
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
  if rclone copy "$BACK" "$REMOTE/db" --include 'db-*.sql.gz' --max-age 25h \
     && rclone copy "$FILES" "$REMOTE/files" --ignore-existing; then
    mark offsite; log "off-site ok"
  else
    log "off-site FAILED"
    ntfy 5 "DDF off-site backup FAILED" "rclone to $REMOTE failed at $(date)." offsite
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
  free_gb=$(df -Pk "$DATA" | awk 'NR==2 { printf "%.0f", $4 / 1048576 }')
  if (( r2_bytes > 8 * 1073741824 )); then pri=4; warn+=" ⚠️ Off-site copy is over 8 GB (free tier is 10 GB)."; fi
  if (( free_gb < 20 )); then pri=4; warn+=" ⚠️ Less than 20 GB disk free."; fi
  ntfy "$pri" "DDF weekly report" "DB ${db_mb} MB · files $(gb "$files_bytes") GB (${files_n}) · off-site $(gb "$r2_bytes") GB · disk free ${free_gb} GB.${warn}"
  mark digest; log "digest sent"
}

log "ops loop starting"
sleep 60   # let the app finish starting
while true; do
  check_health
  if (( $(age dump)    > 72000  )); then do_dump;    fi   # 20 h
  if (( $(age offsite) > 72000  )); then do_offsite; fi   # 20 h
  if (( $(age kanban)  > 21600  )); then do_kanban;  fi   # 6 h
  if (( $(age digest)  > 604800 )); then do_digest;  fi   # 7 days
  sleep 600
done
```
Then: `chmod +x ops/loop.sh && bash -n ops/loop.sh && echo syntax-ok`. Expected: `syntax-ok`.

- [ ] **Step 7: Full `docker-compose.yml`** (replaces the Task 2 version)

```yaml
name: ddf-intake

services:
  db:
    image: postgres:17-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: ddf
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD in .env}
      POSTGRES_DB: ddf
    volumes:
      - ddf_pgdata:/var/lib/postgresql/data
      - ./db/schema.sql:/docker-entrypoint-initdb.d/10-schema.sql:ro
      - ./db/test-db.sql:/docker-entrypoint-initdb.d/20-test-db.sql:ro
    ports:
      - "127.0.0.1:5433:5432"   # localhost only — for scripts and tests
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ddf -d ddf"]
      interval: 5s
      timeout: 3s
      retries: 20

  app:
    build: .
    restart: unless-stopped
    env_file: .env
    environment:
      DATABASE_URL: postgres://ddf:${POSTGRES_PASSWORD}@db:5432/ddf
      FILES_DIR: /data/files
    volumes:
      - ${DDF_DATA_DIR:?set DDF_DATA_DIR in .env}/files:/data/files
    ports:
      - "127.0.0.1:3000:3000"   # localhost only — the public path is the tunnel
    depends_on:
      db:
        condition: service_healthy

  ops:
    build: ./ops
    restart: unless-stopped
    env_file: .env
    environment:
      PGHOST: db
      PGUSER: ddf
      PGPASSWORD: ${POSTGRES_PASSWORD}
      PGDATABASE: ddf
      APP_URL: http://app:3000
      DATA_DIR: /ddf-data
    volumes:
      - ${DDF_DATA_DIR}:/ddf-data
    depends_on:
      db:
        condition: service_healthy

  tunnel:
    image: cloudflare/cloudflared:latest
    profiles: ["public"]        # started by deploy.sh only when TUNNEL_TOKEN is set
    restart: unless-stopped
    command: tunnel --no-autoupdate run
    environment:
      TUNNEL_TOKEN: ${TUNNEL_TOKEN:-}
    depends_on:
      - app

volumes:
  ddf_pgdata:
```

- [ ] **Step 8: `scripts/deploy.sh`**

```bash
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
```
Then: `chmod +x scripts/deploy.sh`.

- [ ] **Step 9: Replace `.env.example`**

```bash
# ─── ddf-intake (self-hosted) ─────────────────────────────────────────────
# Copy to .env on the host. Generate secrets with: openssl rand -hex 32
POSTGRES_PASSWORD=                 # openssl rand -hex 24
DDF_DATA_DIR=/home/<linux-user>/DDF-Data   # files/, backups/, ops-state/ live here
PUBLIC_BASE_URL=https://jobs.ddfpixel.com
AUTH_SECRET=                       # admin login cookies
FILE_LINK_SECRET=                  # upload + file links
REVIEW_LINK_SECRET=                # MUST equal the old signing value (plan Task 15) or emailed review links break
CRON_SECRET=                       # ops loop → /api/cron/kanban-retry
LEGACY_RESTORE_NOTICE=1            # set to 0 after the Phase 2 import

# ─── Cloudflare ──────────────────────────────────────────────────────────
TUNNEL_TOKEN=                      # Zero Trust → Tunnels → ddf-intake
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BACKUP_BUCKET=ddf-backups
OFFSITE_REMOTE=                    # optional, e.g. gdrive:DDF-Backups (+ DDF-Data/rclone.conf) instead of R2

# ─── Email + phone alerts (unchanged) ────────────────────────────────────
BREVO_API_KEY=
NOTIFICATION_EMAIL=
SENDER_EMAIL=
SENDER_NAME=DDF-Pixel
NTFY_TOPIC_URL=

# ─── Command Centre integration (unchanged) ──────────────────────────────
INTAKE_WEBHOOK_SECRET=
COMMAND_CENTRE_WEBHOOK_URL=
COMMAND_CENTRE_KANBAN_WEBHOOK_URL=
BOS_API_SECRET=

# ─── Tests (MacBook only) ────────────────────────────────────────────────
TEST_DATABASE_URL=postgres://ddf:<POSTGRES_PASSWORD>@127.0.0.1:5433/ddf_test
```

- [ ] **Step 10: Remove the Vercel config** — `git rm vercel.json` (the Kanban cron now runs in the ops loop).

- [ ] **Step 11: Run the full stack on the MacBook** (no tunnel, no R2 yet). Append temporary local values to `.env`, then deploy:

```bash
cat >> .env <<EOT
PUBLIC_BASE_URL=http://localhost:3000
AUTH_SECRET=$(openssl rand -hex 32)
FILE_LINK_SECRET=$(openssl rand -hex 32)
REVIEW_LINK_SECRET=$(openssl rand -hex 32)
CRON_SECRET=$(openssl rand -hex 32)
LEGACY_RESTORE_NOTICE=1
EOT
mkdir -p ~/DDF-Data/files
docker compose build app ops && docker compose up -d db app ops
sleep 15 && curl -s http://127.0.0.1:3000/api/health
docker compose logs --tail 20 ops
```
Expected: `{"db":"ok","files":"ok"}`; after ~60 s the ops log shows `dump ok: db-…sql.gz` and `off-site skipped (not configured)`. (`git pull` in `deploy.sh` needs a pushed branch, so use plain `docker compose` here. `deploy.sh` is used on the shop PC.)

- [ ] **Step 12: Stop it and commit**

```bash
docker compose stop app ops
git add next.config.ts Dockerfile .dockerignore docker-compose.yml ops scripts/deploy.sh .env.example
git commit -m "feat(ops): docker runtime, ops loop (health/backups/off-site/kanban), deploy script"
```

---

### Task 17: Offline page Worker

**Files:**
- Create: `cloudflare/offline-worker/wrangler.toml`, `cloudflare/offline-worker/src/index.ts`, `tests/offline-worker.test.ts`

- [ ] **Step 1: Write the failing test — `tests/offline-worker.test.ts`**

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import worker from '../cloudflare/offline-worker/src/index'

const req = (p: string) => new Request(`https://jobs.ddfpixel.com${p}`)
afterEach(() => { vi.unstubAllGlobals() })

describe('offline worker', () => {
  it('passes healthy responses through untouched', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 200 })))
    const r = await worker.fetch(req('/'))
    expect(r.status).toBe(200)
    expect(await r.text()).toBe('ok')
  })

  it('does not mask the app’s own 404 or 503', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })))
    expect((await worker.fetch(req('/x'))).status).toBe(404)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })))
    expect(await (await worker.fetch(req('/api/health'))).text()).toBe('{}')
  })

  it.each([502, 521, 522, 523, 524, 530])('serves the offline page on %i', async status => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status })))
    const r = await worker.fetch(req('/portal'))
    expect(r.status).toBe(503)
    expect(r.headers.get('content-type')).toContain('text/html')
    expect(await r.text()).toContain('hello@ddfevents.ca')
  })

  it('returns JSON for API calls and when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down') }))
    const r = await worker.fetch(req('/api/submit'))
    expect(r.status).toBe(503)
    expect(await r.json()).toMatchObject({ error: 'offline' })
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/offline-worker.test.ts`
Expected: FAIL — cannot find the module.

- [ ] **Step 3: Create `cloudflare/offline-worker/src/index.ts`**

```ts
// Cloudflare Worker in front of jobs.ddfpixel.com. Every request goes to the
// shop PC through the tunnel; if the PC is unreachable (reboot, power, internet),
// clients get a friendly page instead of a Cloudflare error.
const ORIGIN_DOWN = new Set([502, 521, 522, 523, 524, 530])

export default {
  async fetch(request: Request): Promise<Response> {
    try {
      const res = await fetch(request)
      return ORIGIN_DOWN.has(res.status) ? offline(request) : res
    } catch {
      return offline(request)
    }
  },
}

function offline(request: Request): Response {
  const headers = { 'Cache-Control': 'no-store', 'Retry-After': '300' }
  if (new URL(request.url).pathname.startsWith('/api/')) {
    return Response.json(
      { error: 'offline', message: 'Our job system is offline for a moment. Please try again shortly.' },
      { status: 503, headers },
    )
  }
  return new Response(PAGE, { status: 503, headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' } })
}

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>DDF x Pixel — back shortly</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f6f3ee;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1f1f1f}
  .card{background:#fff;border:1px solid #e3ded6;max-width:440px;margin:24px;padding:40px 32px;text-align:center}
  .brand{font-weight:800;letter-spacing:2px;text-transform:uppercase;color:#b8955a;font-size:14px;margin-bottom:18px}
  h1{font-size:22px;margin:0 0 10px} p{color:#555;line-height:1.6;font-size:15px;margin:0 0 10px}
  a{color:#b8955a;font-weight:700;text-decoration:none}
</style></head>
<body><div class="card">
  <div class="brand">DDF x Pixel</div>
  <h1>We’ll be right back</h1>
  <p>Our job and proof system is offline for a moment. Your files and approvals are safe.</p>
  <p>Please try again in a few minutes, or email <a href="mailto:hello@ddfevents.ca">hello@ddfevents.ca</a>.</p>
</div></body></html>`
```

- [ ] **Step 4: Create `cloudflare/offline-worker/wrangler.toml`**

```toml
name = "ddf-offline-page"
main = "src/index.ts"
compatibility_date = "2026-11-01"
workers_dev = false
routes = [
  { pattern = "jobs.ddfpixel.com/*", zone_name = "ddfpixel.com" }
]
```

- [ ] **Step 5: Run it to see it pass**

Run: `npx vitest run tests/offline-worker.test.ts`
Expected: 9 passed.

- [ ] **Step 6: Commit**

```bash
git add cloudflare tests/offline-worker.test.ts
git commit -m "feat(cloudflare): offline page worker for jobs.ddfpixel.com"
```

---

### Task 18: Smoke script + staging run on the MacBook

**Files:**
- Create: `scripts/smoke.ts`
- Replace (local only, git-ignored): `.env.local` (dev server config; the Supabase copy was saved in Task 1)

- [ ] **Step 1: Create `scripts/smoke.ts`**

```ts
// End-to-end smoke test against a running instance. Creates one job and cleans
// up exactly what it created (job id, library id, uploaded file keys).
//
//   SMOKE_ADMIN_EMAIL=… SMOKE_ADMIN_PASSWORD=… SMOKE_CLIENT_EMAIL=… \
//   SMOKE_DATABASE_URL=postgres://… SMOKE_FILES_DIR=/path/to/files \
//   npx tsx scripts/smoke.ts <baseUrl> [--approve]
//
// --approve also approves via the review link, which pushes a Kanban ticket to
// Command Centre. Use it on staging only (Command Centre URLs empty), not production.
import postgres from 'postgres'
import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import path from 'node:path'

const base = (process.argv[2] ?? '').replace(/\/+$/, '')
const approve = process.argv.includes('--approve')
const createdKeys: string[] = []
let createdJobId: number | null = null
let createdLibraryId: number | null = null

function env(k: string): string {
  const v = process.env[k]
  if (!v) throw new Error(`${k} is required`)
  return v
}
const step = (s: string) => console.log(`→ ${s}`)

async function call(method: string, p: string, body?: unknown, cookie = ''): Promise<Response> {
  return fetch(base + p, {
    method,
    redirect: 'manual',
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}
async function ok(res: Response, what: string): Promise<Response> {
  if (!res.ok) throw new Error(`${what} failed: HTTP ${res.status} ${await res.text()}`)
  return res
}
function cookie(res: Response, name: string): string {
  const c = res.headers.getSetCookie().find(h => h.startsWith(`${name}=`))
  if (!c) throw new Error(`no ${name} cookie`)
  return c.split(';')[0]
}

async function main() {
  if (!base) throw new Error('usage: smoke.ts <baseUrl> [--approve]')
  const pdf = Buffer.from('%PDF-1.4\n% ddf smoke test\n%%EOF\n')

  step('health')
  await ok(await call('GET', '/api/health'), 'health')

  step('upload a file')
  const up = await (await ok(await call('POST', '/api/upload-url', { files: [{ name: 'smoke.pdf', type: 'application/pdf', size: pdf.length }] }), 'upload-url')).json() as { uploads: { path: string; signedUrl: string }[] }
  const key = up.uploads[0].path
  createdKeys.push(key)
  await ok(await fetch(new URL(up.uploads[0].signedUrl, base), { method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, body: pdf }), 'PUT upload')

  step('submit a brief')
  const clientEmail = env('SMOKE_CLIENT_EMAIL').toLowerCase()
  const sub = await (await ok(await call('POST', '/api/submit', {
    clientName: 'Smoke Test', companyName: 'Smoke Test Co', contactEmail: clientEmail, dateRequired: '2030-01-01',
    items: [{ name: 'Smoke item', quantity: 1, size: '1x1 ft', material: 'vinyl' }],
    filePaths: [key], submissionId: randomUUID(),
  }), 'submit')).json() as { referenceNumber: string }
  const ref = sub.referenceNumber

  step('admin login')
  const adminCookie = cookie(await ok(await call('POST', '/api/admin/login', { email: env('SMOKE_ADMIN_EMAIL'), password: env('SMOKE_ADMIN_PASSWORD') }), 'admin login'), 'ddf_admin')

  step('admin sees the job')
  const { jobs } = await (await ok(await call('GET', '/api/admin/jobs', undefined, adminCookie), 'admin jobs')).json() as { jobs: { id: number; reference_number: string }[] }
  const job = jobs.find(j => j.reference_number === ref)
  if (!job) throw new Error(`job ${ref} not in admin list`)
  createdJobId = job.id

  step('admin attaches a proof')
  await ok(await call('PATCH', `/api/admin/jobs/${job.id}`, { itemPatch: { index: 0, patch: { proof_urls: [key], approval_status: 'pending' } } }, adminCookie), 'attach proof')

  step('review link opens')
  const { url } = await (await ok(await call('GET', `/api/admin/jobs/${job.id}/review-link`, undefined, adminCookie), 'review-link')).json() as { url: string }
  const token = url.split('/review/')[1]
  await ok(await call('GET', `/api/review/${token}`), 'review data')
  if (approve) {
    step('client approves via review link')
    await ok(await call('POST', `/api/review/${token}/approve`, { itemIndex: 0, action: 'approve' }), 'approve')
  }

  step('portal lookup (case-insensitive reference)')
  const portalCookie = cookie(await ok(await call('POST', '/api/portal/lookup', { reference: ref.toLowerCase(), email: clientEmail }), 'portal lookup'), 'portal_token')
  const me = await (await ok(await call('GET', '/api/portal/me', undefined, portalCookie), 'portal me')).json() as { jobs: { reference_number: string }[] }
  if (me.jobs[0]?.reference_number !== ref) throw new Error('portal returned the wrong job')

  step('design library add → file link → delete')
  const lib = await (await ok(await call('POST', '/api/admin/library', { name: 'Smoke design', path: key }, adminCookie), 'library add')).json() as { item: { id: number; url: string | null } }
  createdLibraryId = lib.item.id
  if (!lib.item.url) throw new Error('library item has no file link')
  const file = await ok(await fetch(lib.item.url.replace(/^https?:\/\/[^/]+/, base)), 'file link')
  if ((await file.arrayBuffer()).byteLength !== pdf.length) throw new Error('downloaded bytes differ')
  await ok(await call('DELETE', '/api/admin/library', { id: createdLibraryId }, adminCookie), 'library delete')
  createdLibraryId = null

  console.log(`✅ smoke passed (${ref}, job ${createdJobId})`)
}

async function cleanup() {
  const dbUrl = process.env.SMOKE_DATABASE_URL
  const filesDir = process.env.SMOKE_FILES_DIR
  if (dbUrl && (createdJobId !== null || createdLibraryId !== null)) {
    const sql = postgres(dbUrl, { max: 1, onnotice: () => {} })
    if (createdLibraryId !== null) await sql`delete from design_library where id = ${createdLibraryId}`
    if (createdJobId !== null) await sql`delete from jobs where id = ${createdJobId}`   // queue row cascades
    await sql.end()
  }
  if (filesDir) for (const k of createdKeys) await rm(path.join(filesDir, k), { force: true })
  console.log(`🧹 removed job ${createdJobId ?? '—'} and ${createdKeys.length} file(s)`)
}

main()
  .catch(e => { console.error(`❌ ${(e as Error).message}`); process.exitCode = 1 })
  .finally(() => cleanup().catch(e => console.error('cleanup failed:', e)))
```

- [ ] **Step 2: Write the staging `.env.local`** (git-ignored; `next dev` reads it). Copy `BREVO_API_KEY` and `SENDER_EMAIL` from `~/DDF-Data/legacy-supabase/env.local.supabase-backup`. Staging sends **real emails** to `NOTIFICATION_EMAIL` and the smoke client email, so use your own inbox for both.

```bash
source .env
cat > .env.local <<EOT
DATABASE_URL=postgres://ddf:${POSTGRES_PASSWORD}@127.0.0.1:5433/ddf_dev
FILES_DIR=/tmp/ddf-dev-files
PUBLIC_BASE_URL=http://localhost:3001
AUTH_SECRET=$(openssl rand -hex 32)
FILE_LINK_SECRET=$(openssl rand -hex 32)
REVIEW_LINK_SECRET=$(openssl rand -hex 32)
CRON_SECRET=$(openssl rand -hex 32)
LEGACY_RESTORE_NOTICE=1
BREVO_API_KEY=$(grep '^BREVO_API_KEY=' ~/DDF-Data/legacy-supabase/env.local.supabase-backup | cut -d= -f2-)
SENDER_EMAIL=$(grep '^SENDER_EMAIL=' ~/DDF-Data/legacy-supabase/env.local.supabase-backup | cut -d= -f2-)
SENDER_NAME=DDF-Pixel
NOTIFICATION_EMAIL=<your inbox>
NTFY_TOPIC_URL=
INTAKE_WEBHOOK_SECRET=dev
COMMAND_CENTRE_WEBHOOK_URL=
COMMAND_CENTRE_KANBAN_WEBHOOK_URL=
EOT
mkdir -p /tmp/ddf-dev-files
```
Replace `<your inbox>` before running.

- [ ] **Step 3: Start the dev server** (separate terminal, keep it running): `npx next dev -p 3001`

- [ ] **Step 4: Run the smoke test with approval** (admin `dev@ddfpixel.com` was created in Task 9 Step 14)

```bash
source .env
SMOKE_ADMIN_EMAIL=dev@ddfpixel.com SMOKE_ADMIN_PASSWORD='a very long password' \
SMOKE_CLIENT_EMAIL='<your inbox>' \
SMOKE_DATABASE_URL="postgres://ddf:${POSTGRES_PASSWORD}@127.0.0.1:5433/ddf_dev" SMOKE_FILES_DIR=/tmp/ddf-dev-files \
npx tsx scripts/smoke.ts http://localhost:3001 --approve
```
Expected: each `→` step, then `✅ smoke passed (DDF-…, job 1000000…)` and `🧹 removed job … and 1 file(s)`.

- [ ] **Step 5: Manual UI pass in the browser at `http://localhost:3001`** (these flows aren't fully covered by the script):
  - [ ] `/` — submit a brief with 2 real files (a PDF and a JPG). Upload progress bars reach 100%.
  - [ ] `/admin` — redirected to `/login`; sign in; the job appears; thumbnails render.
  - [ ] Admin: upload a proof image via the UI, copy the review link, open it in a private window, approve it.
  - [ ] `/portal` — look up by reference + email; job shows; **Add to this job** with a new item and file; upload a final design on an item.
  - [ ] Admin: design library → add, attach to an item, delete.
  - [ ] Unknown reference in `/portal` shows the "being restored" notice. A validly-signed review link for a job that doesn't exist shows it too. Generate one and open it:
    ```bash
    node -e 'const c=require("crypto");const s=process.argv[1];const p="review:999";console.log("http://localhost:3001/review/"+Buffer.from(p).toString("base64url")+"."+c.createHmac("sha256",s).update(p).digest("base64url"))' "$(grep ^REVIEW_LINK_SECRET= .env.local | cut -d= -f2-)"
    ```
  - [ ] Admin: Sign out → `/admin` redirects to `/login` again.
  Then delete the jobs you created **by their ids**: `psql "postgres://ddf:${POSTGRES_PASSWORD}@127.0.0.1:5433/ddf_dev" -c "delete from jobs where id in (<ids>)"`.

- [ ] **Step 6: Commit and push the branch**

```bash
git add scripts/smoke.ts package.json
git commit -m "test: end-to-end smoke script"
git push -u origin supabase-exit
```

---

### Task 19: Prepare the Windows shop PC (owner + Claude Code)

Do this at the shop PC. Owner steps are marked **[owner]**. Everything else is commands in the **Ubuntu (WSL2)** terminal unless marked PowerShell.

> **Pre-flight recorded 2026-11-15** (DESKTOP-7NAUN3C): Intel i7-7700, **32 GB RAM**, 1.84 TB disk with ~1.1 TB free, Windows 11 Pro 24H2 (build 26100) → **passes**. Still to confirm: CPU virtualization is enabled (Task Manager → Performance → CPU → "Virtualization: Enabled"; if Disabled, turn on Intel VT-x in the BIOS) and whether this PC runs RIP/CNC software.

- [ ] **Step 1 [owner]: Pre-flight check.** Settings → System → About: note **Installed RAM**. File Explorer: note free space on C:. Check whether this PC runs print RIP or CNC software (e.g. Onyx, Caldera, Flexi, VersaWorks, Vectric).
  - RAM ≥ 16 GB and no RIP/CNC → continue.
  - RAM 8–15 GB, or it runs RIP/CNC → continue, but keep the 4 GB WSL cap (Step 3) and only run `deploy.sh` after hours.
  - RAM < 8 GB or < 50 GB free disk → stop and pick another machine.

- [ ] **Step 2 [owner]: Install WSL2 + Ubuntu.** PowerShell **as Administrator**: `wsl --install -d Ubuntu`. Reboot. Open "Ubuntu" from the Start menu and create a Linux username/password (write them down).

- [ ] **Step 3: Cap WSL resources.** Create `%UserProfile%\.wslconfig` (Notepad) with:

```ini
[wsl2]
memory=4GB
processors=2
```
Then PowerShell: `wsl --shutdown`.

- [ ] **Step 4 [owner]: Install Docker Desktop** (docker.com). Settings: General → **Use the WSL 2 based engine** ✓ and **Start Docker Desktop when you sign in** ✓. Resources → WSL integration → enable **Ubuntu**. Check in Ubuntu: `docker run --rm hello-world` prints "Hello from Docker!".

- [ ] **Step 5 [owner]: Make it come back on its own after a reboot or power cut.**
  - Create a local Windows account for the host (e.g. `ddf-host`), sign in once, and add it to the `docker-users` group (Computer Management → Local Users and Groups → Groups → docker-users → Add). Use this account for Steps 2–4 if you haven't yet. Alternatively use the PC's existing account.
  - Download **Autologon** from Microsoft Sysinternals (learn.microsoft.com/sysinternals/downloads/autologon), run it, enter that account's password, click **Enable**.
  - PowerShell (Admin) — never sleep or hibernate on AC power:
    ```powershell
    powercfg /change standby-timeout-ac 0
    powercfg /change hibernate-timeout-ac 0
    powercfg /change disk-timeout-ac 0
    ```
  - Settings → Windows Update → Advanced options → **Active hours**: 7:00–23:00 (update restarts happen at night).
  - BIOS/UEFI (key at boot, often F2/Del): set **Restore on AC Power Loss** (or "AC Recovery") to **Power On**. Vendor menus differ; skip if not found.

- [ ] **Step 6: Tools in Ubuntu**

```bash
sudo apt-get update && sudo apt-get install -y git curl postgresql-client
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs
node -v   # v22.x
```

- [ ] **Step 7: Get the code.** Authenticate to GitHub (`sudo apt-get install -y gh && gh auth login`, or a personal access token), then:

```bash
git clone https://github.com/ExotikPixel/ddf-intake.git ~/ddf-intake
cd ~/ddf-intake && git checkout supabase-exit && npm ci
mkdir -p ~/DDF-Data/files ~/DDF-Data/backups ~/DDF-Data/ops-state
```

- [ ] **Step 8: Create `~/ddf-intake/.env`** from `.env.example`. Never email or paste secrets into chat. Type them, or bring them over in a password manager.
  - `POSTGRES_PASSWORD`, `AUTH_SECRET`, `FILE_LINK_SECRET`, `CRON_SECRET`: fresh `openssl rand -hex 32` values (24 for the DB password is fine).
  - `DDF_DATA_DIR=/home/<linux-user>/DDF-Data`, `PUBLIC_BASE_URL=https://jobs.ddfpixel.com`, `LEGACY_RESTORE_NOTICE=1`.
  - `REVIEW_LINK_SECRET`: the value from Task 15 Step 1 (`~/DDF-Data/legacy-supabase/REVIEW_LINK_SECRET.txt` on the MacBook).
  - Brevo, ntfy and Command Centre values: copy from Vercel → ddf-intake → Settings → Environment Variables (Production).
  - Leave `TUNNEL_TOKEN` and `R2_*` empty until Task 20. Remove the `TEST_DATABASE_URL` line.
  - `chmod 600 .env`

- [ ] **Step 9: First deploy and admin logins**

```bash
cd ~/ddf-intake && ./scripts/deploy.sh
OWNER_EMAIL=owner@ddfpixel.com       # ← change to the real address
BROTHER_EMAIL=brother@ddfpixel.com   # ← change to the real address
npm run admin:set -- "$OWNER_EMAIL"
npm run admin:set -- "$BROTHER_EMAIL"
```
Expected: `✅ healthy`, then `✅ admin … saved` for each.

- [ ] **Step 10: Local smoke on the PC** (production config, so no `--approve`)

```bash
set -a; source .env; set +a
SMOKE_ADMIN_EMAIL=<owner email> SMOKE_ADMIN_PASSWORD='<owner password>' SMOKE_CLIENT_EMAIL=<owner email> \
SMOKE_DATABASE_URL="postgres://ddf:${POSTGRES_PASSWORD}@127.0.0.1:5433/ddf" SMOKE_FILES_DIR="$DDF_DATA_DIR/files" \
npx tsx scripts/smoke.ts http://127.0.0.1:3000
```
Expected: `✅ smoke passed`. It sends the normal "new brief" emails to `NOTIFICATION_EMAIL` and the owner's address. (The library link step rewrites the `https://jobs.ddfpixel.com` host to the local URL, so it works before the tunnel exists.)

---

### Task 20: Cloudflare — DNS, email forwarding, tunnel, offline page, off-site bucket

Mostly **[owner]** dashboard work. Order matters: email forwards must exist in Cloudflare **before** the nameservers change, or mail to `@ddfpixel.com` bounces.

- [ ] **Step 1 [owner]: Record what Namecheap does today.**
  - Namecheap → Domain List → `ddfpixel.com` → **Redirect Email**: list every alias → destination.
  - **Advanced DNS**: screenshot every record (A, CNAME, TXT, MX).

- [ ] **Step 2 [owner]: Add the domain to Cloudflare (Free).** Cloudflare → Add a domain → `ddfpixel.com` → Free. Compare the imported records with the screenshot and add anything missing, especially:
  - Brevo TXT records (`brevo-code`, DKIM `mail._domainkey`, `_dmarc`).
  - The website records (`@`, `www`).
  - Leave the existing `jobs` CNAME (to Vercel) for now; Step 5 replaces it.
  - **Delete the five `eforward*.registrar-servers.com` MX records** in Cloudflare (Email Routing adds its own).

- [ ] **Step 3 [owner]: Recreate email forwarding.** Cloudflare → Email → **Email Routing** → enable. Add each alias from Step 1 as a custom address → destination (each destination confirms by email). Cloudflare adds its MX records and an SPF TXT.
  **SPF must be a single TXT record.** If Brevo already has one, merge them into one record, e.g. `v=spf1 include:spf.brevo.com include:_spf.mx.cloudflare.net ~all`. Two `v=spf1` records break email authentication.

- [ ] **Step 4 [owner]: Switch nameservers.** Namecheap → Domain → **Nameservers → Custom DNS** → the two Cloudflare nameservers. Wait until Cloudflare shows **Active** (minutes to a few hours). Then:
  - SSL/TLS → Edge Certificates → **Always Use HTTPS**: On.
  - Send a test email to each forwarded alias and confirm it arrives. Load the website.
  - `dig +short NS ddfpixel.com` (or dns.google) shows Cloudflare nameservers.

- [ ] **Step 5 [owner]: Create the tunnel.** Cloudflare → Zero Trust (free plan) → Networks → **Tunnels** → Create → Cloudflared → name `ddf-intake` → copy the **token** (the long string after `--token`). Public hostname: subdomain `jobs`, domain `ddfpixel.com`, service **HTTP** → `app:3000`. If Cloudflare reports an existing `jobs` record, delete that DNS record (the Vercel CNAME) and save again.

- [ ] **Step 6: Start the tunnel on the PC.** Put `TUNNEL_TOKEN=<token>` in `~/ddf-intake/.env`, then `./scripts/deploy.sh`. Check: `docker compose ps` shows `tunnel` running; `https://jobs.ddfpixel.com/api/health` returns `{"db":"ok","files":"ok"}` from any phone.

- [ ] **Step 7: Deploy the offline page** (from the MacBook):

```bash
cd cloudflare/offline-worker
npx wrangler login        # [owner] approves in the browser
npx wrangler deploy
```
Expected: `Deployed ddf-offline-page … jobs.ddfpixel.com/*`. Test: on the PC, `docker compose stop app`, load `https://jobs.ddfpixel.com` → the "We'll be right back" page. Then `docker compose start app`.

- [ ] **Step 8 [owner]: Off-site backup bucket.** Cloudflare → **R2** → enable (card verification; $0 under 10 GB) → Create bucket `ddf-backups` (location: automatic). Bucket → Settings → **Object lifecycle rules** → Add: prefix `db/`, delete objects after **30 days**. R2 → **Manage API tokens** → Create → permission **Object Read & Write**, specific bucket `ddf-backups` → copy Access Key ID, Secret Access Key, and the Account ID.

   **No card?** Skip R2 and use Google Drive instead: in Ubuntu on the PC, `sudo apt-get install -y rclone && rclone config` → new remote named `gdrive` (type `drive`), finish the browser sign-in, then `cp ~/.config/rclone/rclone.conf ~/DDF-Data/rclone.conf` and set `OFFSITE_REMOTE=gdrive:DDF-Backups` in `.env` (leave `R2_*` empty). Drive has no lifecycle rules, so delete old `db/` dumps there by hand now and then.

- [ ] **Step 9: Turn on off-site sync.** Add `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` to `~/ddf-intake/.env`, then:

```bash
rm -f ~/DDF-Data/ops-state/offsite   # don't wait 20 h for the first sync
docker compose up -d --force-recreate ops
sleep 90 && docker compose logs --tail 20 ops
```
Expected: `off-site ok`. In the Cloudflare R2 dashboard, `ddf-backups` shows `db/` and `files/`.

---

### Task 21: Docs, uptime alert, retire Vercel

**Files:**
- Create: `RESTORE.md`, `.github/workflows/uptime.yml`
- Modify: `SYSTEM_STATE.md`, `CLAUDE.md`

- [ ] **Step 1: Create `RESTORE.md`**

````md
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
   docker compose up -d db
   docker compose exec -T db sh -c 'until pg_isready -U ddf -d ddf; do sleep 1; done'
   latest=$(ls -1t ~/DDF-Data/backups/db-*.sql.gz | head -1)
   docker compose exec -T db psql -U ddf -d postgres -c "drop database ddf" -c "create database ddf"
   gunzip -c "$latest" | docker compose exec -T db psql -U ddf -d ddf -v ON_ERROR_STOP=1 -q
   ```
4. **Start everything:** `./scripts/deploy.sh` → `✅ healthy`.
5. **Point the tunnel here:** use the same `TUNNEL_TOKEN` (stop the old machine's `tunnel` container first), or create a new tunnel in Cloudflare Zero Trust and update `.env`.
6. **Check:** `https://jobs.ddfpixel.com/api/health`, admin login, one portal lookup.

Admin logins live in the database (`admin_users`), so they come back with the dump. Reset one with `npm run admin:set -- <email>`.
````

- [ ] **Step 2: Create `.github/workflows/uptime.yml`** (outside check: the ops loop can't report when the whole PC is down)

```yaml
name: uptime
on:
  schedule:
    - cron: "17 * * * *"   # hourly
  workflow_dispatch:
jobs:
  check:
    runs-on: ubuntu-latest
    timeout-minutes: 2
    steps:
      - name: Check jobs.ddfpixel.com
        env:
          NTFY_TOPIC_URL: ${{ secrets.NTFY_TOPIC_URL }}
        run: |
          code=$(curl -s -o /dev/null -w '%{http_code}' -m 20 https://jobs.ddfpixel.com/api/health || echo 000)
          echo "health: $code"
          if [ "$code" != "200" ]; then
            curl -fsS -H "Title: DDF intake unreachable" -H "Priority: 5" \
              -d "jobs.ddfpixel.com/api/health returned $code at $(date -u). Check the shop PC (power, internet, Docker)." \
              "$NTFY_TOPIC_URL" || true
            exit 1
          fi
```
[owner]: GitHub → repo → Settings → Secrets and variables → Actions → New secret `NTFY_TOPIC_URL` (same value as in `.env`). Hourly runs use about 720 of the 2,000 free private-repo minutes per month.

- [ ] **Step 3: Update `SYSTEM_STATE.md`.** In the "two apps" table, replace the intake column's rows:
  - Prod URL → `jobs.ddfpixel.com` (Cloudflare Tunnel → Windows shop PC, Docker in WSL2)
  - Vercel project → `ddf-intake` (detached: domain removed, auto-deploy off — kept only for history)
  - Supabase → **none** (Postgres 17 container; schema `db/schema.sql`; `jobs.id` bigint, new ids start at 1,000,000)

  Replace "Deploy workflow: push `main` → prod" with: *Deploy: push to `main`, then on the shop PC (Ubuntu/WSL2) run `cd ~/ddf-intake && git checkout main && ./scripts/deploy.sh`.* Replace the intake bullets about `update_job_item` RPC and `SUPABASE_*.sql` with: *Items JSON writes go through `updateJobItem()` / `appendToJob()` in `src/lib/jobs-repo.ts` (row-locked SQL functions). Schema changes: edit `db/schema.sql` (idempotent); `deploy.sh` applies it.* Add a section:

  ```md
  ## Self-hosting (since 2026-11)
  - Host: Windows shop PC, Docker Desktop + WSL2 Ubuntu. Repo `~/ddf-intake`, data `~/DDF-Data/{files,backups,ops-state}`.
  - Services: db (Postgres 17), app (Next standalone), ops (health/backups/off-site/kanban loop), tunnel (cloudflared).
  - Files: local disk under the old Supabase keys (`uploads/...`). Upload: PUT `/upload/<token>`. Download: `/f/<token>` (HMAC, `FILE_LINK_SECRET`).
  - Admin login: `admin_users` + cookie JWT (`AUTH_SECRET`). Manage with `npm run admin:set -- <email>`.
  - Clients: no-login portal only (ref # + email). Review links signed with `REVIEW_LINK_SECRET` (= old value).
  - Backups: ops loop dumps the DB daily (14 kept locally), copies DB + files to R2 `ddf-backups`, weekly ntfy report. Restore: `RESTORE.md`.
  - Offline page: Cloudflare Worker `ddf-offline-page` (`cloudflare/offline-worker`). Uptime: `.github/workflows/uptime.yml`.
  - DNS + email forwarding: Cloudflare (moved from Namecheap 2026-11).
  ```

- [ ] **Step 4: Update `CLAUDE.md`.** Append:

  ```md
  ## ddf-intake hosting (read SYSTEM_STATE.md → "Self-hosting")
  - No Supabase. DB = Postgres via `src/lib/db.ts` + repos (`jobs-repo.ts`, `library-repo.ts`). Never put SQL in routes.
  - Files = `src/lib/file-store.ts` + `src/lib/file-tokens.ts`. Keys must pass `isSafeKey`.
  - Tests: `docker compose up -d db && npm test` (uses `ddf_test`; suites truncate it).
  - Deploy = `./scripts/deploy.sh` on the shop PC (WSL2). There is no Vercel deploy any more.
  ```

- [ ] **Step 5 [owner]: Retire Vercel safely.** Vercel → ddf-intake → Settings → **Domains**: remove `jobs.ddfpixel.com`. Settings → **Git**: Disconnect (or set "Ignored Build Step" to `exit 0`). **Don't delete the project.** Keep its env vars until Phase 2 is done.

- [ ] **Step 6: Commit**

```bash
git add RESTORE.md .github/workflows/uptime.yml SYSTEM_STATE.md CLAUDE.md
git commit -m "docs: self-hosting state, restore guide, uptime check"
git push
```

---

### Task 22: Go live

- [ ] **Step 1: Merge.** On the MacBook: `git checkout main && git merge --ff-only supabase-exit && git push`. On the shop PC: `cd ~/ddf-intake && git checkout main && ./scripts/deploy.sh` → `✅ healthy`.

- [ ] **Step 2: Production smoke through Cloudflare** (no `--approve`):

```bash
set -a; source .env; set +a
SMOKE_ADMIN_EMAIL=<owner email> SMOKE_ADMIN_PASSWORD='<owner password>' SMOKE_CLIENT_EMAIL=<owner email> \
SMOKE_DATABASE_URL="postgres://ddf:${POSTGRES_PASSWORD}@127.0.0.1:5433/ddf" SMOKE_FILES_DIR="$DDF_DATA_DIR/files" \
npx tsx scripts/smoke.ts https://jobs.ddfpixel.com
```
Expected: `✅ smoke passed`, cleanup line.

- [ ] **Step 3: Real-flow check from a phone on mobile data:** submit a brief with a photo; admin sees it at `https://jobs.ddfpixel.com/admin`; send yourself a review link and approve it; the **Kanban ticket appears in Command Centre** with a working image link. Then delete that job **by its id** in admin/psql and its ticket in Command Centre.

- [ ] **Step 4: Reboot test.** Restart the shop PC. While it's down, `https://jobs.ddfpixel.com` shows the offline page. Within ~3 minutes of power-on, with nobody touching it, the site is back (auto sign-in → Docker Desktop → containers). If not, revisit Task 19 Step 5.

- [ ] **Step 5: Alerts.** On the PC: `docker compose stop app`. Within 10 minutes the phone gets "DDF intake is DOWN" (ops loop). `docker compose start app`. Run the GitHub `uptime` workflow manually once (Actions → uptime → Run workflow) to confirm it passes.

- [ ] **Step 6 [owner]: Start Phase 2.** Send the Supabase support ticket now (Phase 2 plan, Route A).

- [ ] **Step 7: Final self-check against the spec** (`docs/superpowers/specs/2026-11-15-supabase-exit-design.md`): every D1–D21 decision is implemented or explicitly noted as owner-pending in `SYSTEM_STATE.md`.
