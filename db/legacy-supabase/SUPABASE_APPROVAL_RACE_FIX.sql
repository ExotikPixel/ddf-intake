-- ═══════════════════════════════════════════════════════════════════
-- Fix: lost-update race on jobs.items during approval
-- Run in: https://supabase.com/dashboard/project/pbgyekhyoihietqjrfpb/sql
--
-- Why: every approval path read the whole `items` array, flipped one item,
-- and wrote the whole array back. Concurrent approvals (e.g. a client tapping
-- "Approve" down the list quickly) read the same stale array and clobbered
-- each other — last writer wins, so most approvals were silently lost.
--
-- This function does a single, row-locked, atomic update of ONE item index,
-- so concurrent approvals serialize instead of overwriting each other.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION update_job_item(
  p_job_id          bigint,
  p_index           int,
  p_patch           jsonb,            -- fields to shallow-merge onto items[p_index]
  p_append_message  jsonb DEFAULT NULL -- optional chat message to append to items[p_index].messages
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_items jsonb;
  v_item  jsonb;
BEGIN
  -- FOR UPDATE locks the row: concurrent calls queue here instead of racing.
  SELECT items INTO v_items FROM jobs WHERE id = p_job_id FOR UPDATE;
  IF v_items IS NULL THEN
    RAISE EXCEPTION 'job % not found', p_job_id;
  END IF;

  v_item := v_items -> p_index;
  IF v_item IS NULL THEN
    RAISE EXCEPTION 'item % not found in job %', p_index, p_job_id;
  END IF;

  -- Shallow merge, equivalent to { ...item, ...patch }.
  v_item := v_item || p_patch;

  -- Append a chat message atomically, if provided.
  IF p_append_message IS NOT NULL THEN
    v_item := jsonb_set(
      v_item,
      '{messages}',
      COALESCE(v_item -> 'messages', '[]'::jsonb) || jsonb_build_array(p_append_message)
    );
  END IF;

  v_items := jsonb_set(v_items, ARRAY[p_index::text], v_item);
  UPDATE jobs SET items = v_items WHERE id = p_job_id;
  RETURN v_items;
END;
$$;
