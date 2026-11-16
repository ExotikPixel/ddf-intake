import { describe, it, expect } from 'vitest'
import { pgTimestampToIso } from '@/lib/pg-time'

describe('pgTimestampToIso', () => {
  it.each([
    ['2026-06-22 14:03:11.123456+00', '2026-06-22T14:03:11.123+00:00'],
    ['2026-06-22 14:03:11+00',        '2026-06-22T14:03:11.000+00:00'],
    ['2026-06-22 09:03:11.5-05',      '2026-06-22T09:03:11.500-05:00'],
    ['2026-06-22 14:03:11.1+05:30',   '2026-06-22T14:03:11.100+05:30'],
  ])('%s → %s', (input, expected) => {
    expect(pgTimestampToIso(input)).toBe(expected)
  })

  it('produces the same instant JS Date would expect', () => {
    expect(new Date(pgTimestampToIso('2026-06-22 09:03:11.5-05')).toISOString()).toBe('2026-06-22T14:03:11.500Z')
  })

  it('passes unknown formats through unchanged', () => {
    expect(pgTimestampToIso('infinity')).toBe('infinity')
  })
})
