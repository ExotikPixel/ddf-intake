import { describe, it, expect } from 'vitest'
import { daysUntil, countdownLabel, prettyDate } from '@/lib/countdown'

describe('countdown', () => {
  const now = new Date(2026, 10, 15, 21, 30) // Nov 15, 9:30 pm local
  it('counts whole calendar days', () => {
    expect(daysUntil('2026-12-12', now)).toBe(27)
    expect(daysUntil('2026-11-16', now)).toBe(1)
    expect(daysUntil('2026-11-15', now)).toBe(0)
    expect(daysUntil('2026-11-10', now)).toBe(-5)
  })
  it('labels', () => {
    expect(countdownLabel(0)).toBe('Today')
    expect(countdownLabel(1)).toBe('Tomorrow')
    expect(countdownLabel(27)).toBe('27 days')
    expect(countdownLabel(-5)).toBe('5 days ago')
  })
  it('pretty dates', () => {
    expect(prettyDate('2026-12-12')).toBe('Sat, Dec 12')
  })
})
