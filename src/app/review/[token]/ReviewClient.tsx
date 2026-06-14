'use client'

import { useEffect, useState } from 'react'
import { APPROVAL_CONFIG, itemProofs } from '@/lib/job-types'
import type { JobItem, ApprovalStatus } from '@/lib/job-types'

interface ReviewData {
  reference_number: string
  event_name: string | null
  date_required: string
  items: JobItem[]
  proofUrls: Record<string, string>
}

function ApprovalPill({ status }: { status: ApprovalStatus }) {
  const cfg = APPROVAL_CONFIG[status]
  return (
    <span style={{
      background: cfg.bg, color: cfg.color, fontSize: 11, fontWeight: 700,
      letterSpacing: '0.6px', textTransform: 'uppercase', padding: '3px 9px',
      border: `1px solid ${cfg.color}33`, whiteSpace: 'nowrap',
    }}>
      {cfg.label}
    </span>
  )
}

export default function ReviewClient({ token }: { token: string }) {
  const [data, setData] = useState<ReviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [invalid, setInvalid] = useState(false)
  const [openIdx, setOpenIdx] = useState<number | null>(null)
  const [actioning, setActioning] = useState<number | null>(null)
  const [noteOpen, setNoteOpen] = useState<Record<number, boolean>>({})
  const [noteDraft, setNoteDraft] = useState<Record<number, string>>({})
  const [err, setErr] = useState<Record<number, string>>({})

  useEffect(() => {
    fetch(`/api/review/${token}`)
      .then(async res => {
        if (!res.ok) { setInvalid(true); return }
        setData(await res.json())
      })
      .catch(() => setInvalid(true))
      .finally(() => setLoading(false))
  }, [token])

  async function submit(idx: number, action: 'approve' | 'request_changes') {
    if (action === 'request_changes' && !(noteDraft[idx]?.trim())) {
      setErr(prev => ({ ...prev, [idx]: 'Please describe what needs to change.' }))
      return
    }
    setActioning(idx)
    setErr(prev => ({ ...prev, [idx]: '' }))
    try {
      const res = await fetch(`/api/review/${token}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemIndex: idx, action, note: noteDraft[idx] }),
      })
      if (res.status === 429) { setErr(prev => ({ ...prev, [idx]: 'Too many requests — please wait a moment and try again.' })); return }
      if (!res.ok) { setErr(prev => ({ ...prev, [idx]: 'Could not save — please try again.' })); return }
      const { items } = await res.json()
      setData(prev => prev ? { ...prev, items } : prev)
      setNoteOpen(prev => ({ ...prev, [idx]: false }))
      setNoteDraft(prev => ({ ...prev, [idx]: '' }))
    } catch {
      setErr(prev => ({ ...prev, [idx]: 'Network error — not saved.' }))
    } finally {
      setActioning(null)
    }
  }

  // ── States ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <Shell>
        <div style={{ padding: '64px 0', textAlign: 'center' }}>
          <div style={{ width: 38, height: 38, border: '3px solid var(--charcoal-border)', borderTopColor: 'var(--coral)', borderRadius: '50%', margin: '0 auto 14px', animation: 'spin 0.8s linear infinite' }} />
          <p style={{ color: 'var(--charcoal-60)', fontSize: 14, margin: 0 }}>Loading your proofs…</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </Shell>
    )
  }

  if (invalid || !data) {
    return (
      <Shell>
        <div style={{ background: '#fff', border: '1px solid var(--charcoal-border)', padding: '48px 32px', textAlign: 'center' }}>
          <h2 style={{ fontFamily: 'var(--font-heading)', fontSize: 20, fontWeight: 700, textTransform: 'uppercase', margin: '0 0 8px' }}>Link not valid</h2>
          <p style={{ color: 'var(--charcoal-60)', fontSize: 14, margin: 0, lineHeight: 1.6 }}>
            This approval link is invalid or has expired. Please ask us to send you a fresh one.
          </p>
        </div>
      </Shell>
    )
  }

  const reviewable = data.items
    .map((it, idx) => ({ it, idx }))
    .filter(x => itemProofs(x.it).length > 0)
  const approved = reviewable.filter(x => x.it.approval_status === 'approved').length
  const allDone = reviewable.length > 0 && approved === reviewable.length

  return (
    <Shell>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      {/* Job header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--coral)', marginBottom: 6 }}>Design Approval</div>
        <h1 style={{ fontFamily: 'var(--font-heading)', fontSize: 'clamp(22px, 5vw, 30px)', fontWeight: 700, textTransform: 'uppercase', margin: 0, letterSpacing: '0.5px' }}>
          {data.reference_number}
        </h1>
        <p style={{ margin: '6px 0 0', color: 'var(--charcoal-60)', fontSize: 13 }}>
          {data.event_name ? <>{data.event_name} · </> : null}
          Due {new Date(data.date_required + 'T00:00:00').toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })}
        </p>
      </div>

      {reviewable.length === 0 ? (
        <div style={{ background: '#fff', border: '1px solid var(--charcoal-border)', padding: '40px 28px', textAlign: 'center', color: 'var(--charcoal-60)', fontSize: 14 }}>
          Your proofs aren&apos;t ready yet. We&apos;ll let you know as soon as they are.
        </div>
      ) : (
        <>
          {allDone && (
            <div style={{ background: '#eef7f3', border: '1px solid #1B7F4F44', color: '#1B7F4F', padding: '12px 16px', marginBottom: 16, fontSize: 14, fontWeight: 600 }}>
              ✓ All proofs approved — thank you! We&apos;ll get these into print.
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--charcoal-60)' }}>Tap an item to review its design</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: allDone ? '#1B7F4F' : 'var(--charcoal)' }}>{approved} of {reviewable.length} approved</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {reviewable.map(({ it, idx }) => {
              const status: ApprovalStatus = it.approval_status ?? 'pending'
              const proofs = itemProofs(it)
              const isOpen = openIdx === idx
              const busy = actioning === idx
              const e = err[idx]
              return (
                <div key={idx} style={{ background: '#fff', border: '1px solid var(--charcoal-border)', borderLeft: `3px solid ${APPROVAL_CONFIG[status].color}` }}>
                  {/* Clickable header */}
                  <button
                    onClick={() => setOpenIdx(isOpen ? null : idx)}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '16px 18px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-body)' }}
                  >
                    <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--charcoal)' }}>
                      {it.quantity}× {it.name}
                      {it.size && <span style={{ color: 'var(--charcoal-60)', fontWeight: 400 }}> · {it.size}</span>}
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                      <ApprovalPill status={status} />
                      <span style={{ color: 'var(--charcoal-60)', fontSize: 18, transform: isOpen ? 'rotate(180deg)' : 'none', display: 'inline-block' }}>⌄</span>
                    </span>
                  </button>

                  {/* Expanded review */}
                  {isOpen && (
                    <div style={{ padding: '0 18px 18px', borderTop: '1px solid var(--charcoal-border)' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, margin: '16px 0' }}>
                        {proofs.map((p, pi) => {
                          const u = data.proofUrls[p]
                          return (
                            <a key={p} href={u ?? undefined} target="_blank" rel="noopener noreferrer"
                               style={{ display: 'block', background: '#f4f3f1', border: '1px solid var(--charcoal-border)' }}>
                              {u
                                ? <img src={u} alt={`Proof ${pi + 1} for ${it.name}`} style={{ width: '100%', maxHeight: 480, objectFit: 'contain', display: 'block' }} />
                                : <div style={{ padding: '48px 0', textAlign: 'center', color: '#aaa', fontSize: 13 }}>Loading proof…</div>}
                            </a>
                          )
                        })}
                      </div>
                      <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--charcoal-60)' }}>
                        {proofs.length > 1 ? `${proofs.length} proofs for this item — ` : ''}Tap an image to open it full size.
                      </p>

                      {status === 'changes_requested' && it.client_note && (
                        <p style={{ margin: '0 0 12px', fontSize: 13, color: '#C62828', background: '#fff0f0', border: '1px solid #f6caca', padding: '8px 11px' }}>
                          You requested: “{it.client_note}”
                        </p>
                      )}

                      {noteOpen[idx] ? (
                        <div>
                          <textarea
                            rows={3}
                            value={noteDraft[idx] ?? ''}
                            onChange={ev => setNoteDraft(prev => ({ ...prev, [idx]: ev.target.value }))}
                            placeholder="What would you like changed?"
                            style={{ width: '100%', padding: '10px', border: '1px solid #ddd', fontSize: 14, fontFamily: 'var(--font-body)', resize: 'vertical', boxSizing: 'border-box' }}
                          />
                          {e && <p style={{ margin: '6px 0 0', fontSize: 12, color: '#dc2626' }}>{e}</p>}
                          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                            <button onClick={() => submit(idx, 'request_changes')} disabled={busy}
                              style={{ flex: '1 1 140px', fontSize: 14, fontWeight: 700, padding: '12px', background: '#C62828', color: '#fff', border: 'none', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1, fontFamily: 'var(--font-body)' }}>
                              {busy ? 'Sending…' : 'Send Change Request'}
                            </button>
                            <button onClick={() => { setNoteOpen(prev => ({ ...prev, [idx]: false })); setErr(prev => ({ ...prev, [idx]: '' })) }} disabled={busy}
                              style={{ flex: '0 1 100px', fontSize: 14, padding: '12px', background: '#fff', border: '1px solid #ddd', cursor: 'pointer', fontFamily: 'var(--font-body)' }}>
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          {status !== 'approved' && (
                            <button onClick={() => submit(idx, 'approve')} disabled={busy}
                              style={{ flex: '1 1 160px', fontSize: 14, fontWeight: 700, padding: '13px', background: '#1B7F4F', color: '#fff', border: 'none', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1, fontFamily: 'var(--font-body)', letterSpacing: '0.5px' }}>
                              {busy ? 'Saving…' : '✓ Approve for Print'}
                            </button>
                          )}
                          <button onClick={() => { setNoteOpen(prev => ({ ...prev, [idx]: true })); setNoteDraft(prev => ({ ...prev, [idx]: prev[idx] ?? '' })) }} disabled={busy}
                            style={{ flex: status === 'approved' ? '1 1 160px' : '0 1 150px', fontSize: 14, fontWeight: 600, padding: '13px', background: '#fff', color: status === 'approved' ? 'var(--charcoal-60)' : '#C62828', border: `1px solid ${status === 'approved' ? 'var(--charcoal-border)' : '#f6caca'}`, cursor: 'pointer', fontFamily: 'var(--font-body)' }}>
                            {status === 'approved' ? 'Request changes instead' : 'Request Changes'}
                          </button>
                        </div>
                      )}
                      {e && !noteOpen[idx] && <p style={{ margin: '8px 0 0', fontSize: 12, color: '#dc2626' }}>{e}</p>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', fontFamily: 'var(--font-body)' }}>
      <header style={{ background: 'var(--charcoal)', height: 56, padding: '0 20px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: '2px solid var(--coral)' }}>
        <img src="/logo-pixel.png" alt="DDF x Pixel" style={{ height: 28, width: 'auto', filter: 'brightness(0) invert(1)' }} />
      </header>
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '28px 18px 64px' }}>
        {children}
      </div>
      <footer style={{ background: 'var(--charcoal)', padding: '18px 20px', textAlign: 'center', borderTop: '2px solid var(--coral)' }}>
        <span style={{ fontSize: 12, color: '#555' }}>© 2026 DDF x Pixel</span>
      </footer>
    </div>
  )
}
