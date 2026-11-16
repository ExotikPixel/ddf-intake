import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getJob } from '@/lib/jobs-repo'
import { verifyPortalToken, PORTAL_COOKIE } from '@/lib/portal-token'
import { publicItems } from '@/lib/job-types'
import type { JobItem } from '@/lib/job-types'

export const dynamic = 'force-dynamic'

// Loads the job for a no-login portal session. The portal page's only data
// source: the token cookie is job-scoped, so it returns exactly the
// one job the client looked up (never the account's other jobs — typing an email
// isn't proof of owning it; knowing the reference number is proof of that job).
export async function GET() {
  const cookieStore = await cookies()
  const jobId = verifyPortalToken(cookieStore.get(PORTAL_COOKIE)?.value)
  if (jobId === null) return NextResponse.json({ error: 'No portal session' }, { status: 401 })

  const { data: job } = await getJob(jobId, ['id', 'reference_number', 'event_name', 'date_required', 'notes', 'status', 'submitted_at', 'items', 'file_paths', 'contact_email', 'setup_location', 'setup_time', 'removal_location', 'removal_time', 'job_type', 'fulfillment'])

  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  const { contact_email, ...rest } = job
  // Strip admin-only fields (quotes) before anything reaches the client.
  return NextResponse.json({ jobs: [{ ...rest, items: publicItems((rest.items ?? []) as JobItem[]) }], email: contact_email })
}
