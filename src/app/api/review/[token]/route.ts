import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { verifyReviewToken } from '@/lib/review-token'
import { itemProofs, itemExamplePhotos } from '@/lib/job-types'
import { getTenantBranding } from '@/lib/tenant-settings'
import type { JobItem } from '@/lib/job-types'
import { signProofDisplayUrls } from '@/lib/proof-sign'

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
    .select('reference_number, event_name, date_required, items, client_name, tenant_id')
    .eq('id', jobId)
    .single()

  if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const items = (job.items ?? []) as JobItem[]
  // Sign current proofs, archived previous versions (so the thread can show history),
  // and any shop example/inspiration photos shown alongside the proofs.
  const paths = items.flatMap(it => [...itemProofs(it), ...(it.proof_history ?? []), ...itemExamplePhotos(it)])

  // Non-image proofs (PDF/AI/EPS) resolve to their preview image or a labelled
  // tile; fileUrls carries the signed original for "Open file".
  const { urls: proofUrls, fileUrls } = paths.length > 0
    ? await signProofDisplayUrls(items, paths)
    : { urls: {}, fileUrls: {} }

  const branding = await getTenantBranding(job.tenant_id)

  return NextResponse.json({
    reference_number: job.reference_number,
    event_name: job.event_name,
    date_required: job.date_required,
    items,
    proofUrls,
    fileUrls,
    clientName: (job.client_name ?? '').split(' ')[0] || 'You',   // first name for thread attribution
    shopName: branding.businessName,
  })
}
