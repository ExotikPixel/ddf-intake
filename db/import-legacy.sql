-- Phase 2: copy the old Supabase rows (restored into database `legacy`) into the
-- live DB. One transaction: all or nothing. Original job ids are kept so review
-- links already emailed to clients work again. Safe to re-run: rows already
-- imported are left alone.
--
-- Normally run by ./scripts/import-legacy.sh. By hand:
--   docker compose exec -T db psql -U ddf -d ddf -v dry_run=1 < db/import-legacy.sql
-- Variables: dry_run (1 = report, then roll back; default 0), legacy_db (default legacy).
--
-- Before copying anything it compares the two schemas and stops, changing
-- nothing, if an old column has no home in db/schema.sql (data would be lost)
-- or has a different type. kanban_sync_queue and Supabase auth.* are not imported.
\set ON_ERROR_STOP 1
\if :{?legacy_db}
\else
  \set legacy_db legacy
\endif
\if :{?dry_run}
\else
  \set dry_run 0
\endif

begin;

set local client_min_messages = warning;   -- hide setup chatter; the report below uses notices
create extension if not exists postgres_fdw;
drop server if exists legacy_srv cascade;
-- Same container, so the Unix socket; the ddf superuser needs no password.
create server legacy_srv foreign data wrapper postgres_fdw options (dbname :'legacy_db');
create user mapping for current_user server legacy_srv options (user 'ddf');
drop schema if exists legacy_fdw cascade;
create schema legacy_fdw;
import foreign schema public limit to (jobs, design_library, tenants, tenant_settings)
  from server legacy_srv into legacy_fdw;

set local client_min_messages = notice;
do $$
declare
  v_ddf       uuid;
  v_problems  text;
  v_cols      text;
  v_max       bigint;
  v_legacy_n  bigint;
  v_already   bigint;
  v_before    bigint;
  v_after     bigint;
  v_clashes   text;
  v_tenants   text;
begin
  select id into v_ddf from public.tenants where slug = 'ddf';
  if v_ddf is null then raise exception 'live database has no ddf tenant'; end if;
  if to_regclass('legacy_fdw.jobs') is null then
    raise exception 'the legacy database has no jobs table — did ./scripts/restore-legacy.sh work?';
  end if;

  -- 1. Schema check: every old jobs / design_library column must exist in the
  --    live table with the same type. tenant_id is remapped, so it's exempt.
  select string_agg(format('  %s.%s %s → %s', l.table_name, l.column_name, l.udt_name,
                           coalesce('live type is ' || n.udt_name, 'MISSING from db/schema.sql')), E'\n'
                    order by l.table_name, l.ordinal_position)
    into v_problems
  from information_schema.columns l
  left join information_schema.columns n
    on n.table_schema = 'public' and n.table_name = l.table_name and n.column_name = l.column_name
  where l.table_schema = 'legacy_fdw' and l.table_name in ('jobs', 'design_library')
    and l.column_name <> 'tenant_id'
    and (n.column_name is null or (n.udt_name <> l.udt_name
         -- widening that loses nothing
         and (l.udt_name, n.udt_name) not in (('varchar','text'), ('bpchar','text'), ('int2','int4'), ('int2','int8'), ('int4','int8'))));
  if v_problems is not null then
    raise exception E'old columns that don''t fit the new schema — nothing was imported:\n%\nAdd them to db/schema.sql (alter table … add column if not exists …), deploy, and run this again.', v_problems;
  end if;

  if to_regclass('legacy_fdw.tenants') is not null then
    select string_agg(slug, ', ' order by slug) into v_tenants from legacy_fdw.tenants;
    raise notice 'old tenants: % (all jobs go to ddf)', coalesce(v_tenants, 'none');
  end if;

  -- 2. Jobs, keeping their ids. New jobs start at 1,000,000, so old ids must be below that.
  select max(id), count(*) into v_max, v_legacy_n from legacy_fdw.jobs;
  if v_max >= 1000000 then
    raise exception 'old job id % collides with the new id range (>= 1,000,000)', v_max;
  end if;
  select count(*) into v_already from public.jobs j where j.id in (select id from legacy_fdw.jobs);

  select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position) into v_cols
  from information_schema.columns c
  where c.table_schema = 'legacy_fdw' and c.table_name = 'jobs' and c.column_name <> 'tenant_id';

  select count(*) into v_before from public.jobs;
  execute format(
    'insert into public.jobs (tenant_id, %1$s) overriding system value
     select %2$L::uuid, %1$s from legacy_fdw.jobs order by id
     on conflict do nothing', v_cols, v_ddf);
  select count(*) into v_after from public.jobs;

  -- Old jobs still missing now clashed with a newer job's reference number or submission id.
  select string_agg(format('%s (old job %s)', l.reference_number, l.id), ', ' order by l.id) into v_clashes
  from legacy_fdw.jobs l where not exists (select 1 from public.jobs j where j.id = l.id);

  raise notice 'jobs: % old, % imported now, % already imported before, % skipped',
    v_legacy_n, v_after - v_before, v_already, v_legacy_n - v_already - (v_after - v_before);
  if v_clashes is not null then
    raise notice 'skipped (same reference/submission as a newer job): %', v_clashes;
  end if;

  -- 3. Design library (old ids also start at 1, well below 1,000,000).
  if to_regclass('legacy_fdw.design_library') is not null then
    select count(*) into v_before from public.design_library;
    insert into public.design_library (id, tenant_id, name, path, created_at) overriding system value
    select id, v_ddf, name, path, created_at from legacy_fdw.design_library order by id
    on conflict do nothing;
    select count(*) into v_after from public.design_library;
    raise notice 'design library: % imported now', v_after - v_before;
  end if;

  -- 4. DDF branding as it was set in Supabase (only fills values the old project had).
  if to_regclass('legacy_fdw.tenant_settings') is not null and to_regclass('legacy_fdw.tenants') is not null then
    update public.tenant_settings s
    set business_name  = coalesce(l.business_name, s.business_name),
        logo_url       = coalesce(l.logo_url, s.logo_url),
        brand_color    = coalesce(l.brand_color, s.brand_color),
        reply_to_email = coalesce(l.reply_to_email, s.reply_to_email),
        ntfy_topic     = coalesce(l.ntfy_topic, s.ntfy_topic)
    from legacy_fdw.tenant_settings l
    join legacy_fdw.tenants lt on lt.id = l.tenant_id and lt.slug = 'ddf'
    where s.tenant_id = v_ddf;
    raise notice 'branding: % row updated', (case when found then 1 else 0 end);
  end if;
end $$;

set local client_min_messages = warning;
drop schema legacy_fdw cascade;
drop server legacy_srv cascade;

\if :dry_run
rollback;
\echo 'DRY RUN: nothing was changed. The numbers above are what the real import will do.'
\else
commit;
\echo 'Import committed.'
\endif
