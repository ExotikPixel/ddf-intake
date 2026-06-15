import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { User } from '@supabase/supabase-js'
import { getTenantIdForUser, getDefaultTenantId } from '@/lib/tenant'

// `tenantId` is the workspace this admin acts within. Always scope job
// queries to it — the service-role client bypasses RLS, so this is the
// real isolation boundary on server paths.
type AdminAuthResult = { user: User; tenantId: string } | { unauthorized: NextResponse }

export async function requireAdmin(): Promise<AdminAuthResult> {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (c) => c.forEach(({ name, value, options }) => cookieStore.set(name, value, options)),
      },
    }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { unauthorized: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  // Prefer tenant membership. Fall back to the legacy single ADMIN_EMAIL so the
  // owner is never locked out before their login is linked to a workspace.
  const memberTenantId = await getTenantIdForUser(user.id)
  const isLegacyAdmin = user.email === process.env.ADMIN_EMAIL

  if (!memberTenantId && !isLegacyAdmin) {
    return { unauthorized: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const tenantId = memberTenantId ?? (await getDefaultTenantId())
  return { user, tenantId }
}
