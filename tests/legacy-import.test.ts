import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { hasDb, applySchema, resetTables, rawSql } from './helpers/db'

// Runs the real db/import-legacy.sql against ddf_test, with a throwaway
// database shaped like the old Supabase project standing in for `legacy`.
const LEGACY_DB = 'ddf_legacy_test'

function psql(db: string, input: string, vars: Record<string, string> = {}) {
  const args = ['compose', 'exec', '-T', 'db', 'psql', '-U', 'ddf', '-d', db, '-q']
  for (const [k, v] of Object.entries(vars)) args.push('-v', `${k}=${v}`)
  const r = spawnSync('docker', args, { input, encoding: 'utf8' })
  return { ok: r.status === 0, out: `${r.stdout}${r.stderr}` }
}
const runImport = (vars: Record<string, string> = {}) =>
  psql('ddf_test', readFileSync('db/import-legacy.sql', 'utf8'), { legacy_db: LEGACY_DB, ...vars })

// Old Supabase shape: jobs identity from 1, tenant tables, design library.
const LEGACY_SCHEMA = `
create table tenants (id uuid primary key, slug text not null unique, name text not null);
create table tenant_settings (tenant_id uuid primary key references tenants(id), business_name text,
  logo_url text, brand_color text, reply_to_email text, ntfy_topic text, plan text);
create table jobs (
  id bigint generated always as identity primary key, tenant_id uuid not null references tenants(id),
  reference_number text not null unique, submission_id uuid not null unique, client_name text not null,
  company_name text not null, contact_email text not null, event_name text, date_required date not null,
  notes text, setup_location text, items jsonb not null default '[]', file_paths text[] not null default '{}',
  production jsonb not null default '{}', status text not null default 'pending',
  submitted_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table design_library (id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants(id), name text not null, path text not null,
  created_at timestamptz not null default now());
create table kanban_sync_queue (job_id bigint primary key, reason text);
insert into tenants values ('11111111-1111-1111-1111-111111111111', 'ddf', 'DDF');
insert into tenant_settings values ('11111111-1111-1111-1111-111111111111', 'DDF x Pixel', '/logo-ddfpixel.png', '#b8955a', null, 'ddf-topic', 'trial');
insert into jobs (tenant_id, reference_number, submission_id, client_name, company_name, contact_email,
  date_required, items, file_paths, status, submitted_at, updated_at) overriding system value
select '11111111-1111-1111-1111-111111111111', 'DDF-OLD-' || i, gen_random_uuid(), 'Client ' || i, 'Co', 'c' || i || '@x.co',
  '2026-05-01', jsonb_build_array(jsonb_build_object('name', 'Banner', 'proof_urls', jsonb_build_array('uploads/p' || i || '.pdf'))),
  array['uploads/f' || i || '.png'], 'completed', '2026-04-01T10:00:00Z', '2026-04-02T10:00:00Z'
from generate_series(1, 3) i;
delete from jobs where id = 2;   -- ids have gaps in real life
insert into design_library (tenant_id, name, path) values ('11111111-1111-1111-1111-111111111111', 'Gold arch', 'uploads/lib1.png');
`

