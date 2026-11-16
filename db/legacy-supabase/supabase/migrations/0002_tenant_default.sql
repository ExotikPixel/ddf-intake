-- ════════════════════════════════════════════════════════════════════
-- 0002_tenant_default.sql — safety net for the NOT NULL tenant_id
--
-- 0001 made jobs.tenant_id NOT NULL, but the currently-deployed app code
-- inserts jobs WITHOUT a tenant_id. Until the tenant-aware code ships, set a
-- column DEFAULT to the DDF tenant so existing inserts keep succeeding.
-- Once the new code passes tenant_id explicitly, that value wins over the default.
--
-- Run in: Supabase Dashboard → SQL Editor (ddf-intake project). Idempotent.
-- ════════════════════════════════════════════════════════════════════
do $$
declare
  ddf uuid;
begin
  select id into ddf from public.tenants where slug = 'ddf';
  if ddf is null then
    raise exception 'DDF tenant not found — run 0001_multi_tenant.sql first';
  end if;
  execute format('alter table public.jobs alter column tenant_id set default %L', ddf);
end $$;
