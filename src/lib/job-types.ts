export interface JobItem {
  name: string
  quantity: number
  size: string
  material: string
  // ── Client design-approval fields (optional; items is JSONB, no migration) ──
  proof_urls?: string[]                               // job-files paths to design proofs (one item can have several)
  proof_url?: string                                  // LEGACY single proof — read via itemProofs(); kept for old rows
  approval_status?: 'pending' | 'approved' | 'changes_requested'
  approved_proof_url?: string                         // when several proofs are offered, the ONE design the client picked
  client_note?: string                                // client's change-request text
  approved_at?: string                                // ISO timestamp when approved
}

/** All proof paths for an item, preferring the multi-proof array, falling back to the legacy single field. */
export function itemProofs(item: JobItem): string[] {
  if (item.proof_urls && item.proof_urls.length) return item.proof_urls
  if (item.proof_url) return [item.proof_url]
  return []
}

/**
 * The proof(s) that should actually go to print for an item. When the client
 * picked one design out of several (approved_proof_url), that's the only one.
 * Falls back to all proofs for single-proof items and older approved rows.
 */
export function approvedProofs(item: JobItem): string[] {
  const all = itemProofs(item)
  if (item.approved_proof_url && all.includes(item.approved_proof_url)) return [item.approved_proof_url]
  return all
}

export const APPROVAL_STATUSES = ['pending', 'approved', 'changes_requested'] as const
export type ApprovalStatus = typeof APPROVAL_STATUSES[number]

/** Pill styling for per-item approval state (mirrors STATUS_CONFIG shape) */
export const APPROVAL_CONFIG: Record<ApprovalStatus, { label: string; color: string; bg: string }> = {
  pending:            { label: 'Awaiting Review', color: '#888888', bg: '#f0f0f0' },
  approved:           { label: 'Approved',        color: '#1B7F4F', bg: '#eef7f3' },
  changes_requested:  { label: 'Changes Requested', color: '#C62828', bg: '#fff0f0' },
}

export const STATUSES = ['pending', 'received', 'in_progress', 'completed', 'cancelled'] as const
export type Status = typeof STATUSES[number]

export const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  received: 'Received',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

// Superset of admin STATUS_COLORS — includes bg shades used by the portal pill
export const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  pending:     { label: 'Pending',     color: '#888888', bg: '#f0f0f0' },
  received:    { label: 'Received',    color: '#1B7F4F', bg: '#eef7f3' },
  in_progress: { label: 'In Progress', color: '#b06a00', bg: '#fff7ed' },
  completed:   { label: 'Completed',   color: '#131313', bg: '#f0f0f0' },
  cancelled:   { label: 'Cancelled',   color: '#C62828', bg: '#fff0f0' },
}

/** DB status values that trigger a client notification email */
export const NOTIFICATION_STATUSES = ['in_progress', 'completed'] as const
export type NotificationStatus = typeof NOTIFICATION_STATUSES[number]
