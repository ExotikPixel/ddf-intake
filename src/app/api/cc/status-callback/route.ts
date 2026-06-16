import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { approvedDayKeys } from '@/lib/kanban-days'
import { NOTIFICATION_STATUSES } from '@/lib/job-types'
import type { JobItem, NotificationStatus } from '@/lib/job-types'
import { sendStatusNotification } from '@/lib/email'
import { getTenantBranding } from '@/lib/tenant-settings'
import { sendNtfy } from '@/lib/ntfy'

export const dynamic = 'force-dynamic'

// Command Centre → intake status loop-back. A Supabase Database Webhook on CC's
// `tasks` table calls this on every task UPDATE; we map the changed day-sticky
// back to its intake job, recompute the job's overall production status, and
// (when it advances) update the client-facing status + email the client.
//
//   any sticky in_progress/done → job "in_progress"  (client: "in production")
//   ALL of the job's stickies done → job "completed"  (client: "ready")
//
// Authenticated by the shared INTAKE_WEBHOOK_SECRET. Never throws.

// Map a CC task status to the intake job status it implies for one day.
type TaskStatus = 'todo' | 'in_progress' | 'done'

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-intake-secret')
  if (!secret || secret !== process.env.INTAKE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let payload: { record?: Record<string, unknown>; old_record?: Record<string, unknown> }
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const record = payload.record ?? (payload as Record<string, unknown>)
  const old    = payload.old_record

  // Only care about our own day-stickies, and only when status actually moved.
  if (!record || record.source !== 'ddf_intake' || typeof record.intake_ref !== 'string') {
    return NextResponse.json({ ignored: 'not a ddf_intake task' })
  }
  if (old && old.status === record.status) {
    return NextResponse.json({ ignored: 'status unchanged' })
  }

  const intakeRef = record.intake_ref            // "<reference_number>::day-<YYYY-MM-DD>"
  const sep = intakeRef.indexOf('::')
  if (sep < 0) return NextResponse.json({ ignored: 'unparseable intake_ref' })
  const referenceNumber = intakeRef.slice(0, sep)
  const dayPart = intakeRef.slice(sep + 2)
  const dayKey  = dayPart.startsWith('day-') ? dayPart.slice(4) : dayPart
  const taskStatus = (record.status as TaskStatus) ?? 'todo'

  try {
    const { data: job } = await supabaseAdmin
      .from('jobs')
      .select('id, status, production, items, date_required, reference_number, client_name, contact_email, notify_client, tenant_id')
      .eq('reference_number', referenceNumber)
      .single()
    if (!job) return NextResponse.json({ ignored: 'job not found' })

    // Record this day's status, then roll the whole job up.
    const production: Record<string, string> = { ...(job.production ?? {}) }
    production[dayKey] = taskStatus

    const expected  = approvedDayKeys((job.items ?? []) as JobItem[], job.date_required)
    const statuses  = expected.map(d => production[d] ?? 'todo')
    const allDone   = expected.length > 0 && statuses.every(s => s === 'done')
    const anyActive = statuses.some(s => s === 'in_progress' || s === 'done')

    const rollup = allDone ? 'completed' : anyActive ? 'in_progress' : job.status

    const patch: Record<string, unknown> = { production }
    const advanced = rollup !== job.status
      && job.status !== 'cancelled'
      && (rollup === 'in_progress' || rollup === 'completed')
    if (advanced) patch.status = rollup

    await supabaseAdmin.from('jobs').update(patch).eq('id', job.id)

    // Tell the client when production starts / finishes (reuses the admin path).
    if (advanced && job.notify_client && job.contact_email
        && (NOTIFICATION_STATUSES as readonly string[]).includes(rollup)) {
      await sendStatusNotification(
        { reference_number: job.reference_number, client_name: job.client_name, contact_email: job.contact_email },
        rollup as NotificationStatus,
        await getTenantBranding(job.tenant_id),
      )
    }

    return NextResponse.json({ ok: true, day: dayKey, day_status: taskStatus, job_status: advanced ? rollup : job.status })
  } catch (err) {
    console.error('[cc-status-callback] failed for', intakeRef, err)
    await sendNtfy({
      title: 'CC→intake status sync FAILED',
      message: `Couldn't apply Command Centre status for ${referenceNumber} (${dayKey}). Client status may be stale.\n${err instanceof Error ? err.message : String(err)}`,
      tags: 'rotating_light',
      priority: 4,
    })
    return NextResponse.json({ error: 'callback failed' }, { status: 500 })
  }
}
