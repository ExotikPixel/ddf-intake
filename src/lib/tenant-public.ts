import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getTenantIdBySlug } from '@/lib/tenant'

// Branding for the PUBLIC, client-facing pages (intake / proof / portal).
// Unlike getTenantBranding (which fills gaps with DDF defaults for outgoing
// email), this does NOT fall back a tenant's name/logo to DDF — a shop with no
// logo set shows its own name as text, never DDF's logo.

export interface PublicBranding {
  slug: string
  businessName: string
  brandColor: string
  replyToEmail: string | null
  logoUrl: string | null
  logoInvert: boolean   // true only for the DDF lockup (white-on-dark filter)
}

// The default workspace (DDF) — used by the root "/" intake so it stays identical.
export const DDF_DEFAULT_BRANDING: PublicBranding = {
  slug: 'ddf',
  businessName: 'DDF x Pixel',
  brandColor: '#b8955a',
  replyToEmail: 'hello@ddfevents.ca',
  logoUrl: '/logo-ddfpixel.png',
  logoInvert: true,
}

/** Public branding for a tenant by slug, or null if the slug doesn't exist. */
export async function getPublicTenant(slug: string): Promise<PublicBranding | null> {
  const id = await getTenantIdBySlug(slug)
  if (!id) return null
  const { data } = await supabaseAdmin
    .from('tenant_settings')
    .select('business_name, brand_color, reply_to_email, logo_url')
    .eq('tenant_id', id)
    .maybeSingle()
  const logoUrl = data?.logo_url ?? null
  return {
    slug,
    businessName: data?.business_name ?? slug,
    brandColor: data?.brand_color ?? '#b8955a',
    replyToEmail: data?.reply_to_email ?? null,
    logoUrl,
    // The DDF lockup is a black PNG meant to render white on the dark header.
    logoInvert: logoUrl === DDF_DEFAULT_BRANDING.logoUrl,
  }
}
