import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { hasDb, TEST_URL, applySchema, resetTables } from './helpers/db'

describe.skipIf(!hasDb)('jobs-repo', () => {
  let repo: typeof import('@/lib/jobs-repo')
  let tenantId: string

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_URL
    applySchema()
    repo = await import('@/lib/jobs-repo')
    tenantId = await (await import('@/lib/tenant')).getDefaultTenantId()
  })
  beforeEach(async () => { await resetTables() })

  const newJob = (over: Partial<import('@/lib/jobs-repo').NewJob> = {}): import('@/lib/jobs-repo').NewJob => ({
    tenant_id: tenantId,
    reference_number: `DDF-TEST-${randomUUID().slice(0, 6).toUpperCase()}`,
    client_name: 'Ana', company_name: 'Acme', contact_email: 'ana@acme.co',
    event_name: null, date_required: '2030-01-02', notes: null,
    setup_location: null, setup_time: null, removal_location: null, removal_time: null,
    items: [{ name: 'Item', quantity: 1 }], file_paths: [],
    submission_id: randomUUID(), submitted_at: new Date().toISOString(), status: 'pending',
    ...over,
  })

  it('insertJob → ids from 1,000,000; getJob returns Supabase-shaped values', async () => {
    const ins = await repo.insertJob(newJob())
    expect(ins.error).toBeNull()
    expect(ins.data!.id).toBe(1000000)
    const { data: row } = await repo.getJob(ins.data!.id, ['id', 'date_required', 'submitted_at', 'items', 'file_paths', 'notify_client'])
    expect(row).toMatchObject({ id: 1000000, date_required: '2030-01-02', file_paths: [], notify_client: false, items: [{ name: 'Item', quantity: 1 }] })
    expect(row!.submitted_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/)
  })

  it('getJob scopes by tenant and returns null data when missing', async () => {
    const { data } = await repo.insertJob(newJob())
    expect((await repo.getJob(data!.id, ['id'], '00000000-0000-0000-0000-000000000000')).data).toBeNull()
    expect((await repo.getJob(999, ['id'])).data).toBeNull()
  })

  it('updateJob writes whitelisted columns, including json and empty arrays', async () => {
    const { data } = await repo.insertJob(newJob({ file_paths: ['uploads/a.pdf'] }))
    const upd = await repo.updateJob(data!.id, { status: 'received', file_paths: [], production: { '2030-01-02': 'done' }, notify_client: true }, tenantId)
    expect(upd).toEqual({ data: 1, error: null })
    const { data: row } = await repo.getJob(data!.id, ['status', 'file_paths', 'production', 'notify_client'])
    expect(row).toEqual({ status: 'received', file_paths: [], production: { '2030-01-02': 'done' }, notify_client: true })
  })

  it('updateJob refuses columns that are not whitelisted', async () => {
    const { data } = await repo.insertJob(newJob())
    const res = await repo.updateJob(data!.id, { reference_number: 'HACK' })
    expect(res.data).toBeNull()
    expect(res.error?.message).toMatch(/not allowed/)
  })

  it('updateJobItem: 10 parallel approvals all persist (row lock)', async () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ name: `I${i}`, quantity: 1 }))
    const { data } = await repo.insertJob(newJob({ items }))
    const results = await Promise.all(items.map((_, i) => repo.updateJobItem(data!.id, i, { approval_status: 'approved' }, null)))
    expect(results.every(r => r.error === null)).toBe(true)
    const { data: row } = await repo.getJob(data!.id, ['items'])
    expect((row!.items as { approval_status?: string }[]).every(it => it.approval_status === 'approved')).toBe(true)
  })

  it('updateJobItem appends a chat message and returns the items', async () => {
    const { data } = await repo.insertJob(newJob())
    const msg = { from: 'client', text: 'Hi', at: '2030-01-01T00:00:00Z' }
    const { data: items } = await repo.updateJobItem(data!.id, 0, { client_note: 'Hi' }, msg)
    expect(items![0]).toMatchObject({ client_note: 'Hi', messages: [msg] })
  })

  it('updateJobItem reports an error for a missing item', async () => {
    const { data } = await repo.insertJob(newJob())
    expect((await repo.updateJobItem(data!.id, 5, { a: 1 }, null)).error).not.toBeNull()
  })

  it('appendToJob appends items and files', async () => {
    const { data } = await repo.insertJob(newJob({ file_paths: ['uploads/a.pdf'] }))
    const { data: res } = await repo.appendToJob(data!.id, [{ name: 'New', quantity: 2 }], ['uploads/b.pdf'])
    expect(res!.items).toHaveLength(2)
    expect(res!.file_paths).toEqual(['uploads/a.pdf', 'uploads/b.pdf'])
  })

  it('finds by reference (case-insensitive), by reference exact, and by submission id', async () => {
    const job = newJob({ reference_number: 'DDF-20300101-ABC123' })
    const { data } = await repo.insertJob(job)
    expect((await repo.findJobsByReferenceCI('ddf-20300101-abc123')).data).toEqual([{ id: data!.id, contact_email: 'ana@acme.co' }])
    expect((await repo.getJobByReference('DDF-20300101-ABC123', ['id'])).data).toEqual({ id: data!.id })
    expect((await repo.findJobBySubmissionId(job.submission_id)).data).toEqual({ reference_number: 'DDF-20300101-ABC123' })
  })

  it('listJobs is newest-first; listJobFiles returns paths and items', async () => {
    await repo.insertJob(newJob({ submitted_at: '2030-01-01T00:00:00Z', file_paths: ['uploads/old.pdf'] }))
    await repo.insertJob(newJob({ submitted_at: '2030-02-01T00:00:00Z' }))
    const { data: list } = await repo.listJobs(tenantId)
    expect(list!.map(j => j.submitted_at.slice(0, 7))).toEqual(['2030-02', '2030-01'])
    const { data: files } = await repo.listJobFiles(tenantId)
    expect(files!.flatMap(f => f.file_paths)).toContain('uploads/old.pdf')
  })
})
