-- ═══════════════════════════════════════════════════════════════════
-- DDF Pixel Production — Supabase Setup SQL
-- Run this in: https://supabase.com/dashboard/project/pbgyekhyoihietqjrfpb/sql
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. Enable Row Level Security on jobs table ──────────────────────
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;

-- ── 2. Client portal: authenticated users can view their own jobs ───
-- (matches jobs where contact_email = the signed-in user's email)
DROP POLICY IF EXISTS "Users can view own jobs" ON jobs;
CREATE POLICY "Users can view own jobs"
  ON jobs
  FOR SELECT
  TO authenticated
  USING (contact_email = auth.email());

-- ── 3. Admin: authenticated users can update job status ─────────────
-- Only the ADMIN_EMAIL user can do this — enforced at app layer
-- Service role bypasses RLS automatically (no policy needed for server API)

-- ── 4. Verify policies are in place ─────────────────────────────────
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies
WHERE tablename = 'jobs';

-- ═══════════════════════════════════════════════════════════════════
-- STORAGE — job-files bucket
-- ═══════════════════════════════════════════════════════════════════

-- ── 5. Create the private storage bucket (safe to re-run) ───────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'job-files',
  'job-files',
  false,
  52428800,   -- 50 MB
  ARRAY[
    'image/jpeg', 'image/png', 'image/svg+xml',
    'application/pdf', 'application/postscript', 'application/octet-stream'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- ── 6. Storage RLS: service role can upload/manage ──────────────────
DROP POLICY IF EXISTS "Service role manages job files" ON storage.objects;
CREATE POLICY "Service role manages job files"
  ON storage.objects
  FOR ALL
  TO service_role
  USING (bucket_id = 'job-files')
  WITH CHECK (bucket_id = 'job-files');

-- ── 7. No anon read policy (intentional) ────────────────────────────
-- Do NOT grant the `anon` role SELECT on `job-files`. The anon key ships in
-- the browser bundle, so an anon SELECT policy would let anyone read/list the
-- whole private bucket. Signed URLs do NOT need it: Supabase signs them with a
-- dedicated internal key and validates them server-side; RLS only gates uploads,
-- list(), and /object/authenticated/ — not the /object/sign/ download path.
-- This app downloads exclusively via the service-role client's createSignedUrl.
-- (See migration 0005_drop_anon_storage_read.sql, which removes the old policy.)
DROP POLICY IF EXISTS "Anon can download job files" ON storage.objects;

-- ── 8. Verify storage policies ──────────────────────────────────────
SELECT policyname, roles, cmd
FROM pg_policies
WHERE tablename = 'objects' AND schemaname = 'storage';
