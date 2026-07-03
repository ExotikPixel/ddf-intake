import { after } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { approvedProofs, itemProofs } from '@/lib/job-types'
import type { JobItem } from '@/lib/job-types'
import { sendNtfy } from '@/lib/ntfy'
import { DATE_PREFIX, cap, resolveDate, fmtDate } from '@/lib/kanban-days'

// Push approved items into Command Centre's Kanban as printable job tickets.
// Fired automatically whenever an item is approved (admin, portal, or review).
//
//   • One CC project per intake job.
//   • One ticket (task) per EVENT, not per item. Items that share a
//     "June 22 - Caledon Country Club - …" prefix collapse into one tile;
//     items with no date prefix fall into the job's "main event" tile.
//   • Each ticket lists every item (qty × clean name · size · material) and
//     carries ALL approved design images for that event, so the crew prints
//     one ticket per event.
//   • Title is "Venue/Occasion — Clients" (e.g. "Embassy Grand — Balreen & Ranjit").
//   • Idempotent (CC upserts per event key); never throws; never blocks approval.
//
// Self-healing: a failed push quietly retries at 30s and 90s after the
// response is sent; if it's still failing it lands in kanban_sync_queue
// (see SUPABASE_KANBAN_RETRY_QUEUE.sql) and is retried by later sync
// activity and the daily /api/cron/kanban-retry cron. The phone only
// alarms when the retries themselves keep failing.

const PROOF_TTL_SECONDS = 60 * 60 * 24 * 90 // 90 days — tickets can sit for weeks
const QUIET_RETRY_DELAYS_MS = [30_000, 90_000]
const RETRY_COOLDOWN_MS = 5 * 60_000        // don't re-attempt a queued job more often than this

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export type KanbanSyncResult =
  | { ok: true; tickets: number }
  | { ok: false; reason: 'not_configured' | 'not_found' | 'none_approved' | 'webhook_failed' | 'error' }

type AttemptResult =
  | { ok: true; tickets: number; label: string }
  | { ok: false; reason: 'not_configured' | 'not_found' | 'none_approved'; label: string }
  | { ok: false; reason: 'webhook_failed' | 'error'; label: string; detail: string }

export async function syncApprovedItemsToKanban(jobId: number): Promise<KanbanSyncResult> {
  const first = await attemptSync(jobId)

  if (first.ok) {
    await clearQueued(jobId)
    // Any successful sync is a chance to heal other stuck jobs without
    // waiting for the daily cron.
    after(() => drainKanbanQueue({ limit: 3 }))
    return { ok: true, tickets: first.tickets }
  }

  if (first.reason === 'webhook_failed' || first.reason === 'error') {
    const { label, detail, reason } = first
    after(async () => {
      for (const delay of QUIET_RETRY_DELAYS_MS) {
        await sleep(delay)
        const retry = await attemptSync(jobId)
        if (retry.ok) {
          await clearQueued(jobId)
          console.log('[kanban-sync] recovered on quiet retry:', label)
          return
        }
      }
      // ~2 minutes of quiet retries exhausted — hand off to the queue and
      // tell the phone once (softly; the cron alarms loudly if it persists).
      const queued = await enqueueForRetry(jobId, label, reason, detail)
      await sendNtfy({
        title: 'Kanban sync failing - auto-retry queued',
        message: queued
          ? `${label} didn't reach Command Centre after 3 attempts (${detail}). Approved designs are NOT on the board yet — it will keep retrying automatically.`
          : `${label} didn't reach Command Centre after 3 attempts (${detail}) AND couldn't be queued for auto-retry (has SUPABASE_KANBAN_RETRY_QUEUE.sql been run?). Use Resync manually.`,
        tags: 'warning',
        priority: queued ? 4 : 5,
      })
    })
  }

  return { ok: false, reason: first.reason }
}

/**
 * Retry every queued job that hasn't been attempted in the last few minutes,
 * oldest failure first. Used by the daily cron (large limit) and piggybacked
 * after any successful sync (small limit). Notifies on recoveries, and alarms
 * on jobs that keep failing.
 */
