import { describe, it, expect } from 'vitest'
import { adminKpis, approvalSummary, jobWaiting } from '@/lib/admin-kpis'
import type { JobItem } from '@/lib/job-types'

const proofed = (approval_status?: JobItem['approval_status']): JobItem => ({ name: 'X', quantity: 1, size: '', material: 'pvc', proof_urls: ['uploads/a.png'], approval_status })
const job = (over: Record<string, unknown>) => ({ status: 'received', date_required: '2026-11-18', items: [proofed('approved')], deposit: null, ...over })
const TODAY = '2026-11-15'

describe('admin KPIs', () => {
  it('approvalSummary counts proofed pieces only', () => {
    expect(approvalSummary([proofed('approved'), proofed(), { name: 'Y', quantity: 1, size: '', material: 'pvc' }])).toEqual({ approved: 1, total: 2 })
  })
  it('jobWaiting: a proof is out and not yet approved', () => {
    expect(jobWaiting(job({ items: [proofed()] }))).toBe(true)
    expect(jobWaiting(job({ items: [proofed('changes_requested')] }))).toBe(false)
    expect(jobWaiting(job({}))).toBe(false)
  })
  it('counts the four cards', () => {
    const k = adminKpis([
      job({ items: [proofed()] }),                                        // waiting, due in 3 days
      job({ date_required: '2026-11-30' }),                               // not soon
      job({ status: 'in_progress', deposit: { status: 'sent' } }),        // production, deposit due, soon
      job({ status: 'completed', items: [proofed()] }),                   // closed: ignored
    ], TODAY)
    expect(k).toEqual({ awaiting: 1, soon: 2, inProduction: 1, depositsOutstanding: 1 })
  })
})
