import { supabaseAdmin } from '@/lib/supabase-server'
import { approvedProofs, itemProofs } from '@/lib/job-types'
import type { JobItem } from '@/lib/job-types'

// Push approved items into Command Centre's Kanban as job tickets. Fired
// automatically whenever an item is approved (admin, portal, or review link).
//
// Design notes:
//   • One CC project per intake job; one CC task per approved item.
//   • Idempotent — CC upserts on a stable per-item key, so re-approving a
//     revised proof updates the same ticket instead of duplicating it.
//   • Never throws. Approval must succeed even if Command Centre is down.

// Tickets can sit in the queue for weeks, so sign proofs with a long TTL.
const PROOF_TTL_SECONDS = 60 * 60 * 24 * 90 // 90 days

function slug(s: string): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
}

// Item names are usually "June 15 - Welcome Sign": the part before " - " is the
// item's own event date. Resolve it to YYYY-MM-DD, falling back to the job's
// overall date_required when the name carries no date.
const MONTHS = 'jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec'
// Only treat a label as a date when it actually looks like one ("June 15",
// "15 June", "2026-06-15", "6/15"). Node's parser is lenient enough that
// "Welcome Sign 2026" yields Jan 1 and "June 15" yields year 2001, so we guard
// the shape first, then inject the job's year for year-less labels.
const DATE_LIKE = new RegExp(
  `(${MONTHS})[a-z]*\\s+\\d{1,2}|\\d{1,2}\\s+(${MONTHS})|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}/\\d{1,2}`, 'i'
)

function eventDateFor(name: string, fallback: string | null): string | null {
  const i = name.indexOf(' - ')
  const label = i > 0 ? name.slice(0, i).trim() : ''
  if (label && DATE_LIKE.test(label)) {
    const year = fallback ? new Date(`${fallback}T00:00:00`).getFullYear() : new Date().getFullYear()
    const hasYear = /\b\d{4}\b/.test(label)
    const t = new Date(hasYear ? label : `${label} ${year}`).getTime()
    if (!isNaN(t)) return new Date(t).toISOString().slice(0, 10)
  }
  return fallback || null
}

export async function syncApprovedItemsToKanban(jobId: number): Promise<void> {
  try {
    const webhookUrl = process.env.COMMAND_CENTRE_KANBAN_WEBHOOK_URL
    const secret     = process.env.INTAKE_WEBHOOK_SECRET
    if (!webhookUrl || !secret) return // integration not configured — no-op

    const { data: job } = await supabaseAdmin
      .from('jobs')
      .select('reference_number, client_name, contact_email, event_name, date_required, notes, items')
      .eq('id', jobId)
      .single()
    if (!job) return

    const items = (job.items ?? []) as JobItem[]
    const approved = items
      .map((it, index) => ({ it, index }))
      .filter(({ it }) => it.approval_status === 'approved' && itemProofs(it).length > 0)
    if (approved.length === 0) return

    const ticketItems = await Promise.all(approved.map(async ({ it, index }) => {
      const signed = await Promise.all(
        approvedProofs(it).map(async path => {
          const { data } = await supabaseAdmin.storage.from('job-files').createSignedUrl(path, PROOF_TTL_SECONDS)
          return data?.signedUrl
        })
      )
      return {
        item_ref:    `${index}::${slug(it.name)}`,
        name:        it.name,
        size:        it.size,
        material:    it.material,
        quantity:    Number(it.quantity) || 1,
        event_date:  eventDateFor(it.name, job.date_required),
        proof_urls:  signed.filter((u): u is string => Boolean(u)),
        client_note: it.client_note || null,
      }
    }))

    const res = await fetch(webhookUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-intake-secret': secret },
      body: JSON.stringify({
        reference_number: job.reference_number,
        client_name:      job.client_name,
        contact_email:    job.contact_email,
        event_name:       job.event_name,
        date_required:    job.date_required,
        notes:            job.notes,
        items:            ticketItems,
      }),
    })

    if (!res.ok) {
      console.error('[kanban-sync] Command Centre rejected', res.status, await res.text().catch(() => ''))
    }
  } catch (err) {
    console.error('[kanban-sync] failed for job', jobId, err)
  }
}
