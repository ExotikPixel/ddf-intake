// Postgres sends timestamptz as text like "2026-06-22 14:03:11.123456+00".
// Supabase/PostgREST returned ISO strings, and app code expects strings, so
// convert to "2026-06-22T14:03:11.123+00:00" (millisecond precision).
const TS = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d+)?([+-]\d{2})(?::?(\d{2}))?$/

export function pgTimestampToIso(value: string): string {
  const m = TS.exec(value)
  if (!m) return value
  const [, date, time, frac, offH, offM = '00'] = m
  const ms = frac ? frac.slice(0, 4).padEnd(4, '0') : '.000'
  return `${date}T${time}${ms}${offH}:${offM}`
}
