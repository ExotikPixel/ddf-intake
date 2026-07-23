import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { mergeItemsPreservingApproval } from '@/lib/job-types'
import type { JobItem } from '@/lib/job-types'
import { portalCanAccess } from '@/lib/portal-auth'

export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const jobId = parseInt(id, 10)
  if (isNaN(jobId)) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })

  // Verify ownership and status
  const { data: job } = await supabaseAdmin
    .from('jobs')
    .select('contact_email, status, file_paths, items')
    .eq('id', jobId)
    .single()

  if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!(await portalCanAccess(jobId, job.contact_email))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!['pending', 'received'].includes(job.status)) {
    return NextResponse.json({ error: 'This job is already in production, so its brief is locked. To add new items, use “Add to this job”, or contact us for other changes.' }, { status: 409 })
  }

  let body: Record<string, unknown>
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const patch: Record<string, unknown> = {}
  if ('date_required' in body) patch.date_required = body.date_required
  if ('event_name' in body)   patch.event_name   = body.event_name ?? null
  if ('notes' in body)        patch.notes        = body.notes ?? null
  // Server owns approval state — a client brief edit must not clobber approvals
  // (or wipe them) via a full-array write. Merge onto the current DB items.
  if ('items' in body)        patch.items        = mergeItemsPreservingApproval((body.items ?? []) as JobItem[], (job.items ?? []) as JobItem[])
  if ('file_paths' in body) {
    const newPaths = body.file_paths as string[]
    const removed = (job.file_paths as string[] ?? []).filter((p: string) => !newPaths.includes(p))
    if (removed.length > 0) {
      await supabaseAdmin.storage.from('job-files').remove(removed)
    }
    patch.file_paths = newPaths
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const { error } = await supabaseAdmin.from('jobs').update(patch).eq('id', jobId)
  if (error) return NextResponse.json({ error: 'Update failed' }, { status: 500 })

  return NextResponse.json({ success: true })
}
