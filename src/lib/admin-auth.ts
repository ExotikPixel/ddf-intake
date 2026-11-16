import 'server-only'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, ADMIN_COOKIE, type AdminSession } from '@/lib/session'
import { adminSessionValid } from '@/lib/admin-users'
import { getDefaultTenantId } from '@/lib/tenant'

// `tenantId` is the workspace this admin acts within. Always scope job queries
// to it. Single-tenant today: every admin acts in the default 'ddf' tenant.
type AdminAuthResult = { user: AdminSession; tenantId: string } | { unauthorized: NextResponse }

const unauthorized = () => ({ unauthorized: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) })

export async function requireAdmin(): Promise<AdminAuthResult> {
  const store = await cookies()
  const user = await verifySession(store.get(ADMIN_COOKIE)?.value)
  if (!user) return unauthorized()
  // Removing an admin or resetting their password (session_version bump) revokes access immediately.
  try {
    if (!(await adminSessionValid(user.id, user.v))) return unauthorized()
  } catch (e) {
    console.error('[admin-auth] admin lookup failed:', e)
    return { unauthorized: NextResponse.json({ error: 'Service unavailable' }, { status: 503 }) }
  }
  return { user, tenantId: await getDefaultTenantId() }
}
