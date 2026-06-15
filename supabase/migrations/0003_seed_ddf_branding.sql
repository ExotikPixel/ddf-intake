-- ════════════════════════════════════════════════════════════════════
-- 0003_seed_ddf_branding.sql — Step 2: per-tenant branding
--
-- 0001 already seeded the DDF tenant's business_name + reply_to_email.
-- This fills in the remaining branding fields (colour + logo) so the app's
-- branding becomes fully data-driven from tenant_settings with NO visible
-- change to DDF (these are DDF's current values).
--
-- Run in: Supabase Dashboard → SQL Editor (ddf-intake project). Idempotent.
-- ════════════════════════════════════════════════════════════════════
update public.tenant_settings s
set brand_color = '#b8955a',          -- DDF's gold brand (matches the site)
    logo_url    = '/logo-ddfpixel.png'
from public.tenants t
where t.id = s.tenant_id
  and t.slug = 'ddf';

select tenant_id, business_name, brand_color, reply_to_email, logo_url
from public.tenant_settings;
