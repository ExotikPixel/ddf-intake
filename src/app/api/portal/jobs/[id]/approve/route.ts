import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { ApprovalActionSchema } from '@/lib/schemas'
import { sendChangeRequestNotification } from '@/lib/email'
import type { JobItem } from '@/lib/job-types'

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
    .select('contact_email, reference_number, client_name, items')
    .eq('id', jobId)
    .single()

  if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (job.contact_email !== user.email) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const items = (job.items ?? []) as JobItem[]
  const item = items[itemIndex]
  if (!item) return NextResponse.json({ error: 'Item not found' }, { status: 404 })
  if (!item.proof_url) {
    return NextResponse.json({ error: 'No proof to review for this item' }, { status: 409 })
  }

  if (action === 'approve') {
    item.approval_status = 'approved'
    item.approved_at = new Date().toISOString()
    item.client_note = undefined
  } else {
    item.approval_status = 'changes_requested'
    item.client_note = note?.trim() || undefined
    item.approved_at = undefined
  }
  items[itemIndex] = item

  const { error } = await supabaseAdmin.from('jobs').update({ items }).eq('id', jobId)
  if (error) return NextResponse.json({ error: 'Update failed' }, { status: 500 })

  // Best-effort: alert the team when a client asks for changes.
  if (action === 'request_changes') {
    await sendChangeRequestNotification(
      { reference_number: job.reference_number, client_name: job.client_name, contact_email: job.contact_email },
      { name: item.name, note: item.client_note }
    )
  }

  return NextResponse.json({ success: true, items })
}
