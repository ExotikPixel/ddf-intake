import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { AddToJobSchema } from '@/lib/schemas'
import { sendNtfy } from '@/lib/ntfy'
import { sendAddedToJobNotification } from '@/lib/email'
import { getTenantBranding } from '@/lib/tenant-settings'
import type { JobItem } from '@/lib/job-types'

export const dynamic = 'force-dynamic'

// Client appends NEW items and/or NEW reference files to an EXISTING job.
// Append-only: the server never reads the client's view of the existing items,
// so already-approved/in-production items can't be touched. The append itself
// is done in a row-locked RPC so it can't race with admin or approval edits.
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
  const parsed = AddToJobSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 400 })
  }
  const { newItems = [], newFilePaths = [] } = parsed.data

  // Ownership + status gate. Append is allowed while a job is live, but never
  // once it's completed (or cancelled) — at that point the job is closed.
  const { data: job } = await supabaseAdmin
    .from('jobs')
    .select('contact_email, reference_number, company_name, client_name, status, tenant_id')
    .eq('id', jobId)
    .single()

  if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (job.contact_email !== user.email) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!['received', 'in_progress'].includes(job.status)) {
    return NextResponse.json({ error: 'This job is closed and cannot take new items.' }, { status: 409 })
  }

  // Stamp each new item: mark when it was added and reset approval to pending so
  // it flows through the normal proof/approval cycle like any other item.
  const at = new Date().toISOString()
  const stamped: JobItem[] = newItems.map(it => ({
    ...it,
    added_at: at,
    approval_status: 'pending' as const,
  }))

  const { data: result, error } = await supabaseAdmin.rpc('append_to_job', {
    p_job_id: jobId,
    p_items: stamped,
    p_files: newFilePaths,
  })
  if (error) {
    console.error('[add-to-job] rpc error:', error)
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }

  const items = (result?.items ?? []) as JobItem[]
  const filePaths = (result?.file_paths ?? []) as string[]

  // Best-effort alerts (phone push + admin email) so the team sees mid-job
  // additions. Neither failure blocks the append, which is already committed.
  const parts: string[] = []
  if (stamped.length) parts.push(`${stamped.length} item${stamped.length !== 1 ? 's' : ''}`)
  if (newFilePaths.length) parts.push(`${newFilePaths.length} file${newFilePaths.length !== 1 ? 's' : ''}`)
  const brand = await getTenantBranding(job.tenant_id)
  await Promise.allSettled([
    sendNtfy({
      title: 'Client added to a job',
      message: `${job.company_name} — ${job.client_name}\nAdded ${parts.join(' + ')}\nRef ${job.reference_number}`,
      tags: 'heavy_plus_sign',
      priority: 4,
    }),
    sendAddedToJobNotification(
      { reference_number: job.reference_number, client_name: job.client_name, contact_email: job.contact_email },
      { items: stamped.map(it => ({ name: it.name, quantity: it.quantity, size: it.size })), fileCount: newFilePaths.length },
      brand,
    ).catch(e => console.error('[add-to-job] email failed:', e)),
  ])

  return NextResponse.json({ success: true, items, file_paths: filePaths })
}
