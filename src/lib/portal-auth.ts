import 'server-only'
import { cookies } from 'next/headers'
import { verifyPortalToken, PORTAL_COOKIE } from '@/lib/portal-token'

// A client reaches a job through the no-login portal: reference # + email
// mints a job-scoped portal_token cookie (/api/portal/lookup). Every portal
// endpoint funnels its ownership check through here.
// (The second parameter is kept for call-site compatibility; magic-link
// sessions no longer exist.)
export async function portalCanAccess(jobId: number, _jobContactEmail?: string | null): Promise<boolean> {
  const cookieStore = await cookies()
  return verifyPortalToken(cookieStore.get(PORTAL_COOKIE)?.value) === jobId
}
