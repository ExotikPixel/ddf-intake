import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { hasDb, TEST_URL, applySchema, resetTables } from './helpers/db'

let cookieValue: string | undefined
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (n: string) => (n === 'ddf_admin' && cookieValue ? { name: n, value: cookieValue } : undefined) }),
}))

describe.skipIf(!hasDb)('admin session revocation', () => {
  let POST: typeof import('@/app/api/admin/login/route').POST
  let au: typeof import('@/lib/admin-users')
  let requireAdmin: typeof import('@/lib/admin-auth').requireAdmin
  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_URL
    process.env.AUTH_SECRET = 'd'.repeat(64)
    applySchema()
    POST = (await import('@/app/api/admin/login/route')).POST
    au = await import('@/lib/admin-users')
    requireAdmin = (await import('@/lib/admin-auth')).requireAdmin
  })
  beforeEach(async () => { await resetTables(); cookieValue = undefined })

  async function loginCookie(email: string, password: string): Promise<string> {
    const res = await POST(new NextRequest('http://localhost/api/admin/login', {
      method: 'POST', body: JSON.stringify({ email, password }), headers: { 'content-type': 'application/json' },
    }))
    return /^ddf_admin=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')![1]
  }

  it('a cookie is accepted, then rejected after a password reset; a new login works', async () => {
    await au.upsertAdmin('a@b.co', 'first password!!')
    cookieValue = await loginCookie('a@b.co', 'first password!!')
    expect('user' in (await requireAdmin())).toBe(true)
    await au.upsertAdmin('a@b.co', 'second password!!')
    expect('unauthorized' in (await requireAdmin())).toBe(true)
    cookieValue = await loginCookie('a@b.co', 'second password!!')
    expect('user' in (await requireAdmin())).toBe(true)
  })

  it('removing the admin revokes the cookie', async () => {
    await au.upsertAdmin('a@b.co', 'first password!!')
    cookieValue = await loginCookie('a@b.co', 'first password!!')
    await (await import('./helpers/db')).rawSql()`delete from admin_users where email = 'a@b.co'`
    expect('unauthorized' in (await requireAdmin())).toBe(true)
  })
})
