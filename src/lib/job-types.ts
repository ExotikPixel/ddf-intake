export interface JobItem {
  name: string
  quantity: number
  size: string
  material: string
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
