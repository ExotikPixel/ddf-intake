-- ── Kanban sync retry queue ─────────────────────────────────────────
-- Run this in the Supabase SQL editor BEFORE (or right after) deploying
-- the self-healing Kanban sync. Until it exists, a sync that keeps
-- failing falls back to the old loud ntfy alarm instead of queueing.
--
-- One row per job whose push to Command Centre is failing. Rows are
-- deleted the moment a retry succeeds. Retried by:
--   • quiet in-request retries (30s / 90s after the failed approval)
--   • any later successful sync (piggyback drain)
--   • the daily Vercel cron  GET /api/cron/kanban-retry

create table if not exists kanban_sync_queue (
  job_id          bigint primary key references jobs(id) on delete cascade,
  job_label       text not null,             -- "DDF-… (Client)" for alerts
  reason          text not null,             -- webhook_failed | error
  last_error      text,
  attempts        int  not null default 0,
  first_failed_at timestamptz not null default now(),
  last_attempt_at timestamptz not null default now()
);

-- Server-only table: RLS on with no policies means only the service-role
-- key (the app's server client) can read or write it.
alter table kanban_sync_queue enable row level security;
