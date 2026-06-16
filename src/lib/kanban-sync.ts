import { supabaseAdmin } from '@/lib/supabase-server'
import { approvedProofs, itemProofs } from '@/lib/job-types'
import type { JobItem } from '@/lib/job-types'

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

const PROOF_TTL_SECONDS = 60 * 60 * 24 * 90 // 90 days — tickets can sit for weeks
const MONTHS = 'jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec'
// "June 22 - rest", "Jun. 3 - rest", etc. Captures the date label and the remainder.
const DATE_PREFIX = new RegExp(`^((?:${MONTHS})[a-z]*\\.?\\s+\\d{1,2})\\s*[-–]\\s*(.*)$`, 'i')

function slug(s: string): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
}

function cap(s: string, n = 60): string {
  s = s.trim().replace(/[.,;:\s]+$/, '')
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s
}

// Resolve a date label like "June 22" to YYYY-MM-DD using the job's year.
function resolveDate(dateLabel: string, fallback: string | null): string | null {
  if (dateLabel) {
    const year = fallback ? new Date(`${fallback}T00:00:00`).getFullYear() : new Date().getFullYear()
    const t = new Date(`${dateLabel} ${year}`).getTime()
    if (!isNaN(t)) return new Date(t).toISOString().slice(0, 10)
  }
  return fallback || null
}

interface ParsedItem { it: JobItem; index: number; dateLabel: string; rest: string }

export async function syncApprovedItemsToKanban(jobId: number): Promise<void> {
  try {
    const webhookUrl = process.env.COMMAND_CENTRE_KANBAN_WEBHOOK_URL
    const secret     = process.env.INTAKE_WEBHOOK_SECRET
    if (!webhookUrl || !secret) return

    const { data: job } = await supabaseAdmin
      .from('jobs')
      .select('reference_number, client_name, company_name, contact_email, event_name, date_required, notes, items')
      .eq('id', jobId)
      .single()
    if (!job) return

    const items = (job.items ?? []) as JobItem[]
    const approved: ParsedItem[] = items
      .map((it, index) => ({ it, index }))
      .filter(({ it }) => it.approval_status === 'approved' && itemProofs(it).length > 0)
      .map(({ it, index }) => {
        const m = it.name.match(DATE_PREFIX)
        return { it, index, dateLabel: m ? m[1] : '', rest: m ? m[2] : it.name }
      })
    if (approved.length === 0) return

    // Group by event: the date label, or "__main__" for undated items.
    const groups = new Map<string, ParsedItem[]>()
    for (const p of approved) {
      const key = p.dateLabel ? p.dateLabel.toLowerCase() : '__main__'
      ;(groups.get(key) ?? groups.set(key, []).get(key)!).push(p)
    }

    const tickets = await Promise.all([...groups.entries()].map(async ([key, members]) => {
      const isMain = key === '__main__'
      // Title venue/occasion: company_name for the main tile; the segment after
      // the date (first " - " chunk) for a dated event.
      const firstRest = members[0].rest
      const titleVenue = isMain
        ? (job.company_name || job.event_name || job.client_name || 'Main Event')
        : cap(firstRest.split(/\s[-–]\s/)[0])
      const title = `${cap(titleVenue, 70)} — ${job.client_name}`

      // Clean each item line: drop the date prefix, and the venue segment when present.
      const lines = members.map(({ it, rest }) => {
        let name = isMain ? it.name : rest
        if (!isMain && titleVenue && name.toLowerCase().startsWith(titleVenue.toLowerCase())) {
          name = name.slice(titleVenue.length).replace(/^\s*[-–]\s*/, '')
        }
        const specs = [it.size, it.material].filter(Boolean).join(' · ')
        return `${Number(it.quantity) || 1}× ${cap(name, 90)}${specs ? ` · ${specs}` : ''}`
      })

      // All approved proofs for every item in this event.
      const allPaths = members.flatMap(({ it }) => approvedProofs(it))
      const signed = await Promise.all(allPaths.map(async path => {
        const { data } = await supabaseAdmin.storage.from('job-files').createSignedUrl(path, PROOF_TTL_SECONDS)
        return data?.signedUrl
      }))

      const eventDate = isMain ? job.date_required : resolveDate(members[0].dateLabel, job.date_required)
      const special = [
        job.event_name ? `Event: ${job.event_name}` : null,
        job.notes      ? `Job notes: ${job.notes}`  : null,
      ].filter(Boolean).join('\n') || null

      return {
        ticket_ref:           `evt-${slug(key)}`,
        title,
        description:          lines.join('\n'),
        special_instructions: special,
        image_urls:           signed.filter((u): u is string => Boolean(u)),
        event_date:           eventDate,
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
      console.error('[kanban-sync] Command Centre rejected', res.status, await res.text().catch(() => ''))
    }
  } catch (err) {
    console.error('[kanban-sync] failed for job', jobId, err)
  }
}
