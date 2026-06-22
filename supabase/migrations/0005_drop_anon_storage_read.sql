-- 0005_drop_anon_storage_read.sql
-- Close an unauthenticated read hole in the private `job-files` bucket.
--
-- The original setup added a storage RLS policy granting the `anon` role
-- SELECT on every object in `job-files`:
--
--     CREATE POLICY "Anon can download job files" ON storage.objects
--       FOR SELECT TO anon USING (bucket_id = 'job-files');
--
-- The anon key ships in the browser bundle, so this let anyone read/list
-- every client's art and proofs in the (otherwise private) bucket without a
-- signed URL.
--
-- The policy was believed to be required for signed-URL downloads, but it is
-- not: Supabase signs signed URLs with a dedicated internal key, separate from
-- the Auth JWT, and validates them server-side. RLS only gates uploads
-- (INSERT/upsert), `list()`, and the `/object/authenticated/` endpoint — never
-- the `/object/sign/` download path. This app downloads exclusively through the
-- service-role client (`supabaseAdmin.storage.from('job-files').createSignedUrl`),
-- so dropping this policy does not affect downloads. The service-role
-- "Service role manages job files" policy remains in place for uploads/management.

DROP POLICY IF EXISTS "Anon can download job files" ON storage.objects;

-- Verify the anon policy is gone (only "Service role manages job files" should remain).
SELECT policyname, roles, cmd
FROM pg_policies
WHERE tablename = 'objects' AND schemaname = 'storage';