describe.skipIf(!hasDb)('db/import-legacy.sql', () => {
  let sql: ReturnType<typeof rawSql>
  let savedSettings: Record<string, unknown>

  function resetLegacy(extra = '') {
    expect(psql('postgres', `drop database if exists ${LEGACY_DB}; create database ${LEGACY_DB};`).ok).toBe(true)
    const r = psql(LEGACY_DB, LEGACY_SCHEMA + extra, { ON_ERROR_STOP: '1' })
    expect(r.ok, r.out).toBe(true)
  }

  beforeAll(async () => {
    applySchema()
    sql = rawSql()
    ;[savedSettings] = await sql`select ts.* from tenant_settings ts join tenants t on t.id = ts.tenant_id where t.slug = 'ddf'`
  })
  beforeEach(async () => { await resetTables(); resetLegacy() })
  afterAll(async () => {
    const s = savedSettings as { business_name: string; logo_url: string; brand_color: string; reply_to_email: string; ntfy_topic: string; tenant_id: string }
    await sql`update tenant_settings set business_name = ${s.business_name}, logo_url = ${s.logo_url}, brand_color = ${s.brand_color},
      reply_to_email = ${s.reply_to_email}, ntfy_topic = ${s.ntfy_topic} where tenant_id = ${s.tenant_id}`
    await sql.end()
    psql('postgres', `drop database if exists ${LEGACY_DB};`)
  })

  it('dry run reports what it would do and changes nothing', async () => {
    const r = runImport({ dry_run: '1' })
    expect(r.ok, r.out).toBe(true)
    expect(r.out).toMatch(/jobs: 2 old, 2 imported now, 0 already imported before, 0 skipped/)
    expect(r.out).toMatch(/DRY RUN/)
    expect((await sql`select count(*)::int as n from jobs`)[0].n).toBe(0)
    expect((await sql`select count(*)::int as n from pg_foreign_server`)[0].n).toBe(0)
  })

  it('imports jobs with their original ids, the design library and branding', async () => {
    const r = runImport()
    expect(r.ok, r.out).toBe(true)
    expect(r.out).toMatch(/old tenants: ddf/)
    expect(r.out).toMatch(/design library: 1 imported now/)
    const jobs = await sql`select j.id::int, j.reference_number, j.items, j.file_paths, j.job_type, j.status,
      j.submitted_at, j.updated_at, t.slug from jobs j join tenants t on t.id = j.tenant_id order by j.id`
    expect(jobs.map(j => j.id)).toEqual([1, 3])
    expect(jobs[1]).toMatchObject({
      reference_number: 'DDF-OLD-3', slug: 'ddf', job_type: 'event', status: 'completed',
      items: [{ name: 'Banner', proof_urls: ['uploads/p3.pdf'] }], file_paths: ['uploads/f3.png'],
    })
    expect(new Date(jobs[1].updated_at).toISOString()).toBe('2026-04-02T10:00:00.000Z')   // not bumped to now()
    expect(await sql`select id::int, name, path from design_library`).toEqual([{ id: 1, name: 'Gold arch', path: 'uploads/lib1.png' }])
    const [s] = await sql`select brand_color, ntfy_topic from tenant_settings ts join tenants t on t.id = ts.tenant_id where t.slug = 'ddf'`
    expect(s).toEqual({ brand_color: '#b8955a', ntfy_topic: 'ddf-topic' })
    // New jobs still get ids from 1,000,000 up.
    const [{ id }] = await sql`insert into jobs (tenant_id, reference_number, submission_id, client_name, company_name, contact_email, date_required)
      select id, 'NEW-1', gen_random_uuid(), 'n', 'n', 'n@x.co', '2030-01-01' from tenants where slug = 'ddf' returning id::int`
    expect(id).toBeGreaterThanOrEqual(1000000)
    expect((await sql`select count(*)::int as n from pg_foreign_server`)[0].n).toBe(0)
  })

  it('is safe to run twice', async () => {
    expect(runImport().ok).toBe(true)
    const r = runImport()
    expect(r.ok, r.out).toBe(true)
    expect(r.out).toMatch(/jobs: 2 old, 0 imported now, 2 already imported before, 0 skipped/)
    expect((await sql`select count(*)::int as n from jobs`)[0].n).toBe(2)
  })

  it('skips an old job whose reference number a newer job already uses, and names it', async () => {
    await sql`insert into jobs (tenant_id, reference_number, submission_id, client_name, company_name, contact_email, date_required)
      select id, 'DDF-OLD-1', gen_random_uuid(), 'n', 'n', 'n@x.co', '2030-01-01' from tenants where slug = 'ddf'`
    const r = runImport()
    expect(r.ok, r.out).toBe(true)
    expect(r.out).toMatch(/1 imported now, 0 already imported before, 1 skipped/)
    expect(r.out).toMatch(/DDF-OLD-1 \(old job 1\)/)
  })

  it('stops without importing anything when an old column has no home in the new schema', async () => {
    resetLegacy(`alter table jobs add column budget numeric;
      alter table jobs alter column setup_location type jsonb using to_jsonb(setup_location);
      alter table jobs alter column notes type varchar(500);`)   // varchar → text is fine
    const r = runImport()
    expect(r.ok).toBe(false)
    expect(r.out).toMatch(/jobs\.budget numeric → MISSING from db\/schema\.sql/)
    expect(r.out).toMatch(/jobs\.setup_location jsonb → live type is text/)
    expect(r.out).not.toMatch(/jobs\.notes/)
    expect((await sql`select count(*)::int as n from jobs`)[0].n).toBe(0)
    expect((await sql`select count(*)::int as n from pg_foreign_server`)[0].n).toBe(0)
  })
})
