import { itemProofs } from '@/lib/job-types'
import type { JobItem } from '@/lib/job-types'
import { addDays } from '@/lib/local-time'

export interface KpiJob { status: string; date_required: string; items: JobItem[]; deposit?: { status?: string } | null }

/** Approved vs proofed pieces (pieces without a proof don't count yet). */
export function approvalSummary(items: JobItem[]): { approved: number; total: number } {
  const proofed = (items ?? []).filter(it => itemProofs(it).length > 0)
  return { approved: proofed.filter(it => it.approval_status === 'approved').length, total: proofed.length }
}

/** A proof is with the client and they haven't answered (changes requested = ball is with the shop). */
export function jobWaiting(job: KpiJob): boolean {
  return (job.items ?? []).some(it => itemProofs(it).length > 0 && (it.approval_status ?? 'pending') === 'pending')
}

const open = (j: KpiJob) => j.status !== 'completed' && j.status !== 'cancelled'

export function adminKpis(jobs: KpiJob[], today: string) {
  const end = addDays(today, 6)
  return {
    awaiting: jobs.filter(j => open(j) && jobWaiting(j)).length,
    soon: jobs.filter(j => open(j) && j.date_required >= today && j.date_required <= end).length,
    inProduction: jobs.filter(j => j.status === 'in_progress').length,
    depositsOutstanding: jobs.filter(j => j.deposit?.status === 'sent').length,
  }
}
