import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase-server'
import { verifyPortalToken, PORTAL_COOKIE } from '@/lib/portal-token'

export const dynamic = 'force-dynamic'

// Loads the job for a no-login portal session. The page calls this when there's
// no Supabase session: the token cookie is job-scoped, so it returns exactly the
// one job the client looked up (never the account's other jobs — typing an email
// isn't proof of owning it; knowing the reference number is proof of that job).
export async function GET() {
  const cookieStore = await cookies()
  const jobId = verifyPortalToken(cookieStore.get(PORTAL_COOKIE)?.value)
  if (jobId === null) return NextResponse.json({ error: 'No portal session' }, { status: 401 })

  const { data: job } = await supabaseAdmin
    .from('jobs')
    .select('id, reference_number, event_name, date_required, notes, status, submitted_at, items, file_paths, contact_email')
    .eq('id', jobId)
    .single()

  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  const { contact_email, ...rest } = job
  return NextResponse.json({ jobs: [rest], email: contact_email })
}
