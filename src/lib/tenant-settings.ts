import 'server-only'
import { db } from '@/lib/db'

// Per-tenant branding, read from the tenant_settings table. Every customer
// workspace gets its own name, colour, logo and contact details. Falls back to
// the DDF defaults so the app still works if a row or column is missing.

export interface TenantBranding {
  businessName: string
  brandColor: string
  replyToEmail: string | null
  ntfyTopic: string | null
  logoUrl: string
}

const DEFAULTS: TenantBranding = {
  businessName: process.env.SENDER_NAME ?? 'DDF x Pixel',
  brandColor: '#b8955a',
  replyToEmail: 'hello@ddfevents.ca',
  ntfyTopic: process.env.NTFY_TOPIC_URL ?? null,
  logoUrl: '/logo-ddfpixel.png',
}

/** Branding for a workspace, with DDF defaults filling any gaps. */
export async function getTenantBranding(tenantId: string): Promise<TenantBranding> {
  type Settings = { business_name: string | null; brand_color: string | null; reply_to_email: string | null; ntfy_topic: string | null; logo_url: string | null }
  let data: Settings | null = null
  try {
    const rows = await db()<Settings[]>`
      select business_name, brand_color, reply_to_email, ntfy_topic, logo_url from tenant_settings where tenant_id = ${tenantId}`
    data = rows[0] ?? null
  } catch (e) {
    console.error('[tenant-settings] lookup failed:', e)
  }

  if (!data) return DEFAULTS
  return {
    businessName: data.business_name ?? DEFAULTS.businessName,
    brandColor: data.brand_color ?? DEFAULTS.brandColor,
    replyToEmail: data.reply_to_email ?? DEFAULTS.replyToEmail,
    ntfyTopic: data.ntfy_topic ?? DEFAULTS.ntfyTopic,
    logoUrl: data.logo_url ?? DEFAULTS.logoUrl,
  }
}
