import { describe, it, expect, beforeAll } from 'vitest'
import { hasDb, TEST_URL } from './helpers/db'

describe.skipIf(!hasDb)('db() type parsers', () => {
  let db: typeof import('@/lib/db').db
  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_URL
    db = (await import('@/lib/db')).db
  })

  it('returns date as YYYY-MM-DD, timestamptz as ISO string, int8 as number', async () => {
    const [row] = await db()`select '2026-06-22'::date as d, '2026-06-22 14:03:11.5+00'::timestamptz as t, 1000001::bigint as b`
    expect(row.d).toBe('2026-06-22')
    expect(row.t).toBe('2026-06-22T14:03:11.500+00:00')
    expect(row.b).toBe(1000001)
  })

  it('parses jsonb and text[]', async () => {
    const [row] = await db()`select '{"a":[1,2]}'::jsonb as j, array['x','y']::text[] as arr, '{}'::text[] as empty`
    expect(row.j).toEqual({ a: [1, 2] })
    expect(row.arr).toEqual(['x', 'y'])
    expect(row.empty).toEqual([])
  })

})
