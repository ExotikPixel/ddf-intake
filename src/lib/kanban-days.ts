import { itemProofs } from '@/lib/job-types'
import type { JobItem } from '@/lib/job-types'

// Shared day-grouping primitives for the Command Centre Kanban integration.
// Both the outbound sync (kanban-sync) and the inbound status callback
// (api/cc/status-callback) must compute the SAME day keys, so they live here.

const MONTHS = 'jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec'
// "June 22 - rest", "Jun. 3 - rest", etc. Captures the date label and the remainder.
export const DATE_PREFIX = new RegExp(`^((?:${MONTHS})[a-z]*\\.?\\s+\\d{1,2})\\s*[-–]\\s*(.*)$`, 'i')

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']

export function fmtDate(iso: string): string {
  const [, m, d] = iso.split('-').map(Number)
  return (m && d) ? `${MONTH_NAMES[m - 1]} ${d}` : iso
}

export function cap(s: string, n = 60): string {
  s = (s || '').trim().replace(/[.,;:\s]+$/, '')
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s
}

// Resolve a date label like "June 22" to YYYY-MM-DD using the job's year.
export function resolveDate(dateLabel: string, fallback: string | null): string | null {
  if (dateLabel) {
    const year = fallback ? new Date(`${fallback}T00:00:00`).getFullYear() : new Date().getFullYear()
    const t = new Date(`${dateLabel} ${year}`).getTime()
    if (!isNaN(t)) return new Date(t).toISOString().slice(0, 10)
  }
  return fallback || null
}

/** The day key (ISO date, matching a sticky's `day-<key>` ticket_ref) for one item. */
export function dayKeyForItem(item: JobItem, dateRequired: string | null): string {
  const m = item.name.match(DATE_PREFIX)
  return (m ? resolveDate(m[1], dateRequired) : dateRequired) || 'no-date'
}

/** Distinct day keys for a job's approved, proofed items — the set of stickies it has. */
export function approvedDayKeys(items: JobItem[], dateRequired: string | null): string[] {
  const days = new Set<string>()
  for (const it of items) {
    if (it.approval_status === 'approved' && itemProofs(it).length > 0) {
      days.add(dayKeyForItem(it, dateRequired))
    }
  }
  return [...days]
}
