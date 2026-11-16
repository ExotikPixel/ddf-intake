import { describe, it, expect, beforeAll } from 'vitest'
import { signSession, verifySession } from '@/lib/session'

describe('admin session JWT', () => {
  beforeAll(() => { process.env.AUTH_SECRET = 'a'.repeat(64) })

  it('round-trips', async () => {
    const t = await signSession({ id: 7, email: 'tony@ddfpixel.com', v: 3 })
    expect(await verifySession(t)).toEqual({ id: 7, email: 'tony@ddfpixel.com', v: 3 })
  })

  it('rejects tokens without a session version', async () => {
    const { SignJWT } = await import('jose')
    const t = await new SignJWT({ email: 'x@y.z' }).setProtectedHeader({ alg: 'HS256' }).setSubject('7')
      .setExpirationTime('1h').sign(new TextEncoder().encode(process.env.AUTH_SECRET!))
    expect(await verifySession(t)).toBeNull()
  })

  it('rejects expired, tampered, wrong-secret, and missing tokens', async () => {
    expect(await verifySession(await signSession({ id: 7, email: 'x@y.z', v: 0 }, -10))).toBeNull()
    const t = await signSession({ id: 7, email: 'x@y.z', v: 0 })
    expect(await verifySession(t.slice(0, -2) + 'xx')).toBeNull()
    process.env.AUTH_SECRET = 'b'.repeat(64)
    expect(await verifySession(t)).toBeNull()
    expect(await verifySession(undefined)).toBeNull()
  })
})
