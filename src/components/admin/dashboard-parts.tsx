import type { ReactNode } from 'react'
import { countdownLabel } from '@/lib/countdown'

// Presentational pieces of the admin dashboard (markup only — no data fetching or state).

/** Two-letter initials for a client/company avatar. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}

export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' }) {
  return <span className={`adm-avatar${size === 'sm' ? ' sm' : ''}`} aria-hidden="true">{initials(name)}</span>
}

/** "2/3" approvals bar with an optional "changes" dot. */
export function ApprovalsBar({ approved, total, changes, compact }: { approved: number; total: number; changes: boolean; compact?: boolean }) {
  if (!total) return <span className="tiny muted">No proofs yet</span>
  return (
    <span className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
      <span className="mini-bar" style={compact ? { width: 56 } : undefined}>
        <span style={{ width: `${(approved / total) * 100}%`, background: approved === total ? 'var(--sage)' : 'var(--mauve)' }} />
      </span>
      <span className="tiny num">{approved}/{total}</span>
      {changes && (
        <span className="tiny row" title="Changes requested" style={{ gap: 4, color: 'var(--rose)', fontWeight: 500 }}>
          <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--rose)' }} />changes
        </span>
      )}
    </span>
  )
}

/** Countdown pill — rose when the date is 0–4 days away. */
export function CountdownPill({ days }: { days: number }) {
  const urgent = days >= 0 && days <= 4
  return <span className={`pill ${urgent ? 'pill-alert' : 'pill-neutral'}`}>{countdownLabel(days)}</span>
}

/** Weekday + day-number block for an ISO date (YYYY-MM-DD). */
export function DateBlock({ iso }: { iso: string }) {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(y, (m || 1) - 1, d || 1)
  return (
    <span className="adm-date" aria-hidden="true">
      <span className="wd">{date.toLocaleDateString('en-US', { weekday: 'short' })}</span>
      <b className="num">{date.getDate()}</b>
      <span className="mo">{date.toLocaleDateString('en-US', { month: 'short' })}</span>
    </span>
  )
}

/** Numbered section head used inside the job drawer. */
export function DrawerSec({ n, title, aside }: { n: number; title: string; aside?: ReactNode }) {
  return (
    <div className="sec-head adm-dsec">
      <span className="sec-num">{String(n).padStart(2, '0')}</span>
      <h3 className="sec-title" style={{ margin: 0 }}>{title}</h3>
      {aside && <span style={{ marginLeft: 'auto' }}>{aside}</span>}
    </div>
  )
}
