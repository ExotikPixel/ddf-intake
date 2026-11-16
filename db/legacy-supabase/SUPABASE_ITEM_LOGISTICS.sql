-- ═══════════════════════════════════════════════════════════════════
-- Feature: job setup/removal logistics
-- Run in: https://supabase.com/dashboard/project/pbgyekhyoihietqjrfpb/sql
--
-- Adds four free-text columns to jobs for crew logistics (one set per job).
-- Per-item reference photos + description live inside the items JSONB column,
-- so they need no migration.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS setup_location   text,
  ADD COLUMN IF NOT EXISTS setup_time       text,
  ADD COLUMN IF NOT EXISTS removal_location text,
  ADD COLUMN IF NOT EXISTS removal_time     text;
