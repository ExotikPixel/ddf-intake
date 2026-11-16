import 'server-only'
import { db } from '@/lib/db'

// Tenant resolution. Only the server connects to the database, so tenant
// isolation on server paths is enforced HERE, in app code, by always scoping
// queries to a resolved tenant_id.

export const DEFAULT_TENANT_SLUG = 'ddf'

// Cache slug → id for the lifetime of the server instance (tenants are static).
const idBySlug = new Map<string, string>()

/** Resolve a tenant's id from its slug, or null if it doesn't exist. */
export async function getTenantIdBySlug(slug: string): Promise<string | null> {
  const cached = idBySlug.get(slug)
  if (cached) return cached
  try {
    const rows = await db()<{ id: string }[]>`select id from tenants where slug = ${slug}`
    if (!rows[0]) return null
    idBySlug.set(slug, rows[0].id)
    return rows[0].id
  } catch (e) {
    console.error('[tenant] lookup failed:', e)
    return null
  }
}

/** The default workspace id (DDF). Throws if the tenant row is missing. */
export async function getDefaultTenantId(): Promise<string> {
  const id = await getTenantIdBySlug(DEFAULT_TENANT_SLUG)
  if (!id) throw new Error(`Default tenant "${DEFAULT_TENANT_SLUG}" not found — apply db/schema.sql`)
  return id
}
