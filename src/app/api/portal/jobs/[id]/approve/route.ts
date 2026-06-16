import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { ApprovalActionSchema } from '@/lib/schemas'
import { sendChangeRequestNotification } from '@/lib/email'
import { getTenantBranding } from '@/lib/tenant-settings'
import { sendNtfy } from '@/lib/ntfy'
import { itemProofs } from '@/lib/job-types'
import type { JobItem } from '@/lib/job-types'
import { syncApprovedItemsToKanban } from '@/lib/kanban-sync'

export const dynamic = 'force-dynamic'

// Client approves or requests changes on a single item (by index).
// The server merges the change into the stored items array — it never trusts
// a client-supplied items array, so a client can only touch approval fields.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const jobId = parseInt(id, 10)
  if (isNaN(jobId)) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })

  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const parsed = ApprovalActionSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid approval action' }, { status: 400 })
  }
  const { itemIndex, action, note } = parsed.data

  const { data: job } = await supabaseAdmin
    .from('jobs')
    .select('contact_email, reference_number, client_name, items, tenant_id')
    .eq('id', jobId)
    .single()

  if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (job.contact_email !== user.email) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const existingItems = (job.items ?? []) as JobItem[]
  const item = existingItems[itemIndex]
  if (!item) return NextResponse.json({ error: 'Item not found' }, { status: 404 })
  if (itemProofs(item).length === 0) {
    return NextResponse.json({ error: 'No proof to review for this item' }, { status: 409 })
  }

  // Build a patch for exactly one item and apply it atomically (row-locked) so
  // concurrent approvals can't clobber each other. nulls clear a field.
  let patch: Record<string, unknown>
  let appendMessage: { from: string; text: string; at: string } | null = null
  if (action === 'approve') {
    patch = { approval_status: 'approved', approved_at: new Date().toISOString(), client_note: null }
  } else {
    const text = note?.trim() || 'Requested changes.'
    patch = { approval_status: 'changes_requested', client_note: text, approved_at: null, approved_proof_url: null }
    appendMessage = { from: 'client', text, at: new Date().toISOString() }
  }

  const { data: updatedItems, error } = await supabaseAdmin.rpc('update_job_item', {
    p_job_id: jobId, p_index: itemIndex, p_patch: patch, p_append_message: appendMessage,
  })
  if (error) return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  const items = (updatedItems ?? []) as JobItem[]

  // Best-effort: alert the team when a client asks for changes, or push when they approve.
  if (action === 'request_changes') {
    await sendChangeRequestNotification(
      { reference_number: job.reference_number, client_name: job.client_name, contact_email: job.contact_email },
      { name: item.name, note: item.client_note },
      await getTenantBranding(job.tenant_id)
    )
  } else {
    // Push the newly-approved item into Command Centre's Kanban as a job ticket.
    await syncApprovedItemsToKanban(jobId)

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
