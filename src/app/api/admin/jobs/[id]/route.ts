import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { requireAdmin } from '@/lib/admin-auth'
import { STATUSES, NOTIFICATION_STATUSES, NotificationStatus, itemProofs } from '@/lib/job-types'
import type { JobItem } from '@/lib/job-types'
import { JobPatchNotifySchema } from '@/lib/schemas'
import { sendStatusNotification } from '@/lib/email'
import { getTenantBranding } from '@/lib/tenant-settings'
import { sendNtfy } from '@/lib/ntfy'

export const dynamic = 'force-dynamic'

const VALID_STATUSES: string[] = [...STATUSES]

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin()
  if ('unauthorized' in auth) return auth.unauthorized

  const { id } = await params
  const jobId = parseInt(id, 10)
  if (isNaN(jobId)) {
    return NextResponse.json({ error: 'Invalid job ID' }, { status: 400 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  // notify_client toggle update
  if ('notify_client' in body) {
    const parsed = JobPatchNotifySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid notify_client value' }, { status: 400 })
    }
    const { error } = await supabaseAdmin
      .from('jobs')
      .update({ notify_client: parsed.data.notify_client })
      .eq('id', jobId).eq('tenant_id', auth.tenantId)
    if (error) return NextResponse.json({ error: 'Update failed' }, { status: 500 })
    return NextResponse.json({ success: true })
  }

  // Status-only update
  if ('status' in body) {
    if (!VALID_STATUSES.includes(body.status as string)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }
    const { error } = await supabaseAdmin
      .from('jobs')
      .update({ status: body.status })
      .eq('id', jobId).eq('tenant_id', auth.tenantId)
    if (error) return NextResponse.json({ error: 'Update failed' }, { status: 500 })

    // Notification: re-fetch job and send if conditions met
    const newStatus = body.status as string
    if ((NOTIFICATION_STATUSES as readonly string[]).includes(newStatus)) {
      const { data: job } = await supabaseAdmin
        .from('jobs')
        .select('reference_number, client_name, contact_email, notify_client')
        .eq('id', jobId).eq('tenant_id', auth.tenantId)
        .single()

      if (!job) {
        return NextResponse.json({ error: 'Job not found' }, { status: 404 })
      }

      if (job.notify_client && job.contact_email) {
        await sendStatusNotification(
          {
            reference_number: job.reference_number,
            client_name: job.client_name,
            contact_email: job.contact_email,
          },
          newStatus as NotificationStatus,
          await getTenantBranding(auth.tenantId)
        )
      } else if (job.notify_client && !job.contact_email) {
        console.warn(`[notify] Job ${jobId} has notify_client=true but no contact_email — skipping send`)
      }
    }

    return NextResponse.json({ success: true })
  }

  // Brief edit update
  if ('date_required' in body || 'event_name' in body || 'notes' in body || 'items' in body || 'file_paths' in body) {
    const patch: Record<string, unknown> = {}
    if ('date_required' in body) patch.date_required = body.date_required
    if ('event_name' in body)   patch.event_name   = body.event_name ?? null
    if ('notes' in body)        patch.notes        = body.notes ?? null

    // When items change, diff approval state for a phone push (admin/staff approval + full approval).
    let approvalPush: { names: string[]; becameFull: boolean; ref: string; company: string } | null = null
    if ('items' in body) {
      patch.items = body.items
      const newItems = (body.items ?? []) as JobItem[]
      const { data: cur } = await supabaseAdmin
        .from('jobs').select('items, reference_number, company_name').eq('id', jobId).eq('tenant_id', auth.tenantId).single()
      const oldItems = (cur?.items ?? []) as JobItem[]
      const newlyApproved = newItems.filter((it, i) =>
        it.approval_status === 'approved' && oldItems[i]?.approval_status !== 'approved')
      if (newlyApproved.length > 0) {
        const proofedNew = newItems.filter(it => itemProofs(it).length > 0)
        const proofedOld = oldItems.filter(it => itemProofs(it).length > 0)
        const fullNow = proofedNew.length > 0 && proofedNew.every(it => it.approval_status === 'approved')
        const fullBefore = proofedOld.length > 0 && proofedOld.every(it => it.approval_status === 'approved')
        approvalPush = {
          names: newlyApproved.map(it => it.name),
          becameFull: fullNow && !fullBefore,
          ref: cur?.reference_number ?? String(jobId),
          company: cur?.company_name ?? '',
        }
      }
    }

    if ('file_paths' in body) {
      const newPaths = body.file_paths as string[]
      // delete removed files from storage
      const { data: current } = await supabaseAdmin
        .from('jobs').select('file_paths').eq('id', jobId).eq('tenant_id', auth.tenantId).single()
      const removed = (current?.file_paths as string[] ?? []).filter(p => !newPaths.includes(p))
      if (removed.length > 0) {
        await supabaseAdmin.storage.from('job-files').remove(removed)
      }
      patch.file_paths = newPaths
    }
    const { error } = await supabaseAdmin
      .from('jobs')
      .update(patch)
      .eq('id', jobId).eq('tenant_id', auth.tenantId)
    if (error) return NextResponse.json({ error: 'Update failed' }, { status: 500 })

    if (approvalPush) {
      await sendNtfy({
        title: 'Design approved',
        message: `${approvalPush.company} (${approvalPush.ref})\nApproved: ${approvalPush.names.join(', ')}`,
        tags: 'white_check_mark',
        priority: 3,
      })
      if (approvalPush.becameFull) {
        await sendNtfy({
          title: 'Job fully approved',
          message: `${approvalPush.company} (${approvalPush.ref}) — all designs approved, ready for production`,
          tags: 'checkered_flag',
          priority: 4,
        })
      }
    }
    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
}
