-- SUPABASE_DESIGN_LIBRARY.sql
-- Run in the INTAKE Supabase (pbgyekhyoihietqjrfpb) SQL editor before deploying
-- the design-library feature.
--
-- Reusable "stock" design images (a white stage, standard backdrops, …) the
-- admin can attach to items without re-uploading each time. The files live in
-- the existing job-files bucket under the normal uploads/ prefix — this table
-- is only the catalogue. Deleting a row never deletes the storage object, so
-- jobs that already attached the design keep working.

create table if not exists public.design_library (
  id          bigint generated always as identity primary key,
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null,
  path        text not null,
  created_at  timestamptz not null default now()
);

create index if not exists design_library_tenant_idx
  on public.design_library (tenant_id, created_at desc);

-- All access goes through the service-role key in /api/admin/library (same
-- pattern as jobs). RLS on with no policies = locked for anon/authed clients.
alter table public.design_library enable row level security;
