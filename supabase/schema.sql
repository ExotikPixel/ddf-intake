-- DDF-Pixel Job Intake System — Supabase Schema
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New Query)

-- ============================================================
-- JOBS TABLE
-- ============================================================
create table if not exists public.jobs (
  id                bigint generated always as identity primary key,
  reference_number  text not null unique,
  submission_id     uuid not null unique,        -- idempotency key
  client_name       text not null,
  company_name      text not null,
  contact_email     text not null,
  event_name        text,
  date_required     date not null,
  notes             text,
  items             jsonb not null default '[]',
  file_paths        text[] not null default '{}',
  status            text not null default 'pending'
                    check (status in ('pending', 'received', 'in_progress', 'completed', 'cancelled')),
  submitted_at      timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Auto-update updated_at on row change
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger jobs_updated_at
  before update on public.jobs
  for each row execute function public.set_updated_at();

-- Index for email lookups and status filtering
create index if not exists jobs_contact_email_idx on public.jobs (contact_email);
create index if not exists jobs_status_idx on public.jobs (status);
create index if not exists jobs_submitted_at_idx on public.jobs (submitted_at desc);

-- ============================================================
-- ROW LEVEL SECURITY
-- Only the service-role key (server-side) can read/write.
-- The anon key (used for upload-url route) has no table access.
-- ============================================================
alter table public.jobs enable row level security;

-- Service role bypasses RLS automatically — no policy needed for it.
-- Add a deny-all policy for anon/authenticated to be explicit:
create policy "No public access"
  on public.jobs
  for all
  to anon, authenticated
  using (false);

-- ============================================================
-- STORAGE BUCKET: job-files (PRIVATE)
-- ============================================================
-- Run this in the Supabase Dashboard → Storage → New Bucket
-- OR run via SQL (requires pg_net extension, simpler to do in Dashboard UI):
--
--   Bucket name: job-files
--   Public:      NO  (private — signed URLs only)
--   Max file size: 52428800  (50 MB)
--   Allowed MIME types: image/jpeg, image/png, image/webp, image/gif,
--                       application/pdf, application/zip,
--                       application/illustrator, image/svg+xml
--
-- After creating the bucket, add this Storage policy:
-- Policy name: "Service role full access"
-- Allowed operations: SELECT, INSERT, UPDATE, DELETE
-- Target roles: service_role
-- Policy definition: true

-- ============================================================
-- NOTES FOR SETUP
-- ============================================================
-- 1. Copy your Supabase URL and anon key from:
--    Dashboard → Project Settings → API
--
-- 2. Copy your service role key from:
--    Dashboard → Project Settings → API → service_role (secret)
--
-- 3. Add these to your .env.local:
--    NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
--    NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
--    SUPABASE_SERVICE_ROLE_KEY=eyJ...  (SERVER ONLY — never expose)