export async function drainKanbanQueue(opts: { limit?: number } = {}): Promise<{
  checked: number
  recovered: string[]
  failing: string[]
}> {
  const limit = opts.limit ?? 20
  const cutoff = new Date(Date.now() - RETRY_COOLDOWN_MS).toISOString()

  const { data: rows, error } = await supabaseAdmin
    .from('kanban_sync_queue')
    .select('job_id, job_label, attempts, first_failed_at')
    .lt('last_attempt_at', cutoff)
    .order('first_failed_at', { ascending: true })
    .limit(limit)
  if (error) {
    console.error('[kanban-retry] queue read failed:', error)
    return { checked: 0, recovered: [], failing: [] }
  }

  const recovered: string[] = []
  const failing: string[] = []

  for (const row of rows ?? []) {
    const r = await attemptSync(row.job_id)
    if (r.ok || r.reason === 'not_found' || r.reason === 'none_approved') {
      // Synced — or there's nothing left to sync; either way the entry is spent.
      await clearQueued(row.job_id)
      if (r.ok) recovered.push(row.job_label)
    } else {
      await supabaseAdmin
        .from('kanban_sync_queue')
        .update({
          attempts:        row.attempts + 1,
          last_error:      'detail' in r ? r.detail : 'webhook env vars missing',
          last_attempt_at: new Date().toISOString(),
        })
        .eq('job_id', row.job_id)
      const ageH = Math.max(1, Math.round((Date.now() - new Date(row.first_failed_at).getTime()) / 3_600_000))
      failing.push(`${row.job_label} — ${row.attempts + 1} attempts over ${ageH}h`)
    }
  }

  if (recovered.length) {
    await sendNtfy({
      title: 'Kanban sync recovered',
      message: `Back on the board: ${recovered.join(', ')}`,
      tags: 'white_check_mark',
      priority: 3,
    })
  }
  if (failing.length) {
    await sendNtfy({
      title: 'Kanban sync STILL failing',
      message: `Still not reaching Command Centre:\n${failing.join('\n')}\nApproved designs are NOT on the board. Check GetFlowDesk, then use Resync.`,
      tags: 'rotating_light',
      priority: 5,
    })
  }

  return { checked: rows?.length ?? 0, recovered, failing }
}

// ── Retry queue plumbing ──────────────────────────────────────────────────

async function clearQueued(jobId: number): Promise<void> {
  const { error } = await supabaseAdmin.from('kanban_sync_queue').delete().eq('job_id', jobId)
  if (error) console.error('[kanban-retry] dequeue failed:', error)
}

/** Returns false when the row couldn't be written (e.g. table not created yet). */
async function enqueueForRetry(jobId: number, label: string, reason: string, detail: string): Promise<boolean> {
  const { data: existing, error: selErr } = await supabaseAdmin
    .from('kanban_sync_queue')
    .select('attempts')
    .eq('job_id', jobId)
    .maybeSingle()
  if (selErr) {
    console.error('[kanban-retry] queue lookup failed:', selErr)
    return false
  }

  const { error } = existing
    ? await supabaseAdmin
        .from('kanban_sync_queue')
        .update({ reason, last_error: detail, attempts: existing.attempts + 1, last_attempt_at: new Date().toISOString() })
        .eq('job_id', jobId)
    : await supabaseAdmin
        .from('kanban_sync_queue')
        .insert({ job_id: jobId, job_label: label, reason, last_error: detail })
  if (error) {
    console.error('[kanban-retry] enqueue failed:', error)
    return false
  }
  return true
}

// ── Single sync attempt (no retries, no notifications) ───────────────────

