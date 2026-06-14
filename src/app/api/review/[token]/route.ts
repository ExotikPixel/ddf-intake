import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { verifyReviewToken } from '@/lib/review-token'
import type { JobItem } from '@/lib/job-types'

export const dynamic = 'force-dynamic'

// Public: returns the job's reviewable items + signed proof image URLs.
// Auth is the signed token in the URL — no login. Exposes only what the
// review screen needs (no client email or other PII).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const jobId = verifyReviewToken(token)
  if (jobId === null) return NextResponse.json({ error: 'Invalid or expired link' }, { status: 404 })

  const { data: job } = await supabaseAdmin
    .from('jobs')
    .select('reference_number, event_name, date_required, items')
    .eq('id', jobId)
    .single()

  if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const items = (job.items ?? []) as JobItem[]
  const paths = items.map(i => i.proof_url).filter((p): p is string => !!p)

  const proofUrls: Record<string, string> = {}
  if (paths.length > 0) {
    const results = await Promise.all(
      paths.map(p => supabaseAdmin.storage.from('job-files').createSignedUrl(p, 60 * 60))
    )
    results.forEach((r, i) => { if (r.data?.signedUrl) proofUrls[paths[i]] = r.data.signedUrl })
  }

  return NextResponse.json({
    reference_number: job.reference_number,
    event_name: job.event_name,
    date_required: job.date_required,
    items,
    proofUrls,
  })
}
