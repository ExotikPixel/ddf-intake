import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { hasDb, TEST_URL, applySchema, resetTables } from './helpers/db'

process.env.FILES_DIR = mkdtempSync(path.join(tmpdir(), 'ddf-submit-'))
process.env.INTAKE_WEBHOOK_SECRET = 'cc-secret-value'

vi.mock('@/lib/email', () => ({
  sendNotificationEmail: async () => {}, sendConfirmationEmail: async () => {},
  sendStatusNotification: async () => {}, sendChangeRequestNotification: async () => {},
  sendAddedToJobNotification: async () => {},
}))
vi.mock('@/lib/ntfy', () => ({ sendNtfy: async () => {} }))
vi.mock('@/lib/kanban-sync', () => ({ syncApprovedItemsToKanban: async () => ({}) }))
let tokenJob: number | null = null
vi.mock('@/lib/portal-auth', () => ({ portalCanAccess: async (id: number) => tokenJob === id }))

const json = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(url, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } })

const base = () => ({
  clientName: 'A', companyName: 'B', contactEmail: 'a@b.co', dateRequired: '2030-01-01',
  items: [{ name: 'Banner', quantity: 1, size: '1x1', material: 'vinyl' }],
  filePaths: [] as string[], submissionId: crypto.randomUUID(),
})

describe.skipIf(!hasDb)('submit, add and CC callback hardening', () => {
  let submit: typeof import('@/app/api/submit/route')
  let add: typeof import('@/app/api/portal/jobs/[id]/add/route')
  let cc: typeof import('@/app/api/cc/status-callback/route')
  let repo: typeof import('@/lib/jobs-repo')

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_URL
    applySchema()
    submit = await import('@/app/api/submit/route')
    add = await import('@/app/api/portal/jobs/[id]/add/route')
    cc = await import('@/app/api/cc/status-callback/route')
    repo = await import('@/lib/jobs-repo')
  })
  beforeEach(async () => { await resetTables() })

  it('submit rejects non-uploads file keys', async () => {
    for (const bad of ['private/x.pdf', 'uploads/../x', 'uploads/a/b.pdf']) {
      const res = await submit.POST(json('http://l/api/submit', { ...base(), filePaths: [bad] }))
      expect(res.status).toBe(400)
    }
    const res = await submit.POST(json('http://l/api/submit', {
      ...base(), items: [{ ...base().items[0], ref_photos: ['secret/x.png'] }],
    }))
    expect(res.status).toBe(400)
  })

  it('submit strips shop-only item fields', async () => {
    const b = base()
    const res = await submit.POST(json('http://l/api/submit', {
      ...b, items: [{ ...b.items[0], admin_note: 'x', example_photos: ['uploads/e.png'], approval_status: 'approved' }],
    }))
    expect(res.status).toBe(200)
    const { data } = await repo.getJobByReference((await res.json()).referenceNumber, ['items'])
    expect(data!.items[0]).not.toHaveProperty('admin_note')
    expect(data!.items[0]).not.toHaveProperty('example_photos')
    expect(data!.items[0]).not.toHaveProperty('approval_status')
  })

  it('portal add strips shop and approval fields', async () => {
    const res0 = await submit.POST(json('http://l/api/submit', base()))
    const { data: job } = await repo.getJobByReference((await res0.json()).referenceNumber, ['id'])
    tokenJob = job!.id
    const res = await add.POST(json('http://l/x', {
      newItems: [{ ...base().items[0], admin_note: 'x', proof_urls: ['uploads/p.png'], approval_status: 'approved', completed: true }],
    }), { params: Promise.resolve({ id: String(job!.id) }) })
    expect(res.status).toBe(200)
    const { data } = await repo.getJob(job!.id, ['items'])
    const added = data!.items[1]
    expect(added.admin_note).toBeUndefined()
    expect(added.proof_urls).toBeUndefined()
    expect(added.completed).toBeUndefined()
    expect(added.approval_status).toBe('pending')
  })

  it('CC callback rejects wrong, missing and unset secrets', async () => {
    const call = (h: Record<string, string>) => cc.POST(json('http://l/api/cc/status-callback', {}, h))
    expect((await call({})).status).toBe(401)
    expect((await call({ 'x-intake-secret': 'wrong' })).status).toBe(401)
    expect((await call({ 'x-intake-secret': 'cc-secret-valuX' })).status).toBe(401)
    expect((await call({ 'x-intake-secret': 'cc-secret-value' })).status).toBe(200)
    delete process.env.INTAKE_WEBHOOK_SECRET
    expect((await call({ 'x-intake-secret': '' })).status).toBe(401)
    process.env.INTAKE_WEBHOOK_SECRET = 'cc-secret-value'
  })
})
