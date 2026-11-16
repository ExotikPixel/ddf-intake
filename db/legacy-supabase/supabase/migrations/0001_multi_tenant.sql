-- ════════════════════════════════════════════════════════════════════
-- 0001_multi_tenant.sql — Step 1 of SaaS productization
-- Adds multi-tenancy (workspaces) + tenant-aware Row Level Security.
--
-- SAFE / NON-BREAKING: existing single-tenant app keeps working.
--   • The server uses the service-role key, which BYPASSES RLS.
--   • All existing jobs are backfilled into one default "DDF" tenant.
--   • The portal's email-based policy is preserved.
--
-- Run in: Supabase Dashboard → SQL Editor → New Query (idempotent — re-runnable).
-- ════════════════════════════════════════════════════════════════════

-- pgcrypto provides gen_random_uuid() (enabled by default on Supabase).
create extension if not exists pgcrypto;

-- ── 1. TENANTS (a workspace = one customer business) ────────────────
create table if not exists public.tenants (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,          -- used in URLs: /{slug} or {slug}.app...
  name        text not null,
  created_at  timestamptz not null default now()
);

-- ── 2. TENANT SETTINGS (branding + billing, one row per tenant) ─────
create table if not exists public.tenant_settings (
  tenant_id               uuid primary key references public.tenants(id) on delete cascade,
  business_name           text,
  logo_url                text,
  brand_color             text,
  reply_to_email          text,
  ntfy_topic              text,
  -- Billing (Square — see ddf-payment-square memory)
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

-- ── 3. TENANT MEMBERS (maps Supabase Auth users → tenant + role) ────
-- Replaces the single hardcoded ADMIN_EMAIL. Staff log in and are scoped
-- to the tenant(s) they belong to.
create table if not exists public.tenant_members (
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null default 'staff' check (role in ('owner','admin','staff')),
  created_at  timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

create index if not exists tenant_members_user_idx on public.tenant_members (user_id);

-- ── 4. ADD tenant_id TO jobs ────────────────────────────────────────
alter table public.jobs add column if not exists tenant_id uuid references public.tenants(id);
create index if not exists jobs_tenant_idx on public.jobs (tenant_id);

-- ════════════════════════════════════════════════════════════════════
-- 5. BACKFILL — move existing data into one default "DDF" tenant
-- ════════════════════════════════════════════════════════════════════
do $$
declare
  ddf_id uuid;
begin
  -- Create (or fetch) the default DDF tenant.
  insert into public.tenants (slug, name)
  values ('ddf', 'DDF x Pixel')
  on conflict (slug) do nothing;

  select id into ddf_id from public.tenants where slug = 'ddf';

  -- Seed its settings (only if missing).
  insert into public.tenant_settings (tenant_id, business_name, reply_to_email, plan, plan_status)
  values (ddf_id, 'DDF x Pixel', 'hello@ddfevents.ca', 'pro', 'active')
  on conflict (tenant_id) do nothing;

  -- Backfill every existing job into the DDF tenant.
  update public.jobs set tenant_id = ddf_id where tenant_id is null;

  -- Make the current ADMIN_EMAIL user an owner of DDF, if that user exists.
  insert into public.tenant_members (tenant_id, user_id, role)
  select ddf_id, u.id, 'owner'
  from auth.users u
  where u.email = current_setting('app.admin_email', true)
  on conflict do nothing;
end $$;

-- Now that existing rows are backfilled, require tenant_id going forward.
alter table public.jobs alter column tenant_id set not null;

-- ════════════════════════════════════════════════════════════════════
-- 6. ROW LEVEL SECURITY
-- ════════════════════════════════════════════════════════════════════
alter table public.tenants         enable row level security;
alter table public.tenant_settings enable row level security;
alter table public.tenant_members  enable row level security;
-- jobs already has RLS enabled.

-- Helper: is the current authenticated user a member of this tenant?
create or replace function public.is_tenant_member(t uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tenant_members m
    where m.tenant_id = t and m.user_id = auth.uid()
  );
$$;

-- ── jobs policies ───────────────────────────────────────────────────
-- Drop the old single-tenant policies; replace with tenant-aware ones.
drop policy if exists "No public access"      on public.jobs;
drop policy if exists "Users can view own jobs" on public.jobs;

-- (a) Staff: members can read/write jobs in their own tenant(s).
drop policy if exists "Members manage tenant jobs" on public.jobs;
create policy "Members manage tenant jobs"
  on public.jobs for all
  to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

-- (b) Clients: a logged-in end-client can still view jobs matching their email.
--     (Preserves current portal behavior. Read-only.)
drop policy if exists "Clients view own jobs by email" on public.jobs;
create policy "Clients view own jobs by email"
  on public.jobs for select
  to authenticated
  using (contact_email = auth.email());

-- ── tenant_members policies ─────────────────────────────────────────
drop policy if exists "Members read own memberships" on public.tenant_members;
create policy "Members read own memberships"
  on public.tenant_members for select
  to authenticated
  using (user_id = auth.uid());

-- ── tenants / tenant_settings policies ──────────────────────────────
drop policy if exists "Members read own tenant" on public.tenants;
create policy "Members read own tenant"
  on public.tenants for select
  to authenticated
  using (public.is_tenant_member(id));

drop policy if exists "Members read own settings" on public.tenant_settings;
create policy "Members read own settings"
  on public.tenant_settings for select
  to authenticated
  using (public.is_tenant_member(tenant_id));

-- NOTE: All server-side writes go through the service-role key, which bypasses
-- every policy above. App code MUST still filter by tenant_id on those paths —
-- RLS is the backstop for the anon/authenticated (browser) paths only.

-- ── 7. Verify ───────────────────────────────────────────────────────
select 'tenants' as t, count(*) from public.tenants
union all select 'jobs w/ tenant', count(*) from public.jobs where tenant_id is not null
union all select 'jobs w/o tenant', count(*) from public.jobs where tenant_id is null;
