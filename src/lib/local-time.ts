// The shop runs on Toronto time. Server clocks (Docker) are UTC, so every
// "today", "this morning" and quiet-hours check goes through these helpers.
const TZ = 'America/Toronto'

/** YYYY-MM-DD for the given instant in Toronto. */
export function torontoDate(now: Date = new Date()): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(now).map(x => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}`
}

/** 0–23 hour for the given instant in Toronto. */
export function torontoHour(now: Date = new Date()): number {
  const h = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' })
    .formatToParts(now).find(x => x.type === 'hour')!.value
  return Number(h) % 24
}

/** Add whole days to an ISO date (calendar math, no time zones involved). */
export function addDays(isoDate: string, n: number): string {
  const d = new Date(`${isoDate}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Whole days from `a` to `b` (both YYYY-MM-DD). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00.000Z`) - Date.parse(`${a}T00:00:00.000Z`)) / 86_400_000)
}

/** "Tue Nov 17" for an ISO date. */
export function shortDay(isoDate: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' })
    .format(new Date(`${isoDate}T00:00:00.000Z`)).replace(/,/g, '')
}
