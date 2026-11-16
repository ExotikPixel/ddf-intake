import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { hasDb, TEST_URL, applySchema, resetTables } from './helpers/db'

describe.skipIf(!hasDb)('admin-users', () => {
  let au: typeof import('@/lib/admin-users')
  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_URL
    applySchema()
    au = await import('@/lib/admin-users')
  })
  beforeEach(async () => { await resetTables() })

  it('upserts, finds case-insensitively, verifies the password', async () => {
    const id = await au.upsertAdmin('Tony@DDFpixel.com ', 'correct horse battery')
    const found = await au.findAdminByEmail('tony@ddfpixel.com')
    expect(found?.id).toBe(id)
    expect(await au.checkPassword('correct horse battery', found!.password_hash)).toBe(true)
    expect(await au.checkPassword('wrong', found!.password_hash)).toBe(false)
  })

  it('upsert replaces the password; adminExists/touch work', async () => {
    const id = await au.upsertAdmin('a@b.co', 'first password!!')
    await au.upsertAdmin('a@b.co', 'second password!!')
    const found = await au.findAdminByEmail('a@b.co')
    expect(await au.checkPassword('second password!!', found!.password_hash)).toBe(true)
    expect(await au.adminExists(id)).toBe(true)
    expect(await au.adminExists(999)).toBe(false)
    await au.touchAdminLogin(id)
  })

  it('dummyHash makes unknown-user checks cost the same and fail', async () => {
    expect(await au.checkPassword('anything', await au.dummyHash())).toBe(false)
  })
})
