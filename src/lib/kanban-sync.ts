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

const PROOF_TTL_SECONDS = 60 * 60 * 24 * 90 // 90 days — tickets can sit for weeks

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
    if (approved.length === 0) return

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

      const lines = members.map(({ it, dateLabel, rest }) => {
        let name = dateLabel ? rest : it.name
        if (dayVenue && name.toLowerCase().startsWith(dayVenue.toLowerCase())) {
          const stripped = name.slice(dayVenue.length).replace(/^\s*[-–]\s*/, '').trim()
          if (stripped) name = stripped
        }
        const specs = [it.size, it.material].filter(Boolean).join(' · ')
        return `${Number(it.quantity) || 1}× ${cap(name, 90)}${specs ? ` · ${specs}` : ''}`
      })

      // Every approved design for the day.
      const allPaths = members.flatMap(({ it }) => approvedProofs(it))
      const signed = await Promise.all(allPaths.map(async path => {
        const { data } = await supabaseAdmin.storage.from('job-files').createSignedUrl(path, PROOF_TTL_SECONDS)
        return data?.signedUrl
      }))

      const eventDate = day !== 'no-date' ? day : job.date_required
      const special = [
        job.event_name ? `Event: ${job.event_name}` : null,
        job.notes      ? `Job notes: ${job.notes}`  : null,
      ].filter(Boolean).join('\n') || null

      return {
        ticket_ref:           `day-${day}`,
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
      const body = await res.text().catch(() => '')
      console.error('[kanban-sync] Command Centre rejected', res.status, body)
      await sendNtfy({
        title: 'Kanban sync FAILED',
        message: `${job.reference_number} (${job.client_name}) didn't reach Command Centre — HTTP ${res.status}. Approved designs are NOT on the board.\n${body.slice(0, 200)}`,
        tags: 'rotating_light',
        priority: 5,
      })
    }
  } catch (err) {
    console.error('[kanban-sync] failed for job', jobId, err)
    await sendNtfy({
      title: 'Kanban sync FAILED',
      message: `Job ${jobId} could not be pushed to Command Centre (network/error). Approved designs are NOT on the board.\n${err instanceof Error ? err.message : String(err)}`,
      tags: 'rotating_light',
      priority: 5,
    })
  }
}
