import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { hasDb, TEST_URL, applySchema, resetTables } from './helpers/db'

process.env.FILES_DIR = mkdtempSync(path.join(tmpdir(), 'ddf-jobfiles-'))

let tenantId = ''
let tokenJob: number | null = null
vi.mock('@/lib/portal-auth', () => ({
  portalCanAccess: async (jobId: number) => tokenJob === jobId,
}))
vi.mock('@/lib/admin-auth', () => ({
  requireAdmin: async () => ({ tenantId }),
}))
vi.mock('@/lib/kanban-sync', () => ({ syncApprovedItemsToKanban: async () => ({}) }))

const put = (key: string) => {
  const full = path.join(process.env.FILES_DIR!, key)
  mkdirSync(path.dirname(full), { recursive: true })
  writeFileSync(full, 'x')
}
const on = (key: string) => existsSync(path.join(process.env.FILES_DIR!, key))
const ctx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) })
const patch = (id: number, body: unknown) =>
  new NextRequest(`http://localhost/api/x/${id}`, { method: 'PATCH', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })

describe.skipIf(!hasDb)('job file_paths routes', () => {
  let portal: typeof import('@/app/api/portal/jobs/[id]/route')
  let admin: typeof import('@/app/api/admin/jobs/[id]/route')
  let repo: typeof import('@/lib/jobs-repo')
  let jobId: number

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_URL
    applySchema()
    portal = await import('@/app/api/portal/jobs/[id]/route')
    admin = await import('@/app/api/admin/jobs/[id]/route')
    repo = await import('@/lib/jobs-repo')
    tenantId = await (await import('@/lib/tenant')).getDefaultTenantId()
  })
  beforeEach(async () => {
    await resetTables()
    put('uploads/mine.pdf'); put('private/other-client.pdf'); put('uploads/fresh.pdf')
    const ins = await repo.insertJob({
      tenant_id: tenantId, reference_number: 'DDF-T-1', client_name: 'A', company_name: 'B', contact_email: 'a@b.co',
      event_name: null, date_required: '2030-01-01', notes: null, setup_location: null, setup_time: null,
      removal_location: null, removal_time: null, items: [], file_paths: ['uploads/mine.pdf'],
      submission_id: crypto.randomUUID(), submitted_at: new Date().toISOString(), status: 'pending',
    })
    jobId = ins.data!.id
    tokenJob = jobId
  })
  const paths = async () => (await repo.getJob(jobId, ['file_paths'])).data!.file_paths

  for (const [name, call] of [
    ['portal', (b: unknown) => portal.PATCH(patch(jobId, b), ctx(jobId))],
    ['admin', (b: unknown) => admin.PATCH(patch(jobId, b), ctx(jobId))],
  ] as const) {
    describe(name, () => {
      it('rejects a foreign (exists on disk but outside uploads/ and not on this job) key', async () => {
        const res = await call({ file_paths: ['uploads/mine.pdf', 'private/other-client.pdf'] })
        expect(res.status).toBe(400)
        expect(await paths()).toEqual(['uploads/mine.pdf'])
        expect(on('uploads/mine.pdf')).toBe(true)
      })
      it('rejects a nonexistent or non-uploads key', async () => {
        expect((await call({ file_paths: ['uploads/ghost.pdf'] })).status).toBe(400)
        expect((await call({ file_paths: ['../etc/passwd'] })).status).toBe(400)
      })
      it('non-array / non-string entries → 400 and nothing deleted', async () => {
        expect((await call({ file_paths: 'uploads/mine.pdf' })).status).toBe(400)
        expect((await call({ file_paths: [5] })).status).toBe(400)
        expect(on('uploads/mine.pdf')).toBe(true)
        expect(await paths()).toEqual(['uploads/mine.pdf'])
      })
      it('deletes a removed own file only after the update succeeds', async () => {
        const res = await call({ file_paths: ['uploads/fresh.pdf'] })
        expect(res.status).toBe(200)
        expect(await paths()).toEqual(['uploads/fresh.pdf'])
        expect(on('uploads/mine.pdf')).toBe(false)
        expect(on('private/other-client.pdf')).toBe(true)
      })
    })
  }

  for (const [name, call] of [
    ['portal', (b: unknown) => portal.PATCH(patch(jobId, b), ctx(jobId))],
    ['admin', (b: unknown) => admin.PATCH(patch(jobId, b), ctx(jobId))],
  ] as const) {
    it(`${name}: a removed file still on another job is NOT deleted`, async () => {
      await repo.insertJob({
        tenant_id: tenantId, reference_number: 'DDF-T-2', client_name: 'C', company_name: 'D', contact_email: 'c@d.co',
        event_name: null, date_required: '2030-01-01', notes: null, setup_location: null, setup_time: null,
        removal_location: null, removal_time: null, items: [], file_paths: ['uploads/mine.pdf'],
        submission_id: crypto.randomUUID(), submitted_at: new Date().toISOString(), status: 'pending',
      })
      const res = await call({ file_paths: ['uploads/fresh.pdf'] })
      expect(res.status).toBe(200)
      expect(await paths()).toEqual(['uploads/fresh.pdf'])
      expect(on('uploads/mine.pdf')).toBe(true)
    })
  }

  it('portal: no token → 403 before any lookup', async () => {
    tokenJob = null
    expect((await portal.PATCH(patch(jobId, { notes: 'x' }), ctx(jobId))).status).toBe(403)
    expect((await portal.PATCH(patch(999, { notes: 'x' }), ctx(999))).status).toBe(403)
  })
})
