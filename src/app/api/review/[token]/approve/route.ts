import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { verifyReviewToken } from '@/lib/review-token'
import { ApprovalActionSchema } from '@/lib/schemas'
import { sendChangeRequestNotification } from '@/lib/email'
import { getTenantBranding } from '@/lib/tenant-settings'
import { sendNtfy } from '@/lib/ntfy'
import { itemProofs } from '@/lib/job-types'
import type { JobItem } from '@/lib/job-types'

export const dynamic = 'force-dynamic'

// Public approve / request-changes via signed link. Same safe server-side
// merge as the portal route — only approval fields on one item change.
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const jobId = verifyReviewToken(token)
  if (jobId === null) return NextResponse.json({ error: 'Invalid or expired link' }, { status: 404 })

  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const parsed = ApprovalActionSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid approval action' }, { status: 400 })
  const { itemIndex, action, note, selectedProof } = parsed.data

  const { data: job } = await supabaseAdmin
    .from('jobs')
    .select('reference_number, client_name, contact_email, items, tenant_id')
    .eq('id', jobId)
    .single()

  if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const items = (job.items ?? []) as JobItem[]
  const item = items[itemIndex]
  if (!item) return NextResponse.json({ error: 'Item not found' }, { status: 404 })
  if (itemProofs(item).length === 0) return NextResponse.json({ error: 'No proof to review for this item' }, { status: 409 })

  const proofs = itemProofs(item)
  if (action === 'approve') {
    // When several designs are offered, the client must pick exactly one.
    if (proofs.length > 1) {
      if (!selectedProof || !proofs.includes(selectedProof)) {
        return NextResponse.json({ error: 'Please choose which design to approve' }, { status: 400 })
      }
      item.approved_proof_url = selectedProof
    } else {
      item.approved_proof_url = proofs[0]
    }
    item.approval_status = 'approved'
    item.approved_at = new Date().toISOString()
    item.client_note = undefined
  } else {
    const text = note?.trim() || 'Requested changes.'
    item.approval_status = 'changes_requested'
    item.client_note = text                                   // legacy mirror of the latest request
    item.messages = [...(item.messages ?? []), { from: 'client', text, at: new Date().toISOString() }]
    item.approved_at = undefined
    item.approved_proof_url = undefined
  }
  items[itemIndex] = item

  const { error } = await supabaseAdmin.from('jobs').update({ items }).eq('id', jobId)
  if (error) return NextResponse.json({ error: 'Update failed' }, { status: 500 })

  if (action === 'request_changes') {
    await sendChangeRequestNotification(
      { reference_number: job.reference_number, client_name: job.client_name, contact_email: job.contact_email },
      { name: item.name, note: item.client_note },
      await getTenantBranding(job.tenant_id)
    )
  } else {
    const proofed = items.filter(it => itemProofs(it).length > 0)
    const full = proofed.length > 0 && proofed.every(it => it.approval_status === 'approved')
    await sendNtfy({
      title: 'Client approved a design',
      message: `${job.client_name} (${job.reference_number})\nApproved: ${item.name}`,
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

  return NextResponse.json({ success: true, items })
}
