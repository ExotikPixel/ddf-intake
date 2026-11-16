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

-- ── Client experience v2 ────────────────────────────────────────────
alter table public.jobs add column if not exists job_type text not null default 'event';
alter table public.jobs add column if not exists fulfillment text;
alter table public.jobs add column if not exists reminders jsonb not null default '{}'::jsonb;
alter table public.jobs add column if not exists deposit jsonb;

do $$ begin
  alter table public.jobs add constraint jobs_job_type_chk check (job_type in ('event','product'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.jobs add constraint jobs_fulfillment_chk check (fulfillment is null or fulfillment in ('pickup','delivery','install'));
exception when duplicate_object then null; end $$;

create index if not exists jobs_deposit_order_idx on public.jobs ((deposit->>'order_id'));

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
-- Bumped on every password set; cookies carry it so a reset revokes old sessions.
alter table public.admin_users add column if not exists session_version int not null default 0;

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
