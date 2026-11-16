// Client-side date helpers for countdowns ("27 days") in the browser's local time.
const localDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function daysUntil(isoDate: string, now: Date = new Date()): number {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((localDate(isoDate).getTime() - today.getTime()) / 86_400_000)
}

export function countdownLabel(days: number): string {
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days < 0) return `${-days} day${days === -1 ? '' : 's'} ago`
  return `${days} days`
}

/** "Sat, Dec 12" */
export function prettyDate(isoDate: string): string {
  return localDate(isoDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}
