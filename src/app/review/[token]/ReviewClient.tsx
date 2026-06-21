'use client'

import { useEffect, useRef, useState } from 'react'
import { APPROVAL_CONFIG, itemProofs, itemExamplePhotos, itemThread, designsMode } from '@/lib/job-types'
import type { JobItem, ApprovalStatus } from '@/lib/job-types'

interface ReviewData {
  reference_number: string
  event_name: string | null
  date_required: string
  items: JobItem[]
  proofUrls: Record<string, string>
  clientName: string
  shopName: string
}

function fmtWhen(at: string): string {
  if (!at) return ''
  const d = new Date(at)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' }) + ', ' +
    d.toLocaleTimeString('en-ZA', { hour: 'numeric', minute: '2-digit' })
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
  const [actioningAll, setActioningAll] = useState(false)
  const [allMsg, setAllMsg] = useState('')
  const [noteDraft, setNoteDraft] = useState<Record<number, string>>({})
  const [selected, setSelected] = useState<Record<number, string>>({}) // item index → chosen proof path
  const [err, setErr] = useState<Record<number, string>>({})
  const [chatOpen, setChatOpen] = useState<number | null>(null) // item index whose chat drawer is open
  const chatBodyRef = useRef<HTMLDivElement>(null)

  // Keep the chat scrolled to the newest message when it opens or updates.
  useEffect(() => {
    if (chatOpen !== null && chatBodyRef.current) {
      chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight
    }
  }, [chatOpen, data])

  useEffect(() => {
    fetch(`/api/review/${token}`)
      .then(async res => {
        if (!res.ok) { setInvalid(true); return }
        setData(await res.json())
      })
      .catch(() => setInvalid(true))
      .finally(() => setLoading(false))
  }, [token])

  // Pull the latest designs/messages — used to self-heal a stale page after a
  // failed action (e.g. the shop added another design since this page loaded).
  async function refresh() {
    try {
      const res = await fetch(`/api/review/${token}`)
      if (res.ok) setData(await res.json())
    } catch { /* keep showing what we have */ }
  }

  async function submit(idx: number, action: 'approve' | 'request_changes', proofs: string[]) {
    if (action === 'request_changes' && !(noteDraft[idx]?.trim())) {
      setErr(prev => ({ ...prev, [idx]: 'Please describe what needs to change.' }))
      return
    }
    const itForMode = data?.items[idx]
    const pickMode = !!itForMode && proofs.length > 1 && designsMode(itForMode) === 'pick'
    if (action === 'approve' && pickMode && !selected[idx]) {
      setErr(prev => ({ ...prev, [idx]: 'Please choose which design you want to approve.' }))
      return
    }
    setActioning(idx)
    setErr(prev => ({ ...prev, [idx]: '' }))
    try {
      const res = await fetch(`/api/review/${token}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemIndex: idx, action, note: noteDraft[idx], selectedProof: selected[idx] }),
      })
      if (res.status === 429) { setErr(prev => ({ ...prev, [idx]: 'Too many requests — please wait a moment and try again.' })); return }
      if (!res.ok) {
        // Show the server's actual reason (e.g. "Please choose which design to
        // approve") and pull the latest designs in case this page was stale.
        let msg = 'Could not save — please try again.'
        try { const j = await res.json(); if (j?.error) msg = j.error } catch { /* keep default */ }
        setErr(prev => ({ ...prev, [idx]: msg }))
        setSelected(prev => ({ ...prev, [idx]: '' }))
        await refresh()
        return
      }
      const { items } = await res.json()
      setData(prev => prev ? { ...prev, items } : prev)
      setNoteDraft(prev => ({ ...prev, [idx]: '' }))
    } catch {
      setErr(prev => ({ ...prev, [idx]: 'Network error — not saved.' }))
    } finally {
      setActioning(null)
    }
  }

  // Approve every ready item at once. Pick-one items with a choice already made
  // are included (their selection is sent); pick items still awaiting a choice
  // come back as `skipped` and are flagged for individual approval.
  async function submitAll() {
    if (!data) return
    setActioningAll(true)
    setAllMsg('')
    try {
      const selections: Record<string, string> = {}
      for (const [k, v] of Object.entries(selected)) if (v) selections[k] = v
      const res = await fetch(`/api/review/${token}/approve-all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selections }),
      })
      if (res.status === 429) { setAllMsg('Too many requests — please wait a moment and try again.'); return }
      if (!res.ok) { setAllMsg('Could not approve everything — please try again.'); await refresh(); return }
      const j = await res.json()
      setData(prev => prev ? { ...prev, items: j.items } : prev)
      if (j.skipped > 0) {
        setAllMsg(`${j.skipped} item${j.skipped > 1 ? 's' : ''} still need you to choose a design — please approve ${j.skipped > 1 ? 'them' : 'it'} below.`)
      }
    } catch {
      setAllMsg('Network error — not saved.')
    } finally {
      setActioningAll(false)
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
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes chatIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        .chat-backdrop { position: fixed; inset: 0; background: rgba(20,18,16,0.45); z-index: 60; animation: fadeIn 0.2s ease; }
        .chat-drawer { position: fixed; top: 0; right: 0; height: 100%; height: 100dvh; width: 400px; max-width: 100%; background: var(--bg); z-index: 61; display: flex; flex-direction: column; box-shadow: -10px 0 30px rgba(0,0,0,0.18); animation: chatIn 0.22s ease; }
        .chat-head { background: var(--charcoal); color: #fff; padding: 14px 16px; display: flex; align-items: center; justify-content: space-between; gap: 10px; border-bottom: 2px solid var(--coral); flex-shrink: 0; }
        .chat-head-title { font-weight: 700; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .chat-head-sub { font-size: 11px; color: #b9b4ad; margin-top: 2px; }
        .chat-close { background: rgba(255,255,255,0.14); color: #fff; border: none; width: 32px; height: 32px; border-radius: 50%; font-size: 14px; cursor: pointer; flex-shrink: 0; line-height: 1; }
        .chat-body { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; -webkit-overflow-scrolling: touch; }
        .chat-empty { text-align: center; color: var(--charcoal-60); font-size: 13.5px; line-height: 1.6; margin: auto 0; padding: 24px; }
        .chat-row { display: flex; flex-direction: column; max-width: 82%; }
        .chat-row.me { align-self: flex-end; align-items: flex-end; }
        .chat-row.them { align-self: flex-start; align-items: flex-start; }
        .chat-bubble { padding: 9px 13px; border-radius: 16px; font-size: 14px; line-height: 1.45; white-space: pre-wrap; word-break: break-word; }
        .chat-row.me .chat-bubble { background: var(--coral); color: #fff; border-bottom-right-radius: 4px; }
        .chat-row.them .chat-bubble { background: #fff; color: var(--charcoal); border: 1px solid var(--charcoal-border); border-bottom-left-radius: 4px; }
        .chat-meta { font-size: 10.5px; color: var(--charcoal-60); margin-top: 4px; padding: 0 4px; }
        .chat-foot { border-top: 1px solid var(--charcoal-border); padding: 10px 12px; padding-bottom: calc(10px + env(safe-area-inset-bottom)); background: #fff; flex-shrink: 0; }
        .chat-err { font-size: 12px; color: #dc2626; margin-bottom: 6px; }
        .chat-compose { display: flex; gap: 8px; align-items: flex-end; }
        .chat-input { flex: 1; padding: 10px 14px; border: 1px solid var(--charcoal-border); border-radius: 20px; font-size: 16px; font-family: var(--font-body); resize: none; max-height: 120px; box-sizing: border-box; outline: none; }
        .chat-input:focus { border-color: var(--coral); }
        .chat-send { background: var(--coral); color: #fff; border: none; border-radius: 20px; padding: 11px 18px; font-weight: 700; font-size: 14px; cursor: pointer; font-family: var(--font-body); flex-shrink: 0; }
        .chat-send:disabled { opacity: 0.5; cursor: default; }
        .chat-hint { font-size: 11px; color: var(--charcoal-60); margin-top: 7px; text-align: center; }
        @media (max-width: 560px) { .chat-drawer { width: 100%; } }
      `}</style>
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
          {reviewable.length > 1 && !allDone && (
            <div style={{ background: '#fff', border: '1px solid var(--charcoal-border)', padding: '12px 14px', marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, color: 'var(--charcoal-60)', fontWeight: 600 }}>Happy with everything? Approve all designs at once.</span>
              <button onClick={submitAll} disabled={actioningAll}
                style={{ fontSize: 14, fontWeight: 700, padding: '11px 18px', background: '#1B7F4F', color: '#fff', border: 'none', cursor: actioningAll ? 'default' : 'pointer', opacity: actioningAll ? 0.6 : 1, fontFamily: 'var(--font-body)', letterSpacing: '0.5px', whiteSpace: 'nowrap' }}>
                {actioningAll ? 'Approving…' : '✓ Approve all'}
              </button>
            </div>
          )}
          {allMsg && (
            <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', color: '#b06a00', padding: '10px 14px', marginBottom: 12, fontSize: 13, fontWeight: 600 }}>
              {allMsg}
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
                      {it.description && (
                        <p style={{ margin: '14px 0 0', fontSize: 13, lineHeight: 1.5, color: 'var(--charcoal-60)', whiteSpace: 'pre-wrap' }}>
                          <span style={{ fontWeight: 700, color: 'var(--charcoal)' }}>Your brief: </span>{it.description}
                        </p>
                      )}
                      {it.admin_note && (
                        <div style={{ margin: '14px 0 0', padding: '10px 12px', background: '#faf9f7', border: '1px solid var(--charcoal-border)', borderLeft: '3px solid var(--coral)' }}>
                          <span style={{ display: 'block', fontSize: 10, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--coral)', marginBottom: 4 }}>A note from us</span>
                          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: 'var(--charcoal)', whiteSpace: 'pre-wrap' }}>{it.admin_note}</p>
                        </div>
                      )}
                      {itemExamplePhotos(it).length > 0 && (
                        <div style={{ margin: '16px 0 0', padding: '12px 14px 14px', background: '#f7f5f1', border: '1px dashed #cfc7b6', borderRadius: 8 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                            <span style={{ fontSize: 14, lineHeight: 1 }} aria-hidden>💡</span>
                            <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--charcoal-60)' }}>Inspiration &amp; examples</span>
                          </div>
                          <p style={{ margin: '3px 0 10px 22px', fontSize: 11.5, lineHeight: 1.45, color: 'var(--charcoal-60)' }}>
                            For reference only — <strong style={{ color: 'var(--charcoal)' }}>not</strong> your artwork and <strong style={{ color: 'var(--charcoal)' }}>not printed</strong>. Your {proofs.length > 1 ? 'proofs are' : 'proof is'} below.
                          </p>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                            {itemExamplePhotos(it).map(p => {
                              const u = data.proofUrls[p]
                              return (
                                <a key={p} href={u ?? undefined} target="_blank" rel="noopener noreferrer" style={{ position: 'relative', display: 'block', width: 92, height: 92, background: '#eceae5', border: '1px solid #d8d1c2', overflow: 'hidden', borderRadius: 5 }}>
                                  {u
                                    ? <img src={u} alt="Example" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                                    : <span style={{ fontSize: 10, color: '#aaa', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>Loading…</span>}
                                  <span style={{ position: 'absolute', left: 0, bottom: 0, right: 0, fontSize: 8.5, fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', textAlign: 'center', color: '#fff', background: 'rgba(19,19,19,0.55)', padding: '2px 0' }}>Example</span>
                                </a>
                              )
                            })}
                          </div>
                        </div>
                      )}
                      {(() => {
                        const multi = proofs.length > 1
                        const pickMode = multi && designsMode(it) === 'pick'   // alternatives → choose one; else all needed
                        const isApproved = status === 'approved'
                        // Only treat designs as picked/not-picked when an actual choice was recorded.
                        const hasPick = pickMode && isApproved && !!it.approved_proof_url
                        // After approval the chosen design is fixed; before, it follows local selection.
                        const chosen = isApproved ? it.approved_proof_url : selected[idx]
                        return (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, margin: '16px 0' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ width: 16, height: 2, background: 'var(--coral)', borderRadius: 2, flexShrink: 0 }} />
                              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1.1px', textTransform: 'uppercase', color: 'var(--coral)' }}>
                                {multi ? 'Your design proofs — for approval' : 'Your design proof — for approval'}
                              </span>
                            </div>
                            {proofs.map((p, pi) => {
                              const u = data.proofUrls[p]
                              const isChosen = pickMode && chosen === p
                              const dimmed = hasPick && !isChosen // non-selected designs fade out once a pick is recorded
                              const selectable = pickMode && !isApproved
                              return (
                                <div key={p} style={{
                                  border: `2px solid ${isChosen ? '#1B7F4F' : 'var(--charcoal-border)'}`,
                                  background: '#fff', opacity: dimmed ? 0.5 : 1,
                                }}>
                                  {multi && (
                                    <button
                                      onClick={selectable ? () => { setSelected(prev => ({ ...prev, [idx]: p })); setErr(prev => ({ ...prev, [idx]: '' })) } : undefined}
                                      disabled={!selectable}
                                      style={{
                                        width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                                        background: isChosen ? '#eef7f3' : '#faf9f7', border: 'none',
                                        borderBottom: '1px solid var(--charcoal-border)', cursor: selectable ? 'pointer' : 'default',
                                        textAlign: 'left', fontFamily: 'var(--font-body)',
                                      }}>
                                      {pickMode && (
                                        <span style={{
                                          width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                                          border: `2px solid ${isChosen ? '#1B7F4F' : '#bbb'}`, background: isChosen ? '#1B7F4F' : '#fff',
                                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11, fontWeight: 700,
                                        }}>{isChosen ? '✓' : ''}</span>
                                      )}
                                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--charcoal)' }}>
                                        Design {pi + 1}
                                        {!pickMode && <span style={{ color: 'var(--charcoal-60)', fontWeight: 400 }}> · will be printed</span>}
                                        {hasPick && isChosen && <span style={{ color: '#1B7F4F' }}> · Approved</span>}
                                        {hasPick && !isChosen && <span style={{ color: 'var(--charcoal-60)', fontWeight: 400 }}> · Not selected</span>}
                                        {selectable && <span style={{ color: 'var(--charcoal-60)', fontWeight: 400 }}>{isChosen ? ' · Selected' : ' · Tap to choose'}</span>}
                                      </span>
                                    </button>
                                  )}
                                  <a href={u ?? undefined} target="_blank" rel="noopener noreferrer" style={{ display: 'block', background: '#f4f3f1' }}>
                                    {u
                                      ? <img src={u} alt={`Design ${pi + 1} for ${it.name}`} style={{ width: '100%', maxHeight: 480, objectFit: 'contain', display: 'block' }} />
                                      : <div style={{ padding: '48px 0', textAlign: 'center', color: '#aaa', fontSize: 13 }}>Loading proof…</div>}
                                  </a>
                                </div>
                              )
                            })}
                          </div>
                        )
                      })()}
                      <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--charcoal-60)' }}>
                        {proofs.length > 1
                          ? (designsMode(it) === 'pick'
                              ? `${proofs.length} designs — choose the one you'd like, then approve. Tap an image to open it full size.`
                              : `${proofs.length} designs — all will be printed. Tap an image to open it full size.`)
                          : 'Tap the image to open it full size.'}
                      </p>

                      {/* Earlier versions of this design, kept for reference */}
                      {(it.proof_history?.length ?? 0) > 0 && (
                        <div style={{ marginBottom: 14 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.6px', textTransform: 'uppercase', color: 'var(--charcoal-60)', marginBottom: 6 }}>Earlier versions</div>
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            {it.proof_history!.map((p, vi) => {
                              const u = data.proofUrls[p]
                              return (
                                <a key={p} href={u ?? undefined} target="_blank" rel="noopener noreferrer"
                                   title={`Version ${vi + 1}`}
                                   style={{ display: 'block', width: 56, height: 56, border: '1px solid var(--charcoal-border)', background: '#f4f3f1', flexShrink: 0 }}>
                                  {u && <img src={u} alt={`Version ${vi + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', opacity: 0.7 }} />}
                                </a>
                              )
                            })}
                          </div>
                        </div>
                      )}

                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {status !== 'approved' && (() => {
                          const pick = designsMode(it) === 'pick' && proofs.length > 1
                          const needsPick = pick && !selected[idx]
                          return (
                            <button onClick={() => submit(idx, 'approve', proofs)} disabled={busy || needsPick}
                              style={{ flex: '1 1 160px', fontSize: 14, fontWeight: 700, padding: '13px', background: '#1B7F4F', color: '#fff', border: 'none', cursor: (busy || needsPick) ? 'default' : 'pointer', opacity: (busy || needsPick) ? 0.6 : 1, fontFamily: 'var(--font-body)', letterSpacing: '0.5px' }}>
                              {busy ? 'Saving…' : needsPick ? 'Choose a design above' : pick ? '✓ Approve selected design' : '✓ Approve for Print'}
                            </button>
                          )
                        })()}
                        {(() => {
                          const count = itemThread(it).length
                          const label = count > 0
                            ? `💬 Messages (${count})`
                            : status === 'approved' ? '💬 Message us' : 'Request Changes'
                          return (
                            <button onClick={() => setChatOpen(idx)}
                              style={{ flex: status === 'approved' ? '1 1 160px' : '0 1 160px', fontSize: 14, fontWeight: 600, padding: '13px', background: '#fff', color: count > 0 ? 'var(--charcoal)' : status === 'approved' ? 'var(--charcoal-60)' : '#C62828', border: `1px solid ${count > 0 ? 'var(--charcoal-border)' : status === 'approved' ? 'var(--charcoal-border)' : '#f6caca'}`, cursor: 'pointer', fontFamily: 'var(--font-body)' }}>
                              {label}
                            </button>
                          )
                        })()}
                      </div>
                      {err[idx] && (
                        <p style={{ margin: '10px 0 0', fontSize: 13, fontWeight: 600, color: '#C62828', background: '#fff0f0', border: '1px solid #f6caca', padding: '9px 11px' }}>
                          {err[idx]}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* Chat drawer — right-side panel on desktop, full-screen on mobile */}
      {chatOpen !== null && data.items[chatOpen] && (() => {
        const idx = chatOpen
        const it = data.items[idx]
        const thread = itemThread(it)
        const proofs = itemProofs(it)
        const busy = actioning === idx
        const e = err[idx]
        const draft = noteDraft[idx] ?? ''
        return (
          <>
            <div className="chat-backdrop" onClick={() => setChatOpen(null)} />
            <aside className="chat-drawer" role="dialog" aria-label={`Conversation about ${it.name}`}>
              <div className="chat-head">
                <div style={{ minWidth: 0 }}>
                  <div className="chat-head-title">{it.quantity}× {it.name}</div>
                  <div className="chat-head-sub">Chat with {data.shopName}</div>
                </div>
                <button className="chat-close" onClick={() => setChatOpen(null)} aria-label="Close conversation">✕</button>
              </div>

              <div className="chat-body" ref={chatBodyRef}>
                {thread.length === 0 ? (
                  <div className="chat-empty">No messages yet.<br />Type below to ask for a tweak or change — we&apos;ll reply right here.</div>
                ) : thread.map((m, mi) => {
                  const mine = m.from === 'client'
                  return (
                    <div key={mi} className={`chat-row ${mine ? 'me' : 'them'}`}>
                      <div className="chat-bubble">{m.text}</div>
                      <div className="chat-meta">{mine ? 'Client reply' : `${data.shopName} team reply`}{m.at ? ` · ${fmtWhen(m.at)}` : ''}</div>
                    </div>
                  )
                })}
              </div>

              <div className="chat-foot">
                {e && <div className="chat-err">{e}</div>}
                <div className="chat-compose">
                  <textarea
                    rows={1}
                    value={draft}
                    onChange={ev => setNoteDraft(prev => ({ ...prev, [idx]: ev.target.value }))}
                    onKeyDown={ev => { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); if (draft.trim() && !busy) submit(idx, 'request_changes', proofs) } }}
                    placeholder="Message…"
                    className="chat-input"
                  />
                  <button className="chat-send" onClick={() => submit(idx, 'request_changes', proofs)} disabled={busy || !draft.trim()}>
                    {busy ? '…' : 'Send'}
                  </button>
                </div>
                <div className="chat-hint">Sending a message requests changes on this design.</div>
              </div>
            </aside>
          </>
        )
      })()}
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', fontFamily: 'var(--font-body)' }}>
      <header style={{ background: 'var(--charcoal)', height: 56, padding: '0 20px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: '2px solid var(--coral)' }}>
        <img src="/logo-ddfpixel.png" alt="DDF x Pixel" style={{ height: 30, width: 'auto', filter: 'brightness(0) invert(1)' }} />
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
