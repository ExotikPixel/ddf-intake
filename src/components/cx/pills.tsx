import { Pill } from '@/components/cx/kit'
import type { ApprovalStatus } from '@/lib/job-types'

export function ApprovalPill({ status }: { status: ApprovalStatus | undefined }) {
  if (status === 'approved') return <Pill tone="ok">Approved</Pill>
  if (status === 'changes_requested') return <Pill tone="alert">Changes requested</Pill>
  return <Pill tone="wait">Needs you</Pill>
}

export function JobStatusPill({ status }: { status: string }) {
  if (status === 'in_progress') return <Pill tone="gold">In production</Pill>
  if (status === 'completed') return <Pill tone="ok">Completed</Pill>
  if (status === 'cancelled') return <Pill tone="alert">Cancelled</Pill>
  return <Pill tone="neutral">Received</Pill>
}
