'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { useRouter } from 'next/navigation'
import { STATUS_CONFIG, APPROVAL_CONFIG, itemProofs } from '@/lib/job-types'
import type { JobItem, ApprovalStatus } from '@/lib/job-types'

interface Job {
  id: number
  reference_number: string
  event_name: string | null
  date_required: string
  notes: string | null
  status: string
  submitted_at: string
  items: JobItem[]
  file_paths: string[]
}

interface EditForm {
  date_required: string
  event_name: string
  notes: string
  items: JobItem[]
  file_paths: string[]
}

function StatusPill({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending
  return (
    <span style={{
      background: cfg.bg,
      color: cfg.color,
      fontSize: '11px',
      fontWeight: 700,
      letterSpacing: '0.8px',
      textTransform: 'uppercase',
      padding: '3px 10px',
      border: `1px solid ${cfg.color}22`,
    }}>
      {cfg.label}
    </span>
  )
}

function ApprovalPill({ status }: { status: ApprovalStatus }) {
  const cfg = APPROVAL_CONFIG[status]
  return (
    <span style={{
      background: cfg.bg, color: cfg.color, fontSize: '10px', fontWeight: 700,
      letterSpacing: '0.6px', textTransform: 'uppercase', padding: '2px 8px',
      border: `1px solid ${cfg.color}33`, whiteSpace: 'nowrap',
    }}>
      {cfg.label}
    </span>
  )
}

export default function PortalPage() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [editingJob, setEditingJob] = useState<number | null>(null)
  const [editForm, setEditForm] = useState<EditForm | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)
  const [editError, setEditError] = useState('')
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [uploadPhotoError, setUploadPhotoError] = useState('')
  // Design-approval state
  const [proofUrls, setProofUrls] = useState<Record<number, Record<string, string>>>({})
  const [actioning, setActioning] = useState<string | null>(null)   // `${jobId}:${idx}`
  const [noteOpen, setNoteOpen] = useState<Record<string, boolean>>({})
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({})
  const [approvalError, setApprovalError] = useState<Record<string, string>>({})
  const router = useRouter()

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { router.push('/login'); return }
      setEmail(user.email ?? '')
      supabase
        .from('jobs')
        .select('id, reference_number, event_name, date_required, notes, status, submitted_at, items, file_paths')
        .eq('contact_email', user.email)
        .order('submitted_at', { ascending: false })
        .then(({ data }) => {
          const list = (data ?? []) as Job[]
          setJobs(list)
          setLoading(false)
          // Lazily sign proof URLs for any job that has design proofs attached.
          list
            .filter(j => j.items?.some(i => itemProofs(i).length > 0))
            .forEach(j => loadProofs(j.id))
        })
    })
  }, [router])

  async function loadProofs(jobId: number) {
    try {
      const res = await fetch('/api/portal/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      })
      if (!res.ok) return
      const { urls } = await res.json()
      setProofUrls(prev => ({ ...prev, [jobId]: urls ?? {} }))
    } catch {
      /* proofs are best-effort; the rest of the portal still works */
    }
  }

  async function submitApproval(jobId: number, idx: number, action: 'approve' | 'request_changes') {
    const key = `${jobId}:${idx}`
    if (action === 'request_changes' && !(noteDraft[key]?.trim())) {
      setApprovalError(prev => ({ ...prev, [key]: 'Please describe the change you need.' }))
      return
    }
    setActioning(key)
    setApprovalError(prev => ({ ...prev, [key]: '' }))
    try {
      const res = await fetch(`/api/portal/jobs/${jobId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemIndex: idx, action, note: noteDraft[key] }),
      })
      if (!res.ok) {
        setApprovalError(prev => ({ ...prev, [key]: 'Could not save — please try again.' }))
        return
      }
      const { items } = await res.json()
      setJobs(prev => prev.map(j => j.id === jobId ? { ...j, items } : j))
      setNoteOpen(prev => ({ ...prev, [key]: false }))
      setNoteDraft(prev => ({ ...prev, [key]: '' }))
    } catch {
      setApprovalError(prev => ({ ...prev, [key]: 'Network error — not saved.' }))
    } finally {
      setActioning(null)
    }
  }

  function startEdit(job: Job) {
    setEditingJob(job.id)
    setEditError('')
    setEditForm({
      date_required: job.date_required,
      event_name: job.event_name ?? '',
      notes: job.notes ?? '',
      items: job.items.map(i => ({ ...i })),
      file_paths: [...(job.file_paths ?? [])],
    })
  }

  function cancelEdit() {
    setEditingJob(null)
    setEditForm(null)
    setEditError('')
  }

  async function saveEdit(jobId: number) {
    if (!editForm) return
    setSavingEdit(true)
    setEditError('')
    try {
      const res = await fetch(`/api/portal/jobs/${jobId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date_required: editForm.date_required,
          event_name: editForm.event_name || null,
          notes: editForm.notes || null,
          items: editForm.items,
          file_paths: editForm.file_paths,
        }),
      })
      if (res.status === 409) {
        setEditError('This job is already in progress and cannot be edited.')
        return
      }
      if (!res.ok) {
        setEditError('Failed to save changes — please try again.')
        return
      }
      setJobs(prev => prev.map(j => j.id === jobId ? {
        ...j,
        date_required: editForm.date_required,
        event_name: editForm.event_name || null,
        notes: editForm.notes || null,
        items: editForm.items,
        file_paths: editForm.file_paths,
      } : j))
      cancelEdit()
    } catch {
      setEditError('Network error — changes not saved.')
    } finally {
      setSavingEdit(false)
    }
  }

  function updateEditItem(index: number, field: keyof JobItem, value: string | number) {
    setEditForm(prev => {
      if (!prev) return prev
      const items = [...prev.items]
      items[index] = { ...items[index], [field]: value }
      return { ...prev, items }
    })
  }

  async function addPhoto(file: File) {
    if (!editForm) return
    setUploadPhotoError('')
    setUploadingPhoto(true)
    try {
      const urlRes = await fetch('/api/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: [{ name: file.name, type: file.type, size: file.size }] }),
      })
      if (!urlRes.ok) {
        const { error } = await urlRes.json()
        setUploadPhotoError(error ?? 'Could not get upload URL')
        return
      }
      const { uploads } = await urlRes.json()
      const { path, signedUrl } = uploads[0]
      const putRes = await fetch(signedUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file })
      if (!putRes.ok) { setUploadPhotoError('Upload failed — please try again.'); return }
      setEditForm(prev => prev ? { ...prev, file_paths: [...prev.file_paths, path] } : prev)
    } catch {
      setUploadPhotoError('Network error during upload.')
    } finally {
      setUploadingPhoto(false)
    }
  }

  async function signOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  const active = jobs.filter(j => j.status === 'in_progress' || j.status === 'received').length
  const completed = jobs.filter(j => j.status === 'completed').length

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', fontFamily: 'var(--font-body)' }}>

      {/* Header */}
      <header style={{
        background: 'var(--charcoal)',
        height: '60px',
        padding: '0 32px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'sticky',
        top: 0,
        zIndex: 50,
        borderBottom: '2px solid var(--coral)',
      }}>
        <img src="/logo-pixel.png" alt="Pixel Production" style={{ height: '30px', width: 'auto', filter: 'brightness(0) invert(1)' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <span style={{ fontSize: '12px', color: '#888', display: 'none' }} className="email-label">{email}</span>
          <button
            onClick={signOut}
            style={{ background: 'none', border: '1px solid #3a3a3a', color: '#888', padding: '6px 16px', fontSize: '12px', cursor: 'pointer', fontFamily: 'var(--font-body)', letterSpacing: '0.5px' }}
          >
            Sign out
          </button>
        </div>
      </header>

      {/* Page title bar */}
      <div style={{ background: 'var(--bg)', padding: '28px 40px 0', borderBottom: '1px solid var(--charcoal-border)' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', paddingBottom: '20px', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--coral)', marginBottom: '6px' }}>Client Portal</div>
              <h1 style={{ fontFamily: 'var(--font-heading)', fontSize: 'clamp(24px, 3vw, 36px)', fontWeight: 700, textTransform: 'uppercase', margin: 0, letterSpacing: '0.5px' }}>Your Jobs</h1>
              {email && <p style={{ margin: '4px 0 0', color: 'var(--charcoal-60)', fontSize: '13px' }}>{email}</p>}
            </div>
            <a
              href="/"
              style={{ background: 'var(--coral)', color: '#fff', padding: '11px 24px', textDecoration: 'none', fontWeight: 700, fontSize: '12px', letterSpacing: '1px', textTransform: 'uppercase', fontFamily: 'var(--font-body)', whiteSpace: 'nowrap', flexShrink: 0 }}
            >
              + Submit New Brief
            </a>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 40px 64px' }}>

        {loading ? (
          <div style={{ padding: '64px 0', textAlign: 'center' }}>
            <div style={{ width: 40, height: 40, border: '3px solid var(--charcoal-border)', borderTopColor: 'var(--coral)', borderRadius: '50%', margin: '0 auto 16px', animation: 'spin 0.8s linear infinite' }} />
            <p style={{ color: 'var(--charcoal-60)', fontSize: '14px', margin: 0 }}>Loading your jobs…</p>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        ) : jobs.length === 0 ? (
          /* Empty state */
          <div style={{ background: '#fff', border: '1px solid var(--charcoal-border)', padding: '64px 40px', textAlign: 'center' }}>
            <div style={{ width: 48, height: 48, background: 'var(--charcoal-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
              <svg viewBox="0 0 24 24" width="22" fill="none" stroke="var(--charcoal-60)" strokeWidth="1.5"><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
            </div>
            <h2 style={{ fontFamily: 'var(--font-heading)', fontSize: '20px', fontWeight: 700, textTransform: 'uppercase', margin: '0 0 8px', letterSpacing: '0.5px' }}>No jobs yet</h2>
            <p style={{ color: 'var(--charcoal-60)', fontSize: '14px', margin: '0 0 24px', maxWidth: 320, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.6 }}>
              Submit your first job brief and we&apos;ll have it quoted within 24 hours.
            </p>
            <a href="/" style={{ display: 'inline-block', background: 'var(--coral)', color: '#fff', padding: '12px 28px', textDecoration: 'none', fontWeight: 700, fontSize: '12px', letterSpacing: '1px', textTransform: 'uppercase' }}>
              Submit a Brief →
            </a>
          </div>
        ) : (
          <>
            {/* Summary row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '24px' }}>
              {[
                ['Total Jobs', jobs.length],
                ['Active', active],
                ['Completed', completed],
              ].map(([label, val]) => (
                <div key={label as string} style={{ background: '#fff', border: '1px solid var(--charcoal-border)', padding: '16px 20px' }}>
                  <div style={{ fontSize: '22px', fontFamily: 'var(--font-heading)', fontWeight: 700, color: 'var(--charcoal)' }}>{val}</div>
                  <div style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--charcoal-60)', marginTop: '2px' }}>{label}</div>
                </div>
              ))}
            </div>

            {/* Job list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {jobs.map(job => {
                const canEdit = job.status === 'pending' || job.status === 'received'
                const proofItems = job.items
                  .map((it, idx) => ({ it, idx }))
                  .filter(x => itemProofs(x.it).length > 0)
                const approvedCount = proofItems.filter(x => x.it.approval_status === 'approved').length
                return (
                <div key={job.id} style={{ background: '#fff', border: '1px solid var(--charcoal-border)', borderLeft: `3px solid ${STATUS_CONFIG[job.status]?.color ?? '#888'}` }}>
                  <div style={{ padding: '20px 24px' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px', flexWrap: 'wrap' }}>
                          <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: '15px', color: 'var(--coral)', letterSpacing: '0.5px' }}>{job.reference_number}</span>
                          <StatusPill status={job.status} />
                        </div>
                        {job.event_name && (
                          <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: '15px', color: 'var(--charcoal)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{job.event_name}</p>
                        )}
                        <p style={{ margin: 0, fontSize: '13px', color: 'var(--charcoal-60)' }}>
                          {job.items.length} item{job.items.length !== 1 ? 's' : ''}&nbsp;&nbsp;·&nbsp;&nbsp;Due&nbsp;
                          {new Date(job.date_required + 'T00:00:00').toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </p>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexShrink: 0 }}>
                        <span style={{ fontSize: '12px', color: 'var(--charcoal-60)', whiteSpace: 'nowrap', marginTop: '2px' }}>
                          {new Date(job.submitted_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </span>
                        {canEdit && (
                          <button
                            onClick={() => editingJob === job.id ? cancelEdit() : startEdit(job)}
                            style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.5px', padding: '4px 12px', background: editingJob === job.id ? '#fff8f6' : '#f8f7f5', color: editingJob === job.id ? 'var(--coral)' : '#666', border: `1px solid ${editingJob === job.id ? 'var(--coral)44' : 'var(--charcoal-border)'}`, cursor: 'pointer', fontFamily: 'var(--font-body)', whiteSpace: 'nowrap' }}
                          >
                            {editingJob === job.id ? 'Cancel' : 'Edit Brief'}
                          </button>
                        )}
                      </div>
                    </div>
                    <div style={{ marginTop: '14px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {job.items.map((item, i) => (
                        <span key={i} style={{ background: 'var(--bg)', border: '1px solid var(--charcoal-border)', padding: '3px 10px', fontSize: '12px', color: 'var(--charcoal-60)' }}>
                          {item.quantity}× {item.name} · {item.size}
                        </span>
                      ))}
                    </div>
                    {job.notes && (
                      <p style={{ margin: '10px 0 0', fontSize: '12px', color: 'var(--charcoal-60)', borderTop: '1px solid var(--charcoal-border)', paddingTop: 10, lineHeight: 1.5 }}>
                        <strong style={{ color: '#aaa', textTransform: 'uppercase', fontSize: 10, letterSpacing: '1px' }}>Notes: </strong>{job.notes}
                      </p>
                    )}

                    {/* ── Design proofs / approvals ─────────────────────────── */}
                    {proofItems.length > 0 && (
                      <div style={{ marginTop: 16, borderTop: '1px solid var(--charcoal-border)', paddingTop: 16 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--coral)' }}>Design Proofs</span>
                          <span style={{ fontSize: 12, fontWeight: 600, color: approvedCount === proofItems.length ? '#1B7F4F' : 'var(--charcoal-60)' }}>
                            {approvedCount} of {proofItems.length} approved
                          </span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                          {proofItems.map(({ it, idx }) => {
                            const key = `${job.id}:${idx}`
                            const proofs = itemProofs(it)
                            const status: ApprovalStatus = it.approval_status ?? 'pending'
                            const busy = actioning === key
                            const err = approvalError[key]
                            return (
                              <div key={idx} style={{ border: '1px solid var(--charcoal-border)', background: '#fff', display: 'flex', flexWrap: 'wrap', gap: 12, padding: 12, alignItems: 'flex-start' }}>
                                {/* Thumbnails (one or more proofs) */}
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, flexShrink: 0 }}>
                                  {proofs.map(p => {
                                    const u = proofUrls[job.id]?.[p]
                                    return (
                                      <a key={p} href={u ?? undefined} target="_blank" rel="noopener noreferrer"
                                         style={{ display: 'block', width: 84, height: 84, background: '#f4f3f1', border: '1px solid var(--charcoal-border)', overflow: 'hidden' }}>
                                        {u
                                          ? <img src={u} alt={`Proof for ${it.name}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                          : <span style={{ fontSize: 10, color: '#aaa', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>Loading…</span>}
                                      </a>
                                    )
                                  })}
                                </div>
                                {/* Body */}
                                <div style={{ flex: 1, minWidth: 200 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                                    <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--charcoal)' }}>{it.quantity}× {it.name}</span>
                                    <ApprovalPill status={status} />
                                  </div>
                                  {it.size && <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--charcoal-60)' }}>{it.size}</p>}
                                  {status === 'changes_requested' && it.client_note && (
                                    <p style={{ margin: '0 0 8px', fontSize: 12, color: '#C62828', background: '#fff0f0', border: '1px solid #f6caca', padding: '6px 9px' }}>
                                      You requested: “{it.client_note}”
                                    </p>
                                  )}

                                  {/* Note box (request changes) */}
                                  {noteOpen[key] ? (
                                    <div>
                                      <textarea
                                        rows={2}
                                        value={noteDraft[key] ?? ''}
                                        onChange={e => setNoteDraft(prev => ({ ...prev, [key]: e.target.value }))}
                                        placeholder="What needs to change?"
                                        style={{ width: '100%', padding: '8px 9px', border: '1px solid #ddd', fontSize: 13, fontFamily: 'var(--font-body)', resize: 'vertical', boxSizing: 'border-box' }}
                                      />
                                      {err && <p style={{ margin: '4px 0 0', fontSize: 11, color: '#dc2626' }}>{err}</p>}
                                      <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                                        <button onClick={() => submitApproval(job.id, idx, 'request_changes')} disabled={busy}
                                          style={{ fontSize: 12, fontWeight: 700, padding: '8px 16px', background: '#C62828', color: '#fff', border: 'none', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1, fontFamily: 'var(--font-body)' }}>
                                          {busy ? 'Sending…' : 'Send Request'}
                                        </button>
                                        <button onClick={() => { setNoteOpen(prev => ({ ...prev, [key]: false })); setApprovalError(prev => ({ ...prev, [key]: '' })) }} disabled={busy}
                                          style={{ fontSize: 12, padding: '8px 16px', background: '#fff', border: '1px solid #ddd', cursor: 'pointer', fontFamily: 'var(--font-body)' }}>
                                          Cancel
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                      {status !== 'approved' && (
                                        <button onClick={() => submitApproval(job.id, idx, 'approve')} disabled={busy}
                                          style={{ fontSize: 12, fontWeight: 700, padding: '8px 18px', background: '#1B7F4F', color: '#fff', border: 'none', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1, fontFamily: 'var(--font-body)', letterSpacing: '0.5px' }}>
                                          {busy ? 'Saving…' : '✓ Approve'}
                                        </button>
                                      )}
                                      <button onClick={() => { setNoteOpen(prev => ({ ...prev, [key]: true })); setNoteDraft(prev => ({ ...prev, [key]: prev[key] ?? '' })) }} disabled={busy}
                                        style={{ fontSize: 12, fontWeight: 600, padding: '8px 18px', background: '#fff', color: status === 'approved' ? 'var(--charcoal-60)' : '#C62828', border: `1px solid ${status === 'approved' ? 'var(--charcoal-border)' : '#f6caca'}`, cursor: 'pointer', fontFamily: 'var(--font-body)' }}>
                                        {status === 'approved' ? 'Request changes instead' : 'Request Changes'}
                                      </button>
                                    </div>
                                  )}
                                  {err && !noteOpen[key] && <p style={{ margin: '6px 0 0', fontSize: 11, color: '#dc2626' }}>{err}</p>}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Edit panel */}
                  {editingJob === job.id && editForm && (
                    <div style={{ padding: '18px 24px', borderTop: '2px solid var(--coral)', background: '#fffdf9' }}>
                      <p style={{ margin: '0 0 14px', fontSize: 10, fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--coral)' }}>Edit Brief</p>
                      {editError && (
                        <div style={{ background: '#fff0f0', border: '1px solid #fca5a5', color: '#b91c1c', fontSize: 12, padding: '8px 12px', marginBottom: 12 }}>{editError}</div>
                      )}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, fontWeight: 600, color: '#555', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
                          Due Date
                          <input type="date" value={editForm.date_required}
                            onChange={e => setEditForm(prev => prev ? { ...prev, date_required: e.target.value } : prev)}
                            style={{ padding: '7px 9px', border: '1px solid #ddd', fontSize: 12, fontFamily: 'var(--font-body)' }} />
                        </label>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, fontWeight: 600, color: '#555', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
                          Event / Location
                          <input type="text" value={editForm.event_name}
                            onChange={e => setEditForm(prev => prev ? { ...prev, event_name: e.target.value } : prev)}
                            placeholder="Optional"
                            style={{ padding: '7px 9px', border: '1px solid #ddd', fontSize: 12, fontFamily: 'var(--font-body)' }} />
                        </label>
                      </div>
                      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, fontWeight: 600, color: '#555', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 14 }}>
                        Notes / Special Instructions
                        <textarea value={editForm.notes} rows={3}
                          onChange={e => setEditForm(prev => prev ? { ...prev, notes: e.target.value } : prev)}
                          placeholder="Optional"
                          style={{ padding: '8px 9px', border: '1px solid #ddd', fontSize: 12, fontFamily: 'var(--font-body)', resize: 'vertical' }} />
                      </label>
                      <div style={{ marginBottom: 14 }}>
                        <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 600, color: '#555', textTransform: 'uppercase', letterSpacing: '0.8px' }}>Reference Photos</p>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                          {editForm.file_paths.map(path => {
                            const name = path.split('/').pop() ?? path
                            return (
                              <div key={path} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--bg)', border: '1px solid var(--charcoal-border)', padding: '5px 8px' }}>
                                <span style={{ fontSize: 12, color: 'var(--charcoal)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                                <button
                                  onClick={() => setEditForm(prev => prev ? { ...prev, file_paths: prev.file_paths.filter(p => p !== path) } : prev)}
                                  title="Remove photo"
                                  style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 14, fontWeight: 700, lineHeight: 1, padding: '0 2px', flexShrink: 0 }}
                                >×</button>
                              </div>
                            )
                          })}
                          {editForm.file_paths.length < 3 && (
                            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: uploadingPhoto ? 'var(--charcoal-60)' : 'var(--coral)', border: '1px dashed var(--coral)66', padding: '5px 12px', cursor: uploadingPhoto ? 'default' : 'pointer' }}>
                              <input
                                type="file"
                                accept="image/jpeg,image/png,image/svg+xml,application/pdf,.ai,.eps"
                                style={{ display: 'none' }}
                                disabled={uploadingPhoto}
                                onChange={e => { const f = e.target.files?.[0]; if (f) { e.target.value = ''; addPhoto(f) } }}
                              />
                              {uploadingPhoto ? 'Uploading…' : '+ Add Photo'}
                            </label>
                          )}
                        </div>
                        {uploadPhotoError && <p style={{ margin: '0 0 4px', fontSize: 11, color: '#dc2626' }}>{uploadPhotoError}</p>}
                        {editForm.file_paths.length > 0 && <p style={{ margin: 0, fontSize: 11, color: 'var(--charcoal-60)' }}>Removing a photo cannot be undone after saving.</p>}
                      </div>

                      <div style={{ marginBottom: 14 }}>
                        <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 600, color: '#555', textTransform: 'uppercase', letterSpacing: '0.8px' }}>Items</p>
                        {editForm.items.map((item, idx) => (
                          <div key={idx} style={{ display: 'grid', gridTemplateColumns: '48px 1fr 110px 130px 30px', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                            <input type="number" min={1} value={item.quantity}
                              onChange={e => updateEditItem(idx, 'quantity', parseInt(e.target.value) || 1)}
                              style={{ padding: '6px 4px', border: '1px solid #ddd', fontSize: 12, fontFamily: 'var(--font-body)', textAlign: 'center' }} />
                            <input type="text" value={item.name}
                              onChange={e => updateEditItem(idx, 'name', e.target.value)}
                              placeholder="Description"
                              style={{ padding: '6px 9px', border: '1px solid #ddd', fontSize: 12, fontFamily: 'var(--font-body)' }} />
                            <input type="text" value={item.size}
                              onChange={e => updateEditItem(idx, 'size', e.target.value)}
                              placeholder="Size"
                              style={{ padding: '6px 9px', border: '1px solid #ddd', fontSize: 12, fontFamily: 'var(--font-body)' }} />
                            <select value={item.material}
                              onChange={e => updateEditItem(idx, 'material', e.target.value)}
                              style={{ padding: '6px 6px', border: '1px solid #ddd', fontSize: 12, fontFamily: 'var(--font-body)' }}>
                              {['vinyl','fabric','foam-board','acrylic','other'].map(m => (
                                <option key={m} value={m}>{m}</option>
                              ))}
                            </select>
                            <button onClick={() => setEditForm(prev => prev ? { ...prev, items: prev.items.filter((_, i) => i !== idx) } : prev)}
                              disabled={editForm.items.length === 1}
                              style={{ background: 'none', border: '1px solid #fca5a5', color: '#dc2626', cursor: 'pointer', fontSize: 13, fontWeight: 700, padding: '3px 6px', opacity: editForm.items.length === 1 ? 0.3 : 1 }}>×</button>
                          </div>
                        ))}
                        {editForm.items.length < 10 && (
                          <button onClick={() => setEditForm(prev => prev ? { ...prev, items: [...prev.items, { name: '', quantity: 1, size: '', material: 'vinyl' }] } : prev)}
                            style={{ fontSize: 11, fontWeight: 600, color: 'var(--coral)', background: 'none', border: '1px dashed var(--coral)66', padding: '5px 14px', cursor: 'pointer', fontFamily: 'var(--font-body)', marginTop: 4 }}>
                            + Add Item
                          </button>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <button onClick={cancelEdit} style={{ fontSize: 12, padding: '7px 18px', border: '1px solid #ddd', background: '#fff', cursor: 'pointer', fontFamily: 'var(--font-body)' }}>Cancel</button>
                        <button onClick={() => saveEdit(job.id)} disabled={savingEdit}
                          style={{ fontSize: 12, fontWeight: 700, padding: '7px 20px', background: 'var(--coral)', color: '#fff', border: 'none', cursor: savingEdit ? 'default' : 'pointer', opacity: savingEdit ? 0.6 : 1, fontFamily: 'var(--font-body)', letterSpacing: '0.5px' }}>
                          {savingEdit ? 'Saving…' : 'Save Changes'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )})}
            </div>

            <p style={{ marginTop: '20px', fontSize: '12px', color: 'var(--charcoal-60)', textAlign: 'center' }}>
              Questions about a job? Email <a href="mailto:jobs@ddfpixel.com" style={{ color: 'var(--coral)', textDecoration: 'none', fontWeight: 600 }}>jobs@ddfpixel.com</a> with your reference number.
            </p>
          </>
        )}
      </div>

      {/* Footer */}
      <footer style={{ background: 'var(--charcoal)', padding: '20px 40px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '2px solid var(--coral)', flexWrap: 'wrap', gap: '8px' }}>
        <img src="/logo-pixel.png" alt="Pixel Production" style={{ height: '24px', filter: 'brightness(0) invert(1)' }} />
        <span style={{ fontSize: '12px', color: '#555', fontFamily: 'var(--font-body)' }}>© 2026 DDF Pixel Production</span>
        <a href="/" style={{ fontSize: '12px', color: '#666', textDecoration: 'none' }}>Submit a brief →</a>
      </footer>
    </div>
  )
}
