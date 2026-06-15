import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-server'

// Tenant resolution for the multi-tenant (SaaS) layer.
//
// The server uses the service-role key, which BYPASSES Row Level Security.
// So tenant isolation on server paths must be enforced HERE, in app code, by
// always scoping queries to a resolved tenant_id. RLS is only the backstop for
// the browser (anon/authenticated) paths.

// The original single-tenant workspace. Until per-tenant intake URLs exist,
// public intake defaults to this slug.
export const DEFAULT_TENANT_SLUG = 'ddf'

// Cache slug → id for the lifetime of the server instance (tenants are static).
const idBySlug = new Map<string, string>()

/** Resolve a tenant's id from its slug, or null if it doesn't exist. */
export async function getTenantIdBySlug(slug: string): Promise<string | null> {
  const cached = idBySlug.get(slug)
  if (cached) return cached

  const { data, error } = await supabaseAdmin
    .from('tenants')
    .select('id')
    .eq('slug', slug)
    .maybeSingle()

  if (error || !data) return null
  idBySlug.set(slug, data.id)
  return data.id
}

/** The default workspace id (DDF). Throws if the tenant row is missing. */
export async function getDefaultTenantId(): Promise<string> {
  const id = await getTenantIdBySlug(DEFAULT_TENANT_SLUG)
  if (!id) throw new Error(`Default tenant "${DEFAULT_TENANT_SLUG}" not found — run migrations`)
  return id
}

/** The tenant a signed-in staff user belongs to (first membership), or null. */
export async function getTenantIdForUser(userId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('tenant_members')
    .select('tenant_id')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle()

  if (error || !data) return null
  return data.tenant_id
}
