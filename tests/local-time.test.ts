import { describe, it, expect } from 'vitest'
import { torontoDate, torontoHour, addDays, daysBetween } from '@/lib/local-time'

describe('local-time', () => {
  it('uses Toronto wall-clock time (EST, UTC-5 in November)', () => {
    const d = new Date('2026-11-16T03:30:00.000Z') // 22:30 on Nov 15 in Toronto
    expect(torontoDate(d)).toBe('2026-11-15')
    expect(torontoHour(d)).toBe(22)
  })
  it('handles EDT (UTC-4) in summer', () => {
    expect(torontoHour(new Date('2026-07-01T13:00:00.000Z'))).toBe(9)
  })
  it('adds days and counts whole days between ISO dates', () => {
    expect(addDays('2026-11-28', 3)).toBe('2026-12-01')
    expect(daysBetween('2026-11-15', '2026-12-12')).toBe(27)
    expect(daysBetween('2026-11-15', '2026-11-14')).toBe(-1)
  })
})
