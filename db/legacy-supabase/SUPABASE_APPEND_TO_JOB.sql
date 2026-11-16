-- ═══════════════════════════════════════════════════════════════════
-- Feature: append-only "Add to Job"
-- Run in: https://supabase.com/dashboard/project/pbgyekhyoihietqjrfpb/sql
--
-- Why: clients can add NEW items and NEW reference files to a job that is
-- already in production, without touching the existing (often already-approved)
-- items. A read-modify-write of the whole `items` array from the API would race
-- with concurrent admin/client edits — same lost-update problem as approvals.
--
-- This function does a single, row-locked, atomic append: it concatenates the
-- new items onto items[] and the new paths onto file_paths[], so existing items
-- are never read into app memory and can never be clobbered.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION append_to_job(
  p_job_id  bigint,
  p_items   jsonb,            -- JSON array of new items to append (may be [])
  p_files   text[] DEFAULT '{}'  -- new job-files paths to append (may be {})
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_items jsonb;
  v_files text[];
BEGIN
  -- FOR UPDATE locks the row: concurrent calls queue here instead of racing.
  SELECT items, file_paths INTO v_items, v_files
  FROM jobs WHERE id = p_job_id FOR UPDATE;
  IF v_items IS NULL THEN
    RAISE EXCEPTION 'job % not found', p_job_id;
  END IF;

  -- Append (|| on jsonb arrays concatenates; array_cat on text[]).
  v_items := v_items || COALESCE(p_items, '[]'::jsonb);
  v_files := array_cat(COALESCE(v_files, '{}'), COALESCE(p_files, '{}'));

  UPDATE jobs SET items = v_items, file_paths = v_files WHERE id = p_job_id;

  RETURN jsonb_build_object('items', v_items, 'file_paths', to_jsonb(v_files));
END;
$$;
