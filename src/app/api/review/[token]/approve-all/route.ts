import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { verifyReviewToken } from '@/lib/review-token'
import { sendNtfy } from '@/lib/ntfy'
import { itemProofs, designsMode } from '@/lib/job-types'
import type { JobItem } from '@/lib/job-types'
import { syncApprovedItemsToKanban } from '@/lib/kanban-sync'

export const dynamic = 'force-dynamic'

// Public: approve every ready item in one action. "Ready" = has a proof and is
// not already approved. Pick-one items with several designs need an explicit
// choice (passed in `selections`, keyed by item index); without one they are
// skipped and reported so the client can approve them individually.
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const jobId = verifyReviewToken(token)
  if (jobId === null) return NextResponse.json({ error: 'Invalid or expired link' }, { status: 404 })

  let selections: Record<string, string> = {}
  try {
    const body = await req.json()
    if (body && typeof body === 'object' && body.selections && typeof body.selections === 'object') {
      selections = body.selections as Record<string, string>
    }
  } catch { /* no body / bad JSON — treat as no selections */ }

  const { data: job } = await supabaseAdmin
    .from('jobs')
    .select('reference_number, client_name, items, tenant_id')
    .eq('id', jobId)
    .single()
  if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const existingItems = (job.items ?? []) as JobItem[]
  const approvedNames: string[] = []
  let skipped = 0

  // Apply each approval through the same atomic, row-locked RPC the single-item
  // route uses, so a concurrent change can never be clobbered. Item indices are
  // stable for the life of this request.
  for (let idx = 0; idx < existingItems.length; idx++) {
    const item = existingItems[idx]
    const proofs = itemProofs(item)
    if (proofs.length === 0) continue                  // nothing to review
    if (item.approval_status === 'approved') continue  // already done

    let approvedProof: string | null
    const pickMode = proofs.length > 1 && designsMode(item) === 'pick'
    if (pickMode) {
      const choice = selections[String(idx)]
      if (!choice || !proofs.includes(choice)) { skipped++; continue }  // needs an explicit pick
      approvedProof = choice
    } else {
      approvedProof = proofs.length === 1 ? proofs[0] : null
    }

    const patch = {
      approval_status: 'approved',
      approved_at: new Date().toISOString(),
      approved_proof_url: approvedProof,
      client_note: null,
    }
    const { error } = await supabaseAdmin.rpc('update_job_item', {
      p_job_id: jobId, p_index: idx, p_patch: patch, p_append_message: null,
    })
    if (!error) approvedNames.push(item.name)
  }

  // Re-read once for a consistent post-state to return and notify on.
  const { data: fresh } = await supabaseAdmin.from('jobs').select('items').eq('id', jobId).single()
  const items = (fresh?.items ?? existingItems) as JobItem[]

  if (approvedNames.length > 0) {
    await syncApprovedItemsToKanban(jobId)
    const proofed = items.filter(it => itemProofs(it).length > 0)
    const full = proofed.length > 0 && proofed.every(it => it.approval_status === 'approved')
    await sendNtfy({
      title: approvedNames.length > 1 ? 'Client approved designs' : 'Client approved a design',
      message: `${job.client_name} (${job.reference_number})\nApproved: ${approvedNames.join(', ')}`,
      tags: 'white_check_mark',
      priority: 4,
    })
    if (full) {
      await sendNtfy({
        title: 'Job fully approved',
        message: `${job.reference_number} — all designs approved, ready for production`,
        tags: 'checkered_flag',
        priority: 4,
      })
    }
  }

  return NextResponse.json({ success: true, items, approvedCount: approvedNames.length, skipped })
}
