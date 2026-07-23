-- SUPABASE_NORMALIZE_EMAILS.sql
-- Run ONCE in the INTAKE Supabase (pbgyekhyoihietqjrfpb) SQL editor.
--
-- Fixes clients who were locked out of their own jobs: intake used to save the
-- email exactly as typed ("John@Company.com "), but sign-in returns it
-- lowercased ("john@company.com"), so the portal matched nothing. New code
-- normalizes on write; this backfills every existing row to match.
--
-- Safe: contact_email has no unique constraint, so lowercasing can't collide.

-- Preview what will change (optional — run this first to eyeball it):
-- select id, reference_number, contact_email, lower(btrim(contact_email)) as normalized
-- from public.jobs
-- where contact_email is distinct from lower(btrim(contact_email));

update public.jobs
set contact_email = lower(btrim(contact_email))
where contact_email is distinct from lower(btrim(contact_email));
