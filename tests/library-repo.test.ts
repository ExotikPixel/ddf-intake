import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { hasDb, TEST_URL, applySchema, resetTables } from './helpers/db'

describe.skipIf(!hasDb)('library-repo', () => {
  let lib: typeof import('@/lib/library-repo')
  let tenantId: string
  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_URL
    applySchema()
    lib = await import('@/lib/library-repo')
    tenantId = await (await import('@/lib/tenant')).getDefaultTenantId()
  })
  beforeEach(async () => { await resetTables() })

  it('inserts, lists newest-first, and deletes only within the tenant', async () => {
    const a = await lib.insertLibraryEntry(tenantId, 'White stage', 'uploads/a.png')
    const b = await lib.insertLibraryEntry(tenantId, 'Backdrop', 'uploads/b.png')
    expect(a.data).toMatchObject({ id: 1000000, name: 'White stage', path: 'uploads/a.png' })
    expect((await lib.listLibrary(tenantId)).data!.map(r => r.name)).toEqual(['Backdrop', 'White stage'])
    expect((await lib.deleteLibraryEntry(b.data!.id, '00000000-0000-0000-0000-000000000000')).data).toBe(0)
    expect((await lib.deleteLibraryEntry(b.data!.id, tenantId)).data).toBe(1)
    expect((await lib.listLibrary(tenantId)).data).toHaveLength(1)
  })
})
