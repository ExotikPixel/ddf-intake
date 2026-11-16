-- 0004_job_production_status.sql
-- Command Centre → intake status loop-back. Stores each day-sticky's production
-- status (keyed by the sticky's day, e.g. {"2026-06-22":"done"}) so the job's
-- overall status (received → in_progress → completed) can be rolled up and shown
-- to the client. Written by /api/cc/status-callback.

alter table public.jobs
  add column if not exists production jsonb not null default '{}'::jsonb;
