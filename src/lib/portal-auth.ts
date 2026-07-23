import 'server-only'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { emailsMatch } from '@/lib/normalize-email'
import { verifyPortalToken, PORTAL_COOKIE } from '@/lib/portal-token'

// A client may reach the portal two ways, and either one authorizes them for a
// job: (1) the new no-login path — a job-scoped portal_token cookie minted by
// /api/portal/lookup; or (2) the legacy magic-link path — a Supabase session
// whose email matches the job's contact_email. Every portal endpoint funnels
// its ownership check through here so the two paths can't drift apart.
export async function portalCanAccess(jobId: number, jobContactEmail: string | null | undefined): Promise<boolean> {
  const cookieStore = await cookies()

  // 1) No-login token — scoped to exactly this job.
  const tokenJobId = verifyPortalToken(cookieStore.get(PORTAL_COOKIE)?.value)
  if (tokenJobId === jobId) return true

  // 2) Logged-in session whose email owns the job.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (user && emailsMatch(jobContactEmail, user.email)) return true

  return false
}
