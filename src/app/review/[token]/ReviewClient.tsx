'use client'

import { useEffect, useState } from 'react'
import { Check, MessageSquare } from 'lucide-react'
import { itemProofs, itemExamplePhotos, itemThread, designsMode } from '@/lib/job-types'
import type { JobItem, ApprovalStatus } from '@/lib/job-types'
import { Page, SiteHead, SiteFoot } from '@/components/cx/kit'
import { ApprovalPill } from '@/components/cx/pills'
import { ProofStage } from '@/components/cx/ProofStage'
import { wantsFloorPreview } from '@/lib/floor-preview'
import { daysUntil, countdownLabel, prettyDate } from '@/lib/countdown'

interface ReviewData {
  reference_number: string
  event_name: string | null
  date_required: string
  items: JobItem[]
  proofUrls: Record<string, string>
  fileUrls?: Record<string, string>   // signed originals for PDF/AI/EPS proofs (thumbnail is a preview/tile)
  clientName: string
  shopName: string
  jobType?: string
}

function fmtWhen(at: string): string {
  if (!at) return ''
  const d = new Date(at)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-CA', { day: 'numeric', month: 'short' }) + ', ' +
    d.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' })
}

export default function ReviewClient({ token }: { token: string }) {
  const [data, setData] = useState<ReviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [invalid, setInvalid] = useState(false)
  const [legacy, setLegacy] = useState('')
  const [actioning, setActioning] = useState<number | null>(null)
  const [actioningAll, setActioningAll] = useState(false)
  const [allMsg, setAllMsg] = useState('')
  const [noteDraft, setNoteDraft] = useState<Record<number, string>>({})
  const [selected, setSelected] = useState<Record<number, string>>({}) // item index → chosen proof path
  const [err, setErr] = useState<Record<number, string>>({})
  const [active, setActive] = useState<number | null>(null)            // item index on the stage
  const [viewing, setViewing] = useState<Record<number, string>>({})    // item index → proof shown on the stage
  const [view, setView] = useState<'floor' | 'flat'>('floor')
  const [asking, setAsking] = useState<number | null>(null)             // item index with the change box open
  const [toast, setToast] = useState('')
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 2600); return () => clearTimeout(t) }, [toast])

  useEffect(() => {
    fetch(`/api/review/${token}`)
      .then(async res => {
        if (!res.ok) {
          const j = await res.json().catch(() => null)
          if (j?.legacy) setLegacy(j.legacy)
          setInvalid(true)
          return
        }
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
      if (action === 'approve') {
        setToast(`${data?.items[idx]?.name ?? 'Design'} approved`)
        const next = (items as JobItem[]).findIndex((x, j) => j !== idx && itemProofs(x).length > 0 && x.approval_status !== 'approved')
        if (next >= 0) setTimeout(() => setActive(next), 700)
      } else {
        setAsking(null)
        setToast('Sent. We’ll send a revised proof.')
      }
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

  const brand = { businessName: data?.shopName ?? 'DDF x Pixel', logoUrl: '/logo-ddfpixel.png', replyToEmail: null }

  if (loading) {
    return <Page><SiteHead brand={brand} /><p className="muted" style={{ padding: '80px 0', textAlign: 'center' }}>Loading your proofs…</p></Page>
  }
  if (invalid || !data) {
    return (
      <Page>
        <SiteHead brand={brand} />
        <section className="panel" style={{ padding: 32, maxWidth: 480, margin: '60px auto', display: 'grid', gap: 10 }}>
          <h1 className="display" style={{ margin: 0, fontSize: 34 }}>Link not <span className="serif">valid.</span></h1>
          <p className="muted" style={{ margin: 0 }}>{legacy || 'This approval link is invalid or has expired. Ask us for a fresh one, or open your job page.'}</p>
          <a className="btn btn-ink" href="/portal" style={{ justifySelf: 'start' }}>Open my job page</a>
        </section>
      </Page>
    )
  }

  const reviewable = data.items.map((it, idx) => ({ it, idx })).filter(x => itemProofs(x.it).length > 0)
  const approvedCount = reviewable.filter(x => x.it.approval_status === 'approved').length
  const allDone = reviewable.length > 0 && approvedCount === reviewable.length
  const days = daysUntil(data.date_required)
  const isProduct = data.jobType === 'product'
  const cur = reviewable.find(x => x.idx === active) ?? reviewable.find(x => x.it.approval_status !== 'approved') ?? reviewable[0]

  return (
    <Page>
      <SiteHead brand={brand} right={<span className="muted hide-sm">{data.event_name || data.reference_number}</span>} />

      <section style={{ padding: '34px 0 18px', display: 'grid', gap: 8 }}>
        <span className="eyebrow">Design approval</span>
        <h1 className="display" style={{ margin: 0, fontSize: 'clamp(34px, 5vw, 56px)' }}>
          {allDone ? <>Everything is <span className="serif">approved.</span></> : <>Your designs are <span className="serif">ready.</span></>}
        </h1>
        <p className="muted" style={{ margin: 0 }}>
          {data.reference_number} · {isProduct ? 'Needed by' : 'Event'} {prettyDate(data.date_required)} · {countdownLabel(days)}
        </p>
      </section>

      {reviewable.length === 0 || !cur ? (
        <div className="panel" style={{ padding: 28 }}>Your proofs aren’t ready yet. We’ll email you as soon as they are.</div>
      ) : (
        <>
          <div className="tabs glass" role="tablist" aria-label="Pieces">
            {reviewable.map(({ it, idx }) => (
              <button key={idx} type="button" role="tab" id={`tab-${idx}`} aria-controls="piece-panel" className="tab" aria-selected={idx === cur.idx} onClick={() => { setActive(idx); setAsking(null) }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: it.approval_status === 'approved' ? '#7fa487' : it.approval_status === 'changes_requested' ? 'var(--rose)' : 'var(--mauve)' }} />
                {it.name}
              </button>
            ))}
          </div>

          {allDone && (
            <div className="callout stack-sm" style={{ marginTop: 22, background: 'var(--sage-wash)' }}>
              {/* Plan B: deposit callout (pay / paid) goes here */}
              <div><b>Everything is approved — thank you.</b><div className="small muted">We’ll get these into production.</div></div>
            </div>
          )}

          {allDone && allMsg && <p className="err" role="alert" style={{ marginTop: 10 }}>{allMsg}</p>}

          {reviewable.length > 1 && !allDone && (
            <div className="callout stack-sm" style={{ marginTop: 22 }}>
              <div><b>Happy with everything?</b><div className="small muted">{approvedCount} of {reviewable.length} approved. Approve the rest in one go.</div>{allMsg && <div className="small" style={{ color: 'var(--rose)', marginTop: 4 }}>{allMsg}</div>}</div>
              <button type="button" className="btn btn-forest" onClick={submitAll} disabled={actioningAll}><Check size={15} /> {actioningAll ? 'Approving…' : 'Approve all'}</button>
            </div>
          )}

          {(() => {
            const { it, idx } = cur
            const status: ApprovalStatus = it.approval_status ?? 'pending'
            const proofs = itemProofs(it)
            const mode = designsMode(it)
            const latestMode = proofs.length > 1 && mode === 'latest'
            const shown = latestMode ? proofs.slice(0, 1) : proofs
            const multi = shown.length > 1
            const pickMode = multi && mode === 'pick'
            const isApproved = status === 'approved'
            const chosen = isApproved ? it.approved_proof_url : selected[idx]
            const onStage = [pickMode ? chosen : undefined, viewing[idx], shown[0]].find(p => p && shown.includes(p)) ?? shown[0]
            const floor = wantsFloorPreview(it)
            const busy = actioning === idx
            const needsPick = pickMode && !selected[idx]
            const thread = itemThread(it)
            const examples = itemExamplePhotos(it)
            return (
              <div className="split" role="tabpanel" id="piece-panel" aria-labelledby={`tab-${idx}`} style={{ marginTop: 26, gridTemplateColumns: 'minmax(0,1fr) 380px' }}>
                <div className="stack" style={{ gap: 14 }}>
                  <ProofStage
                    src={data.proofUrls[onStage]} href={data.fileUrls?.[onStage] ?? data.proofUrls[onStage]}
                    alt={`Design for ${it.name}`} floor={floor} view={view}
                    note={floor && view === 'floor' ? 'Preview on the floor · not to scale' : [it.size, it.material].filter(Boolean).join(' · ')}
                  />
                  <div className="between stack-sm">
                    {multi ? (
                      <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
                        <span className="label">{pickMode ? (isApproved ? 'Chosen design' : 'Pick one') : `${shown.length} designs · all printed`}</span>
                        <div className="optrail">
                          {shown.map((p, pi) => (
                            <button key={p} type="button" className="opt"
                              aria-pressed={p === onStage}
                              disabled={pickMode && isApproved && !!chosen && p !== chosen}
                              onClick={() => {
                                setViewing(v => ({ ...v, [idx]: p }))
                                if (pickMode && !isApproved) { setSelected(s => ({ ...s, [idx]: p })); setErr(e => ({ ...e, [idx]: '' })) }
                              }}>
                              {data.proofUrls[p] ? <img src={data.proofUrls[p]} alt="" /> : <span className="tiny muted">…</span>}
                              <span>{pickMode ? `Option ${String.fromCharCode(65 + pi)}` : `Design ${pi + 1}`}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : <span className="small muted">Tap the design to open it full size.</span>}
                    {floor && (
                      <div className="seg light">
                        <button type="button" aria-pressed={view === 'flat'} onClick={() => setView('flat')}>Flat artwork</button>
                        <button type="button" aria-pressed={view === 'floor'} onClick={() => setView('floor')}>On the floor</button>
                      </div>
                    )}
                  </div>
                  {data.fileUrls?.[onStage] && (
                    <a className="link tiny" href={data.fileUrls[onStage]} target="_blank" rel="noopener noreferrer">Open the {onStage.split('.').pop()?.toUpperCase()} file</a>
                  )}
                  {latestMode && (
                    <div className="stack" style={{ gap: 8 }}>
                      <span className="label">Earlier designs</span>
                      <div className="earlier">{proofs.slice(1).map((p, vi) => <a key={p} href={data.proofUrls[p]} target="_blank" rel="noopener noreferrer" title={`Earlier design ${vi + 1}`}>{data.proofUrls[p] && <img src={data.proofUrls[p]} alt="" />}</a>)}</div>
                    </div>
                  )}
                  {(it.proof_history?.length ?? 0) > 0 && (
                    <div className="stack" style={{ gap: 8 }}>
                      <span className="label">Earlier versions</span>
                      <div className="earlier">{it.proof_history!.map((p, vi) => <a key={p} href={data.proofUrls[p]} target="_blank" rel="noopener noreferrer" title={`Version ${vi + 1}`}>{data.proofUrls[p] && <img src={data.proofUrls[p]} alt="" />}</a>)}</div>
                    </div>
                  )}
                  {examples.length > 0 && (
                    <div className="panel" style={{ padding: 18, display: 'grid', gap: 10 }}>
                      <span className="label">Inspiration &amp; examples</span>
                      <p className="small muted" style={{ margin: 0 }}>For reference only. These are <b>not</b> your artwork and are <b>not</b> printed.</p>
                      <div className="earlier">{examples.map(p => <a key={p} href={data.proofUrls[p]} target="_blank" rel="noopener noreferrer">{data.proofUrls[p] && <img src={data.proofUrls[p]} alt="Example" />}</a>)}</div>
                    </div>
                  )}
                </div>

                <aside className="stack" style={{ gap: 18, alignContent: 'start' }}>
                  <div className="between"><b style={{ fontSize: 18 }}>{it.name}</b><ApprovalPill status={status} /></div>
                  <div className="small muted">{it.quantity} × {[it.size, it.material].filter(Boolean).join(' · ')}</div>
                  {it.description && <p className="small" style={{ margin: 0 }}><span className="muted">Your brief: </span>{it.description}</p>}
                  {it.admin_note && <div className="msg shop"><div className="tiny muted" style={{ marginBottom: 3 }}>A note from us</div>{it.admin_note}</div>}

                  {!isApproved && asking !== idx && (
                    <div className="stack" style={{ gap: 10 }}>
                      <button type="button" className="btn btn-forest btn-block" onClick={() => submit(idx, 'approve', proofs)} disabled={busy || needsPick}>
                        <Check size={15} /> {busy ? 'Saving…' : needsPick ? 'Choose a design first' : pickMode ? 'Approve this option' : 'Approve this design'}
                      </button>
                      <button type="button" className="btn btn-quiet btn-block" onClick={() => setAsking(idx)}>Request changes</button>
                    </div>
                  )}
                  {(asking === idx) && (
                    <div className="stack" style={{ gap: 10 }}>
                      <label className="label" htmlFor={`chg-${idx}`}>{isApproved ? 'Message us' : 'What should we change?'}</label>
                      <textarea id={`chg-${idx}`} className="input" autoFocus value={noteDraft[idx] ?? ''}
                        onChange={e => setNoteDraft(prev => ({ ...prev, [idx]: e.target.value }))}
                        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if ((noteDraft[idx] ?? '').trim() && !busy) submit(idx, 'request_changes', proofs) } }}
                        placeholder="e.g. Make the date larger and use our full names." />
                      <div className="row">
                        <button type="button" className="btn btn-ink btn-sm" disabled={busy || !(noteDraft[idx] ?? '').trim()} onClick={() => submit(idx, 'request_changes', proofs)}>{busy ? 'Sending…' : 'Send to designer'}</button>
                        <button type="button" className="link tiny" onClick={() => setAsking(null)}>Cancel</button>
                      </div>
                      <span className="tiny muted">Sending a message asks for changes on this design.</span>
                    </div>
                  )}
                  {isApproved && asking !== idx && (
                    <p className="small muted" style={{ margin: 0 }}>Approved. Changed your mind? <button type="button" className="link" onClick={() => setAsking(idx)}>Message us</button> and we’ll reopen it.</p>
                  )}
                  {err[idx] && <p className="err" role="alert">{err[idx]}</p>}

                  <hr className="rule" />
                  <div className="row label" style={{ gap: 8 }}><MessageSquare size={13} /> Conversation</div>
                  {thread.length === 0 ? (
                    <p className="small muted" style={{ margin: 0 }}>No messages yet.</p>
                  ) : (
                    <div className="stack" style={{ gap: 8 }}>
                      {thread.map((m, k) => (
                        <div key={k} className={`msg ${m.from}`}>
                          <div className="tiny muted" style={{ marginBottom: 3 }}>{m.from === 'shop' ? `${data.shopName} team` : 'You'}{m.at ? ` · ${fmtWhen(m.at)}` : ''}</div>
                          {m.text}
                        </div>
                      ))}
                    </div>
                  )}
                </aside>
              </div>
            )
          })()}
        </>
      )}

      <p className="small muted" style={{ marginTop: 40 }}>
        Need to add pieces or change your brief? <a className="link" href="/portal">Open your job page</a> with your reference and email.
      </p>
      <SiteFoot brand={brand} />
      {toast && <div className="toast" role="status">{toast}</div>}
    </Page>
  )
}
