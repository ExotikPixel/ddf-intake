import { describe, it, expect, beforeAll } from 'vitest'
import { signSession, verifySession } from '@/lib/session'

describe('admin session JWT', () => {
  beforeAll(() => { process.env.AUTH_SECRET = 'a'.repeat(64) })

  it('round-trips', async () => {
    const t = await signSession({ id: 7, email: 'tony@ddfpixel.com' })
    expect(await verifySession(t)).toEqual({ id: 7, email: 'tony@ddfpixel.com' })
  })

  it('rejects expired, tampered, wrong-secret, and missing tokens', async () => {
    expect(await verifySession(await signSession({ id: 7, email: 'x@y.z' }, -10))).toBeNull()
    const t = await signSession({ id: 7, email: 'x@y.z' })
    expect(await verifySession(t.slice(0, -2) + 'xx')).toBeNull()
    process.env.AUTH_SECRET = 'b'.repeat(64)
    expect(await verifySession(t)).toBeNull()
    expect(await verifySession(undefined)).toBeNull()
  })
})
