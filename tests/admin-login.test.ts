import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { hasDb, TEST_URL, applySchema, resetTables } from './helpers/db'

describe.skipIf(!hasDb)('POST /api/admin/login', () => {
  let POST: typeof import('@/app/api/admin/login/route').POST
  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_URL
    process.env.AUTH_SECRET = 'c'.repeat(64)
    applySchema()
    POST = (await import('@/app/api/admin/login/route')).POST
  })
  beforeEach(async () => {
    await resetTables()
    await (await import('@/lib/admin-users')).upsertAdmin('tony@ddfpixel.com', 'a very long password')
  })

  const login = (email: string, password: string) =>
    POST(new NextRequest('http://localhost/api/admin/login', {
      method: 'POST', body: JSON.stringify({ email, password }), headers: { 'content-type': 'application/json' },
    }))

  it('sets an httpOnly ddf_admin cookie on success (email is case-insensitive)', async () => {
    const res = await login('Tony@DDFpixel.com', 'a very long password')
    expect(res.status).toBe(200)
    const cookie = res.headers.get('set-cookie') ?? ''
    expect(cookie).toMatch(/^ddf_admin=/)
    expect(cookie.toLowerCase()).toContain('httponly')
  })

  it('401 with one generic message for a wrong password or unknown email', async () => {
    const a = await login('tony@ddfpixel.com', 'nope')
    const b = await login('ghost@ddfpixel.com', 'nope')
    expect(a.status).toBe(401)
    expect(b.status).toBe(401)
    expect(await a.json()).toEqual(await b.json())
  })

  it('400 when fields are missing', async () => {
    expect((await login('', '')).status).toBe(400)
  })

  it('415 unless Content-Type is application/json', async () => {
    const res = await POST(new NextRequest('http://localhost/api/admin/login', {
      method: 'POST', body: 'email=a&password=b', headers: { 'content-type': 'text/plain' },
    }))
    expect(res.status).toBe(415)
  })

  it('rejects over-long passwords with the generic 401 (before bcrypt)', async () => {
    const res = await login('tony@ddfpixel.com', 'x'.repeat(1025))
    expect(res.status).toBe(401)
  })
})