async function attemptSync(jobId: number): Promise<AttemptResult> {
  let label = `Job ${jobId}`
  try {
    const webhookUrl = process.env.COMMAND_CENTRE_KANBAN_WEBHOOK_URL
    const secret     = process.env.INTAKE_WEBHOOK_SECRET
    if (!webhookUrl || !secret) return { ok: false, reason: 'not_configured', label }

    const { data: job } = await supabaseAdmin
      .from('jobs')
      .select('reference_number, client_name, company_name, contact_email, event_name, date_required, notes, items')
      .eq('id', jobId)
      .single()
    if (!job) return { ok: false, reason: 'not_found', label }
    label = `${job.reference_number} (${job.client_name})`

    const items = (job.items ?? []) as JobItem[]
    // Resolve each approved item to a day (its own event date, or the job's due
    // date when undated) and the venue/occasion it belongs to.
    const approved = items
      .map((it, index) => ({ it, index }))
      .filter(({ it }) => it.approval_status === 'approved' && itemProofs(it).length > 0)
      .map(({ it, index }) => {
        const m = it.name.match(DATE_PREFIX)
        const dateLabel = m ? m[1] : ''
        const rest = m ? m[2] : it.name
        const day = (dateLabel ? resolveDate(dateLabel, job.date_required) : job.date_required) || 'no-date'
        const venueRaw = dateLabel ? rest.split(/\s[-–]\s/)[0].trim() : (job.company_name || '')
        return { it, index, dateLabel, rest, day, venueRaw }
      })
    if (approved.length === 0) return { ok: false, reason: 'none_approved', label }

    // One sticky per day, per client. Undated items land on the job's due date.
    const groups = new Map<string, typeof approved>()
    for (const p of approved) {
      ;(groups.get(p.day) ?? groups.set(p.day, []).get(p.day)!).push(p)
    }

    const tickets = await Promise.all([...groups.entries()].map(async ([day, members]) => {
      // When the whole day shares one venue/occasion, show it in the title and
      // strip it from each line; on mixed days omit it and keep each line's venue.
      const venues = [...new Set(members.map(m => m.venueRaw).filter(Boolean))]
      const dayVenue = venues.length === 1 ? venues[0] : ''
      const dateNice = day !== 'no-date' ? fmtDate(day) : ''
      const title = [[dateNice, cap(dayVenue, 40)].filter(Boolean).join(' · '), job.client_name]
        .filter(Boolean).join(' — ')

      const lines: string[] = []
      const itemNotes: string[] = []   // client's per-item brief — must reach the crew
      for (const { it, dateLabel, rest } of members) {
        let name = dateLabel ? rest : it.name
        if (dayVenue && name.toLowerCase().startsWith(dayVenue.toLowerCase())) {
          const stripped = name.slice(dayVenue.length).replace(/^\s*[-–]\s*/, '').trim()
          if (stripped) name = stripped
        }
        const qty = Number(it.quantity) || 1
        const specs = [it.size, it.material].filter(Boolean).join(' · ')
        lines.push(`${qty}× ${cap(name, 90)}${specs ? ` · ${specs}` : ''}`)
        const brief = (it.description ?? '').trim()
        if (brief) {
          const briefFlat = brief.split('\n').map(s => s.trim()).filter(Boolean).join(' · ')
          itemNotes.push(`• ${qty}× ${cap(name, 60)}: ${cap(briefFlat, 400)}`)
        }
      }

      // Every approved design for the day.
      const allPaths = members.flatMap(({ it }) => approvedProofs(it))
      const signed = await Promise.all(allPaths.map(async path => {
        const { data } = await supabaseAdmin.storage.from('job-files').createSignedUrl(path, PROOF_TTL_SECONDS)
        return data?.signedUrl
      }))

      const eventDate = day !== 'no-date' ? day : job.date_required
      // Client item notes go FIRST and under a clear heading — Command Centre
      // flags any ticket containing "Client notes:" so the crew can't miss them.
      const special = [
        itemNotes.length ? `📝 Client notes:\n${itemNotes.join('\n')}` : null,
        job.event_name ? `Event: ${job.event_name}` : null,
        job.notes      ? `Job notes: ${job.notes}`  : null,
      ].filter(Boolean).join('\n\n') || null

      return {
        ticket_ref:           `day-${day}`,
        title,
        description:          lines.join('\n'),
        special_instructions: special,
        image_urls:           signed.filter((u): u is string => Boolean(u)),
        event_date:           eventDate,
        // Admin marked every item for this event done in intake → tell CC to move
        // the card to Done. When false we send nothing that overrides the crew's
        // own board position (CC only forces 'done', never back to todo).
        done:                 members.every(m => Boolean(m.it.completed)),
      }
    }))

    const res = await fetch(webhookUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-intake-secret': secret },
      body: JSON.stringify({
        reference_number: job.reference_number,
        client_name:      job.client_name,
        company_name:     job.company_name,
        contact_email:    job.contact_email,
        event_name:       job.event_name,
        date_required:    job.date_required,
        notes:            job.notes,
        tickets,
      }),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.error('[kanban-sync] Command Centre rejected', res.status, body)
      return { ok: false, reason: 'webhook_failed', label, detail: `HTTP ${res.status} ${body.slice(0, 200)}` }
    }
    return { ok: true, tickets: tickets.length, label }
  } catch (err) {
    console.error('[kanban-sync] failed for job', jobId, err)
    return { ok: false, reason: 'error', label, detail: err instanceof Error ? err.message : String(err) }
  }
}
