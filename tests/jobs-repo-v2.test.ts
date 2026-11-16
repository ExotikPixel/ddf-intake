import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { hasDb, TEST_URL, applySchema, resetTables } from './helpers/db'

describe.skipIf(!hasDb)('jobs-repo v2 columns', () => {
  let repo: typeof import('@/lib/jobs-repo')
  let tenantId: string
  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_URL
    applySchema()
    repo = await import('@/lib/jobs-repo')
    tenantId = await (await import('@/lib/tenant')).getDefaultTenantId()
  })
  beforeEach(async () => { await resetTables() })

  const job = (over: Partial<import('@/lib/jobs-repo').NewJob> = {}) => ({
    tenant_id: tenantId, reference_number: `DDF-T-${randomUUID().slice(0, 6)}`, client_name: 'A', company_name: 'B',
    contact_email: 'a@b.co', event_name: null, date_required: '2030-01-02', notes: null, setup_location: null,
    setup_time: null, removal_location: null, removal_time: null, items: [], file_paths: [],
    submission_id: randomUUID(), submitted_at: new Date().toISOString(), status: 'pending', ...over,
  })

  it('defaults job_type to event and stores product + fulfillment', async () => {
    const a = (await repo.insertJob(job())).data!
    const b = (await repo.insertJob(job({ job_type: 'product', fulfillment: 'pickup' }))).data!
    expect((await repo.getJob(a.id, ['job_type', 'fulfillment', 'reminders', 'deposit'])).data)
      .toEqual({ job_type: 'event', fulfillment: null, reminders: {}, deposit: null })
    expect((await repo.getJob(b.id, ['job_type', 'fulfillment'])).data).toEqual({ job_type: 'product', fulfillment: 'pickup' })
  })

  it('updates reminders and deposit jsonb, and finds a job by deposit order id', async () => {
    const { id } = (await repo.insertJob(job())).data!
    await repo.updateJob(id, { reminders: { count: 1, last_sent_at: '2030-01-01T10:00:00.000Z' }, deposit: { order_id: 'ORD1', status: 'sent', amount_cents: 1000 } })
    expect((await repo.getJob(id, ['reminders'])).data!.reminders).toEqual({ count: 1, last_sent_at: '2030-01-01T10:00:00.000Z' })
    expect((await repo.findJobByDepositOrder('ORD1')).data).toMatchObject({ id })
    expect((await repo.findJobByDepositOrder('NOPE')).data).toBeNull()
  })

  it('listOpenJobs skips completed and cancelled jobs', async () => {
    await repo.insertJob(job({ status: 'received' }))
    await repo.insertJob(job({ status: 'completed' }))
    await repo.insertJob(job({ status: 'cancelled' }))
    const { data } = await repo.listOpenJobs(['id', 'status'])
    expect(data!.map(r => r.status)).toEqual(['received'])
  })

  it('rejects an invalid job_type', async () => {
    const res = await repo.insertJob(job({ job_type: 'party' as 'event' }))
    expect(res.error).not.toBeNull()
  })
})
