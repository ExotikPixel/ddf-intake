import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { SubmitSchema, AddToJobSchema } from '@/lib/schemas'
import { MAX_PIECES, MAX_FILES, MAX_FILE_BYTES, MAX_FILE_MB, UPLOAD_BATCH } from '@/lib/limits'

const item = { name: 'Sign', quantity: 1, size: '24x36', material: 'pvc' as const }
const base = {
  clientName: 'A', companyName: 'B', contactEmail: 'A@B.co ', dateRequired: '2030-01-02',
  items: [item], filePaths: [], submissionId: randomUUID(),
}

describe('limits', () => {
  it('match the spec', () => {
    expect([MAX_PIECES, MAX_FILES, MAX_FILE_MB, UPLOAD_BATCH]).toEqual([30, 10, 95, 10])
    expect(MAX_FILE_BYTES).toBe(95 * 1024 * 1024)
  })
})

describe('SubmitSchema', () => {
  it('defaults to an event and accepts 30 pieces and 10 files', () => {
    const r = SubmitSchema.safeParse({ ...base, items: Array(30).fill(item), filePaths: Array(10).fill('uploads/a.png') })
    expect(r.success).toBe(true)
    expect(r.success && r.data.jobType).toBe('event')
  })
  it('rejects 31 pieces and 11 files', () => {
    expect(SubmitSchema.safeParse({ ...base, items: Array(31).fill(item) }).success).toBe(false)
    expect(SubmitSchema.safeParse({ ...base, filePaths: Array(11).fill('uploads/a.png') }).success).toBe(false)
  })
  it('accepts metal', () => {
    expect(SubmitSchema.safeParse({ ...base, items: [{ ...item, material: 'metal' }] }).success).toBe(true)
  })
  it('a product needs a hand-over choice, and an address unless picked up', () => {
    expect(SubmitSchema.safeParse({ ...base, jobType: 'product' }).success).toBe(false)
    expect(SubmitSchema.safeParse({ ...base, jobType: 'product', fulfillment: 'pickup' }).success).toBe(true)
    const noAddr = SubmitSchema.safeParse({ ...base, jobType: 'product', fulfillment: 'delivery' })
    expect(noAddr.success).toBe(false)
    expect(!noAddr.success && noAddr.error.issues[0].path).toEqual(['setupLocation'])
    expect(SubmitSchema.safeParse({ ...base, jobType: 'product', fulfillment: 'install', setupLocation: '214 King St W' }).success).toBe(true)
  })
})

describe('AddToJobSchema', () => {
  it('allows 30 new pieces and 10 files', () => {
    expect(AddToJobSchema.safeParse({ newItems: Array(30).fill(item), newFilePaths: Array(10).fill('uploads/a.png') }).success).toBe(true)
    expect(AddToJobSchema.safeParse({ newItems: Array(31).fill(item) }).success).toBe(false)
  })
})
