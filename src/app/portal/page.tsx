'use client'

import { useEffect, useState, FormEvent } from 'react'
import { Plus, Home, MessageCircle } from 'lucide-react'
import { itemProofs, itemExamplePhotos, designsMode, isImagePath, fileKindLabel } from '@/lib/job-types'
import { renderPrintFilePreview, uploadPreviewFile, needsPreview } from '@/lib/proof-preview'
import type { JobItem, ApprovalStatus } from '@/lib/job-types'
import { MAX_FILES, MAX_PIECES, MAX_FILE_MB } from '@/lib/limits'
import { MATERIALS } from '@/lib/schemas'
import { Page, SiteHead, SiteFoot, SecHead } from '@/components/cx/kit'
import { ApprovalPill, JobStatusPill } from '@/components/cx/pills'
import { daysUntil, countdownLabel, prettyDate } from '@/lib/countdown'

const BRAND = { businessName: 'DDF x Pixel', logoUrl: '/logo-ddfpixel.png', replyToEmail: 'hello@ddfevents.ca' }
const HANDOVER: Record<string, string> = { pickup: 'Pickup at our shop', delivery: 'Delivery', install: 'Install' }

// A removable file name chip (edit / add-to-job panels).
const FILE_CHIP = { display: 'flex', alignItems: 'center', gap: 6, background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 999, padding: '5px 10px', maxWidth: '100%', minWidth: 0 } as const
// Scroll to an element once React has rendered it (e.g. a panel that was just opened).
const scrollToId = (id: string) => setTimeout(() => requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })), 0)
const FILE_NAME = { maxWidth: 180, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const

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
  job_type?: 'event' | 'product'
  fulfillment?: 'pickup' | 'delivery' | 'install' | null
  setup_location?: string | null
  setup_time?: string | null
  removal_location?: string | null
  removal_time?: string | null
}

interface EditForm {
  date_required: string
  event_name: string
  notes: string
  items: JobItem[]
  file_paths: string[]
}

export default function PortalPage() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  // No-login lookup (reference # + email) — shown when there's no session/token.
  const [needsLookup, setNeedsLookup] = useState(false)
  const [lookupRef, setLookupRef] = useState('')
  const [lookupEmail, setLookupEmail] = useState('')
  const [lookupError, setLookupError] = useState('')
  const [lookingUp, setLookingUp] = useState(false)
  const [editingJob, setEditingJob] = useState<number | null>(null)
  const [editForm, setEditForm] = useState<EditForm | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)
  const [editError, setEditError] = useState('')
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [uploadPhotoError, setUploadPhotoError] = useState('')
  const [editItemUploading, setEditItemUploading] = useState<number | null>(null)
  // Design-approval state
  const [proofUrls, setProofUrls] = useState<Record<number, Record<string, string>>>({})
  const [actioning, setActioning] = useState<string | null>(null)   // `${jobId}:${idx}`
  const [noteOpen, setNoteOpen] = useState<Record<string, boolean>>({})
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({})
  const [approvalError, setApprovalError] = useState<Record<string, string>>({})
  // Client-supplied final artwork (upload → becomes the proof → approved in one step)
  const [finalBusy, setFinalBusy] = useState<string | null>(null)        // `${jobId}:${idx}`
  const [finalError, setFinalError] = useState<Record<string, string>>({})
  const [finalOpen, setFinalOpen] = useState<Record<number, boolean>>({}) // per job: panel expanded
  // Uploaded final files still waiting on a JPG/PNG preview (EPS etc.) before they're saved
  const [finalPending, setFinalPending] = useState<Record<string, { paths: string[]; previews: Record<string, string>; needs: { path: string; name: string }[] }>>({})
  const [proofFileUrls, setProofFileUrls] = useState<Record<number, Record<string, string>>>({}) // signed originals for PDF/AI/EPS proofs
  // Append-only "Add to Job" state (for jobs already in progress)
  const [addingJob, setAddingJob] = useState<number | null>(null)
  const [addItems, setAddItems] = useState<JobItem[]>([])
  const [addFiles, setAddFiles] = useState<string[]>([])
  const [savingAdd, setSavingAdd] = useState(false)
  const [addError, setAddError] = useState('')
  const [addUploading, setAddUploading] = useState(false)
  const [addItemUploading, setAddItemUploading] = useState<number | null>(null)

  function showJobs(list: Job[]) {
    setJobs(list)
    setLoading(false)
    // Lazily sign proof URLs for any job that has design proofs attached.
    list
      .filter(j => j.items?.some(i => itemProofs(i).length > 0))
      .forEach(j => loadProofs(j.id))
  }

  // Load the client's job from their no-login portal token (reference # + email
  // lookup). No token → show the lookup form.
  async function loadPortal() {
    setLoading(true)
    const res = await fetch('/api/portal/me')
    if (res.ok) {
      const { jobs: list, email } = await res.json()
      setEmail(email ?? '')
      setNeedsLookup(false)
      showJobs((list ?? []) as Job[])
    } else {
      setNeedsLookup(true)
      setLoading(false)
    }
  }

  async function handleLookup(e: FormEvent) {
    e.preventDefault()
    if (!lookupRef.trim() || !lookupEmail.trim()) {
      setLookupError('Enter both your reference number and email.')
      return
    }
    setLookingUp(true)
    setLookupError('')
    try {
      const res = await fetch('/api/portal/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference: lookupRef.trim(), email: lookupEmail.trim() }),
      })
      if (!res.ok) {
        const msg = await res.json().then(b => b?.error).catch(() => null)
        setLookupError(msg || 'We couldn’t find that job. Please check your details.')
        return
      }
      setLookupRef(''); setLookupEmail('')
      await loadPortal()
    } catch {
      setLookupError('Network error — please try again.')
    } finally {
      setLookingUp(false)
    }
  }

  useEffect(() => { loadPortal() }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  async function loadProofs(jobId: number) {
    try {
      const res = await fetch('/api/portal/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      })
      if (!res.ok) return
      const { urls, fileUrls } = await res.json()
      setProofUrls(prev => ({ ...prev, [jobId]: urls ?? {} }))
      setProofFileUrls(prev => ({ ...prev, [jobId]: fileUrls ?? {} }))
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

  // Client uploads their own print-ready file(s) for ONE item. The files become
  // the item's proof and it is approved for print in the same request, so the
  // shop doesn't have to re-upload them and send an approval link.
  async function uploadFinalDesign(jobId: number, idx: number, files: File[]) {
    const key = `${jobId}:${idx}`
    if (!files.length) return
    setFinalBusy(key)
    setFinalError(prev => ({ ...prev, [key]: '' }))
    try {
      const urlRes = await fetch('/api/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: files.map(f => ({ name: f.name, type: f.type, size: f.size })) }),
      })
      if (!urlRes.ok) {
        const { error } = await urlRes.json().catch(() => ({ error: null }))
        setFinalError(prev => ({ ...prev, [key]: error ?? 'Could not prepare the upload.' }))
        return
      }
      const { uploads } = await urlRes.json() as { uploads: { path: string; signedUrl: string }[] }
      const paths: string[] = []
      for (let i = 0; i < files.length; i++) {
        const put = await fetch(uploads[i].signedUrl, { method: 'PUT', headers: { 'Content-Type': files[i].type || 'application/octet-stream' }, body: files[i] })
        if (!put.ok) { setFinalError(prev => ({ ...prev, [key]: `Upload failed for ${files[i].name} — please try again.` })); return }
        paths.push(uploads[i].path)
      }
      // Every print file the browser can't display (PDF/AI/EPS) needs a
      // screenshot of the design from the client — that's what the team sees.
      // A PDF/AI page-1 render is kept as a silent fallback in case the
      // screenshot upload fails.
      const previews: Record<string, string> = {}
      const needs: { path: string; name: string }[] = []
      for (let i = 0; i < files.length; i++) {
        if (!needsPreview(files[i].name)) continue
        needs.push({ path: paths[i], name: files[i].name })
        const pv = await renderPrintFilePreview(files[i])
        const pvPath = pv ? await uploadPreviewFile(pv) : null
        if (pvPath) previews[paths[i]] = pvPath
      }
      if (needs.length > 0) {
        setFinalPending(prev => ({ ...prev, [key]: { paths, previews, needs } }))
        return
      }
      await finalizeFinalDesign(jobId, idx, paths, previews)
    } catch {
      setFinalError(prev => ({ ...prev, [key]: 'Network error — not saved.' }))
    } finally {
      setFinalBusy(null)
    }
  }

  // Client picked a JPG/PNG preview for one file we couldn't render.
  async function addManualFinalPreview(jobId: number, idx: number, proofPath: string, img: File | undefined) {
    const key = `${jobId}:${idx}`
    const pending = finalPending[key]
    if (!img || !pending) return
    if (!img.type.startsWith('image/')) { setFinalError(prev => ({ ...prev, [key]: 'The preview must be a JPG or PNG image.' })); return }
    setFinalBusy(key)
    setFinalError(prev => ({ ...prev, [key]: '' }))
    try {
      const pvPath = await uploadPreviewFile(img)
      if (!pvPath) { setFinalError(prev => ({ ...prev, [key]: 'Preview upload failed — please try again.' })); return }
      const next = { ...pending, previews: { ...pending.previews, [proofPath]: pvPath }, needs: pending.needs.filter(n => n.path !== proofPath) }
      if (next.needs.length > 0) { setFinalPending(prev => ({ ...prev, [key]: next })); return }
      setFinalPending(prev => { const p = { ...prev }; delete p[key]; return p })
      await finalizeFinalDesign(jobId, idx, next.paths, next.previews)
    } finally {
      setFinalBusy(null)
    }
  }

  async function finalizeFinalDesign(jobId: number, idx: number, paths: string[], previews: Record<string, string>) {
    const key = `${jobId}:${idx}`
    const res = await fetch(`/api/portal/jobs/${jobId}/final`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemIndex: idx, paths, previews, approve: true }),
    })
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: null }))
      setFinalError(prev => ({ ...prev, [key]: error ?? 'Could not save — please try again.' }))
      return
    }
    const { items } = await res.json()
    setJobs(prev => prev.map(j => j.id === jobId ? { ...j, items } : j))
    loadProofs(jobId)
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
      if (!res.ok) {
        // Prefer the server's explanation (e.g. the brief is locked in
        // production) so the client understands why, not just that it failed.
        const msg = await res.json().then(b => b?.error).catch(() => null)
        setEditError(msg || 'Failed to save changes — please try again.')
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

  // Upload an example/reference file and attach it to ONE edit-form item's ref_photos.
  async function addEditItemFile(idx: number, file: File) {
    if (!editForm) return
    setUploadPhotoError('')
    setEditItemUploading(idx)
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
      const putRes = await fetch(signedUrl, { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file })
      if (!putRes.ok) { setUploadPhotoError('Upload failed — please try again.'); return }
      setEditForm(prev => {
        if (!prev) return prev
        const items = [...prev.items]
        items[idx] = { ...items[idx], ref_photos: [...(items[idx].ref_photos ?? []), path] }
        return { ...prev, items }
      })
    } catch {
      setUploadPhotoError('Network error during upload.')
    } finally {
      setEditItemUploading(null)
    }
  }

  function removeEditItemFile(idx: number, path: string) {
    setEditForm(prev => {
      if (!prev) return prev
      const items = [...prev.items]
      items[idx] = { ...items[idx], ref_photos: (items[idx].ref_photos ?? []).filter(p => p !== path) }
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
      const putRes = await fetch(signedUrl, { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file })
      if (!putRes.ok) { setUploadPhotoError('Upload failed — please try again.'); return }
      setEditForm(prev => prev ? { ...prev, file_paths: [...prev.file_paths, path] } : prev)
    } catch {
      setUploadPhotoError('Network error during upload.')
    } finally {
      setUploadingPhoto(false)
    }
  }

  // ── Add to Job (append-only, for in-progress jobs) ───────────────────
  function startAdd(job: Job) {
    setAddingJob(job.id)
    setAddError('')
    setAddItems([{ name: '', quantity: 1, size: '', material: 'vinyl' }])
    setAddFiles([])
  }

  function cancelAdd() {
    setAddingJob(null)
    setAddItems([])
    setAddFiles([])
    setAddError('')
  }

  function updateAddItem(index: number, field: keyof JobItem, value: string | number) {
    setAddItems(prev => {
      const items = [...prev]
      items[index] = { ...items[index], [field]: value }
      return items
    })
  }

  async function addExtraFile(file: File) {
    setAddError('')
    setAddUploading(true)
    try {
      const urlRes = await fetch('/api/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: [{ name: file.name, type: file.type, size: file.size }] }),
      })
      if (!urlRes.ok) {
        const { error } = await urlRes.json()
        setAddError(error ?? 'Could not get upload URL')
        return
      }
      const { uploads } = await urlRes.json()
      const { path, signedUrl } = uploads[0]
      const putRes = await fetch(signedUrl, { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file })
      if (!putRes.ok) { setAddError('Upload failed — please try again.'); return }
      setAddFiles(prev => [...prev, path])
    } catch {
      setAddError('Network error during upload.')
    } finally {
      setAddUploading(false)
    }
  }

  // Upload an example/reference file and attach it to ONE new item's ref_photos.
  async function addItemFile(idx: number, file: File) {
    setAddError('')
    setAddItemUploading(idx)
    try {
      const urlRes = await fetch('/api/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: [{ name: file.name, type: file.type, size: file.size }] }),
      })
      if (!urlRes.ok) {
        const { error } = await urlRes.json()
        setAddError(error ?? 'Could not get upload URL')
        return
      }
      const { uploads } = await urlRes.json()
      const { path, signedUrl } = uploads[0]
      const putRes = await fetch(signedUrl, { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file })
      if (!putRes.ok) { setAddError('Upload failed — please try again.'); return }
      setAddItems(prev => {
        const items = [...prev]
        items[idx] = { ...items[idx], ref_photos: [...(items[idx].ref_photos ?? []), path] }
        return items
      })
    } catch {
      setAddError('Network error during upload.')
    } finally {
      setAddItemUploading(null)
    }
  }

  function removeItemFile(idx: number, path: string) {
    setAddItems(prev => {
      const items = [...prev]
      items[idx] = { ...items[idx], ref_photos: (items[idx].ref_photos ?? []).filter(p => p !== path) }
      return items
    })
  }

  async function saveAdd(jobId: number) {
    const items = addItems.filter(i => i.name.trim() || i.size.trim())
    if (items.some(i => !i.name.trim() || !i.size.trim())) {
      setAddError('Each item needs a name and a size.')
      return
    }
    if (items.length === 0 && addFiles.length === 0) {
      setAddError('Add at least one item or file.')
      return
    }
    setSavingAdd(true)
    setAddError('')
    try {
      const res = await fetch(`/api/portal/jobs/${jobId}/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newItems: items, newFilePaths: addFiles }),
      })
      if (res.status === 409) {
        setAddError('This job is closed and can no longer take new items.')
        return
      }
      if (!res.ok) {
        setAddError('Failed to add — please try again.')
        return
      }
      const { items: serverItems, file_paths } = await res.json()
      setJobs(prev => prev.map(j => j.id === jobId ? { ...j, items: serverItems, file_paths } : j))
      cancelAdd()
    } catch {
      setAddError('Network error — nothing was added.')
    } finally {
      setSavingAdd(false)
    }
  }

  async function signOut() {
    // Clear the portal token and return to the lookup form.
    await fetch('/api/portal/lookup', { method: 'DELETE' }).catch(() => {})
    setJobs([]); setEmail('')
    setNeedsLookup(true)
  }


  // No session and no portal token — ask for reference # + email (no login).
  if (needsLookup) {
    return (
      <Page>
        <SiteHead brand={BRAND} right={<a className="btn btn-quiet btn-sm" href="/">Send a brief</a>} />
        <section style={{ padding: '64px 0', display: 'grid', placeItems: 'center' }}>
          <form className="panel" style={{ padding: 32, width: '100%', maxWidth: 440, display: 'grid', gap: 18 }} onSubmit={handleLookup}>
            <span className="eyebrow">Track your job</span>
            <h1 className="display" style={{ margin: 0, fontSize: 34 }}>Find your <span className="serif">brief.</span></h1>
            <p className="small muted" style={{ margin: 0 }}>Use the reference from your confirmation email and the email you sent the brief from. No password needed.</p>
            <div className="field">
              <label className="label" htmlFor="lk-ref">Reference number</label>
              <input id="lk-ref" className="input" value={lookupRef} onChange={e => setLookupRef(e.target.value)} required placeholder="DDF-20260722-A1B2C3" autoCapitalize="characters" autoCorrect="off" spellCheck={false} />
            </div>
            <div className="field">
              <label className="label" htmlFor="lk-mail">Email</label>
              <input id="lk-mail" type="email" className="input" value={lookupEmail} onChange={e => setLookupEmail(e.target.value)} required placeholder="you@company.com" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
            </div>
            {lookupError && <div className="alert" role="alert">{lookupError}</div>}
            <button className="btn btn-ink btn-block" type="submit" disabled={lookingUp}>{lookingUp ? 'Looking up…' : 'Open my job'}</button>
            <span className="tiny muted">Lost your reference? Email <a className="link" href={`mailto:${BRAND.replyToEmail}`}>{BRAND.replyToEmail}</a></span>
          </form>
        </section>
        <SiteFoot brand={BRAND} />
      </Page>
    )
  }

  return (
    <Page>
      <SiteHead brand={BRAND} right={<><span className="muted hide-sm" style={{ overflowWrap: 'anywhere' }}>{email}</span><button type="button" className="btn btn-quiet btn-sm" onClick={signOut}>Another job</button></>} />
      {loading ? (
        <p className="muted" style={{ padding: '80px 0', textAlign: 'center' }}>Loading your job…</p>
      ) : jobs.length === 0 ? (
        <section className="panel" style={{ padding: 32, maxWidth: 480, margin: '60px auto', display: 'grid', gap: 12 }}>
          <h1 className="display" style={{ margin: 0, fontSize: 34 }}>No jobs <span className="serif">yet.</span></h1>
          <p className="muted" style={{ margin: 0 }}>Send your first brief and we’ll come back with a quote.</p>
          <a className="btn btn-ink" href="/" style={{ justifySelf: 'start' }}>Send a brief</a>
        </section>
      ) : (
        <>
          {jobs.map(job => {
            const canEdit = job.status === 'pending' || job.status === 'received'
            const canAdd = job.status === 'in_progress'
            const proofItems = job.items
              .map((it, idx) => ({ it, idx }))
              .filter(x => itemProofs(x.it).length > 0)
            const approvedCount = proofItems.filter(x => x.it.approval_status === 'approved').length
            const days = daysUntil(job.date_required)
            const isProduct = job.job_type === 'product'
            const waiting = proofItems.filter(x => (x.it.approval_status ?? 'pending') === 'pending').length
            const unproofed = job.items.map((it, idx) => ({ it, idx })).filter(x => itemProofs(x.it).length === 0)
            const place = isProduct
              ? (job.fulfillment === 'pickup' ? HANDOVER.pickup : [HANDOVER[job.fulfillment ?? ''], job.setup_location].filter(Boolean).join(' · '))
              : job.setup_location
            return (
              <article key={job.id} className="stack" style={{ gap: 22, marginBottom: 48 }}>
                <section className="split" style={{ padding: '40px 0 6px', alignItems: 'end' }}>
                  <div className="stack" style={{ gap: 10, minWidth: 0 }}>
                    <span className="row" style={{ gap: 10 }}><span className="eyebrow">Your job</span><JobStatusPill status={job.status} /></span>
                    <h1 className="display hero-title" style={{ margin: 0, overflowWrap: 'anywhere' }}>{job.event_name || job.reference_number}</h1>
                    <p className="muted" style={{ margin: 0 }}>{[place, `${isProduct ? 'Needed by' : 'Event'} ${prettyDate(job.date_required)}`].filter(Boolean).join(' · ')}</p>
                  </div>
                  <div className="ticket">
                    <div className="between"><span className="t-label">Reference</span><span className="t-label">Countdown</span></div>
                    <div className="between" style={{ marginTop: 8 }}>
                      <span className="t-ref" style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{job.reference_number}</span>
                      <span className="display num" style={{ fontSize: 40, color: '#fff', whiteSpace: 'nowrap' }}>{days > 1 ? <>{days}<span className="small" style={{ marginLeft: 6, color: 'rgba(243,238,241,.65)', letterSpacing: 0 }}>days</span></> : countdownLabel(days)}</span>
                    </div>
                  </div>
                </section>

                {/* Plan B: progress tracker */}

                <div className="split">
                  <div className="stack" style={{ gap: 22, minWidth: 0 }}>
                    {waiting > 0 && (
                      <div className="callout stack-sm">
                        <div><b>{waiting} design{waiting === 1 ? ' is' : 's are'} waiting for your approval.</b><div className="small muted">We make everything as soon as it’s approved.</div></div>
                        <button type="button" className="btn btn-ink" onClick={() => document.getElementById(`proofs-${job.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>Review designs</button>
                      </div>
                    )}
                    {unproofed.length > 0 && job.status !== 'cancelled' && (
                      <section className="stack" style={{ gap: 12 }}>
                        <SecHead n="01" title="In design" aside={<span className="tiny muted">{unproofed.length} piece{unproofed.length === 1 ? '' : 's'}</span>} />
                        {unproofed.map(({ it, idx }) => (
                          <article key={idx} className="item-card" style={{ gridTemplateColumns: '1fr' }}>
                            <div className="between" style={{ alignItems: 'start' }}>
                              <span className="stack" style={{ gap: 4, minWidth: 0, overflowWrap: 'anywhere' }}><b>{it.name}</b><span className="small muted">{it.quantity} × {[it.size, it.material].filter(Boolean).join(' · ')}</span></span>
                              {it.completed || job.status === 'completed' ? <span className="pill pill-ok">Done</span> : <span className="pill pill-neutral">Designing</span>}
                            </div>
                          </article>
                        ))}
                      </section>
                    )}

                    {/* ── Design proofs / approvals ─────────────────────────── */}
                    {proofItems.length > 0 && (
                      <section id={`proofs-${job.id}`} className="stack" style={{ gap: 12, scrollMarginTop: 16 }}>
                        <SecHead n="02" title="Designs" aside={<span className="tiny muted">{approvedCount} of {proofItems.length} approved</span>} />
                        {proofItems.map(({ it, idx }) => {
                          const key = `${job.id}:${idx}`
                          const proofs = itemProofs(it)
                          const status: ApprovalStatus = it.approval_status ?? 'pending'
                          const busy = actioning === key
                          const err = approvalError[key]
                          // PDF/AI/EPS: the thumbnail is a preview (or a tile); the link opens the real file.
                          const proofLink = (p: string, pi: number) => {
                            const u = proofUrls[job.id]?.[p]
                            const fileU = !isImagePath(p) ? proofFileUrls[job.id]?.[p] : undefined
                            const older = proofs.length > 1 && designsMode(it) === 'latest' && pi > 0
                            return { u, fileU, older }
                          }
                          const main = proofLink(proofs[0], 0)
                          return (
                            <article key={idx} className="item-card">
                              {/* Thumbnails (one or more proofs) — latest-only keeps the newest big, earlier ones small/dim */}
                              <div className="stack" style={{ gap: 6, alignContent: 'start', minWidth: 0 }}>
                                <a className="thumb" href={main.fileU ?? main.u ?? undefined} target="_blank" rel="noopener noreferrer"
                                   title={main.fileU ? `Open ${fileKindLabel(proofs[0])} file` : undefined} style={{ background: '#fff' }}>
                                  {main.u
                                    ? <img src={main.u} alt={`Proof for ${it.name}`} style={{ objectFit: 'contain', padding: 4 }} />
                                    : <span className="tiny muted">Loading…</span>}
                                </a>
                                {main.fileU && (
                                  <a className="link tiny" href={main.fileU} target="_blank" rel="noopener noreferrer" style={{ textAlign: 'center' }}>{fileKindLabel(proofs[0])} ↗</a>
                                )}
                              </div>
                              {/* Body */}
                              <div className="stack" style={{ gap: 10, minWidth: 0 }}>
                                <div className="between" style={{ alignItems: 'start', flexWrap: 'wrap', gap: 8 }}>
                                  <span className="stack" style={{ gap: 4, minWidth: 0, overflowWrap: 'anywhere' }}>
                                    <b>{it.quantity}× {it.name}</b>
                                    {it.size && <span className="small muted">{it.size}</span>}
                                  </span>
                                  <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                                    {it.proof_source === 'client' && (
                                      <span className="pill pill-ok" title="You uploaded this print-ready file yourself">Your file</span>
                                    )}
                                    <ApprovalPill status={status} />
                                  </span>
                                </div>
                                {proofs.length > 1 && (
                                  <div className="earlier">
                                    {proofs.slice(1).map((p, i) => {
                                      const { u, fileU, older } = proofLink(p, i + 1)
                                      return (
                                        <span key={p} className="stack" style={{ gap: 3, justifyItems: 'center' }}>
                                          <a href={fileU ?? u ?? undefined} target="_blank" rel="noopener noreferrer"
                                             title={older ? 'Earlier design' : fileU ? `Open ${fileKindLabel(p)} file` : undefined}
                                             style={{ opacity: older ? 0.6 : 1, display: 'grid', placeItems: 'center' }}>
                                            {u
                                              ? <img src={u} alt={`Proof for ${it.name}`} style={{ objectFit: 'contain', padding: 3 }} />
                                              : <span className="tiny muted">…</span>}
                                          </a>
                                          {fileU && !older && (
                                            <a className="link tiny" href={fileU} target="_blank" rel="noopener noreferrer" style={{ width: 'auto', height: 'auto', opacity: 1, border: 0, background: 'none' }}>{fileKindLabel(p)} ↗</a>
                                          )}
                                        </span>
                                      )
                                    })}
                                  </div>
                                )}
                                {it.admin_note && (
                                  <div className="msg shop" style={{ maxWidth: '100%' }}>
                                    <div className="tiny muted" style={{ marginBottom: 3 }}>A note from us</div>
                                    <p className="small" style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{it.admin_note}</p>
                                  </div>
                                )}
                                {itemExamplePhotos(it).length > 0 && (
                                  <div className="stack" style={{ gap: 6 }}>
                                    <span className="label">How it might look</span>
                                    <div className="earlier">
                                      {itemExamplePhotos(it).map(p => {
                                        const u = proofUrls[job.id]?.[p]
                                        return (
                                          <a key={p} href={u ?? undefined} target="_blank" rel="noopener noreferrer" style={{ opacity: 1, display: 'grid', placeItems: 'center' }}>
                                            {u
                                              ? <img src={u} alt="Example" style={{ objectFit: 'contain', padding: 3 }} />
                                              : <span className="tiny muted">…</span>}
                                          </a>
                                        )
                                      })}
                                    </div>
                                  </div>
                                )}
                                {status === 'changes_requested' && it.client_note && (
                                  <p className="alert" style={{ margin: 0, padding: '8px 12px', overflowWrap: 'anywhere' }}>
                                    You requested: “{it.client_note}”
                                  </p>
                                )}

                                {/* Note box (request changes) */}
                                {noteOpen[key] ? (
                                  <div className="stack" style={{ gap: 8 }}>
                                    <textarea
                                      className="input"
                                      rows={2}
                                      value={noteDraft[key] ?? ''}
                                      onChange={e => setNoteDraft(prev => ({ ...prev, [key]: e.target.value }))}
                                      placeholder="What needs to change?"
                                    />
                                    {err && <p className="err">{err}</p>}
                                    <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
                                      <button type="button" className="btn btn-ink btn-sm" onClick={() => submitApproval(job.id, idx, 'request_changes')} disabled={busy} style={{ opacity: busy ? 0.6 : 1 }}>
                                        {busy ? 'Sending…' : 'Send Request'}
                                      </button>
                                      <button type="button" className="link tiny" onClick={() => { setNoteOpen(prev => ({ ...prev, [key]: false })); setApprovalError(prev => ({ ...prev, [key]: '' })) }} disabled={busy}>
                                        Cancel
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
                                    {status !== 'approved' && (
                                      <button type="button" className="btn btn-forest btn-sm" onClick={() => submitApproval(job.id, idx, 'approve')} disabled={busy} style={{ opacity: busy ? 0.6 : 1 }}>
                                        {busy ? 'Saving…' : '✓ Approve'}
                                      </button>
                                    )}
                                    <button type="button" className="btn btn-quiet btn-sm" onClick={() => { setNoteOpen(prev => ({ ...prev, [key]: true })); setNoteDraft(prev => ({ ...prev, [key]: prev[key] ?? '' })) }} disabled={busy}>
                                      {status === 'approved' ? 'Request changes instead' : 'Request Changes'}
                                    </button>
                                  </div>
                                )}
                                {err && !noteOpen[key] && <p className="err">{err}</p>}
                              </div>
                            </article>
                          )
                        })}
                      </section>
                    )}

                    {/* ── Client's own final artwork ─────────────────────────── */}
                    {(() => {
                      const closed = job.status === 'completed' || job.status === 'cancelled'
                      const eligible = job.items
                        .map((it, idx) => ({ it, idx }))
                        .filter(x => !x.it.completed && x.it.approval_status !== 'approved')
                      if (closed || eligible.length === 0) return null
                      const open = !!finalOpen[job.id]
                      return (
                        <section className="panel" style={{ padding: 20, display: 'grid', gap: 12 }}>
                          <button type="button" onClick={() => setFinalOpen(prev => ({ ...prev, [job.id]: !open }))} aria-expanded={open}
                            className="row" style={{ gap: 8, flexWrap: 'wrap', width: '100%', textAlign: 'left', background: 'none', border: 0, padding: 0, cursor: 'pointer', color: 'var(--ink)' }}>
                            <b>Have your own print-ready artwork?</b>
                            <span className="tiny muted">{open ? '▴ hide' : '▾ upload & approve it yourself'}</span>
                          </button>
                          {open && (
                            <div className="stack" style={{ gap: 10 }}>
                              <p className="small muted" style={{ margin: 0 }}>
                                If your designer already made the final file, upload it here and it&apos;s approved for print straight away — no need to wait for a proof from us. PDF, AI, EPS, DXF, SVG, PNG or JPG, up to {MAX_FILE_MB} MB.
                              </p>
                              <div className="stack" style={{ gap: 8 }}>
                                {eligible.map(({ it, idx }) => {
                                  const key = `${job.id}:${idx}`
                                  const busy = finalBusy === key
                                  const err = finalError[key]
                                  return (
                                    <div key={idx} className="row" style={{ gap: 10, flexWrap: 'wrap', border: '1px solid var(--line)', borderRadius: 'var(--r-md)', background: 'var(--surface)', padding: '10px 12px' }}>
                                      <span className="small" style={{ flex: 1, minWidth: 140, fontWeight: 500, overflowWrap: 'anywhere' }}>
                                        {it.quantity}× {it.name} <span className="muted" style={{ fontWeight: 400 }}>· {it.size}</span>
                                      </span>
                                      <label className="btn btn-forest btn-sm" style={{ cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>
                                        {busy ? 'Uploading…' : '⬆ Upload final & approve'}
                                        <input type="file" multiple disabled={busy}
                                          accept=".pdf,.ai,.eps,.dxf,.svg,.png,.jpg,.jpeg,application/pdf,application/postscript,image/svg+xml,image/png,image/jpeg"
                                          style={{ display: 'none' }}
                                          onChange={e => {
                                            const files = Array.from(e.target.files ?? []).slice(0, 8)
                                            e.target.value = ''
                                            if (files.length && window.confirm(`Upload ${files.length === 1 ? files[0].name : files.length + ' files'} as the FINAL print-ready artwork for "${it.name}" and approve it for print?`)) {
                                              uploadFinalDesign(job.id, idx, files)
                                            }
                                          }} />
                                      </label>
                                      {finalPending[key]?.needs.map(n => (
                                        <div key={n.path} className="callout stack-sm" style={{ width: '100%', padding: '12px 14px', flexWrap: 'wrap' }}>
                                          <span className="small" style={{ flex: 1, minWidth: 160, overflowWrap: 'anywhere' }}><strong>{n.name}</strong> uploaded ✓ — now add a <strong>screenshot of the design</strong> (JPG/PNG) so our team can see it. It&apos;s approved as soon as that&apos;s in.</span>
                                          <label className="btn btn-ink btn-sm" style={{ cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>
                                            {busy ? 'Saving…' : '🖼️ Add screenshot'}
                                            <input type="file" accept=".jpg,.jpeg,.png,image/jpeg,image/png" disabled={busy} style={{ display: 'none' }}
                                              onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; addManualFinalPreview(job.id, idx, n.path, f) }} />
                                          </label>
                                        </div>
                                      ))}
                                      {err && <p className="err" style={{ width: '100%' }}>{err}</p>}
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          )}
                        </section>
                      )
                    })()}

                    {/* Edit panel */}
                    {editingJob === job.id && editForm && (
                      <section id={`edit-${job.id}`} className="panel" style={{ padding: 20, display: 'grid', gap: 14, scrollMarginTop: 16 }}>
                        <h2 className="sec-title" style={{ margin: 0 }}>Edit brief</h2>
                        {editError && <div className="alert" role="alert">{editError}</div>}
                        <div className="grid2" style={{ gap: 10 }}>
                          <label className="field">
                            <span className="label">Due date</span>
                            <input type="date" className="input" value={editForm.date_required}
                              onChange={e => setEditForm(prev => prev ? { ...prev, date_required: e.target.value } : prev)} />
                          </label>
                          <label className="field">
                            <span className="label">Event / Location</span>
                            <input type="text" className="input" value={editForm.event_name}
                              onChange={e => setEditForm(prev => prev ? { ...prev, event_name: e.target.value } : prev)}
                              placeholder="Optional" />
                          </label>
                        </div>
                        <label className="field">
                          <span className="label">Notes / Special instructions</span>
                          <textarea className="input" value={editForm.notes} rows={3}
                            onChange={e => setEditForm(prev => prev ? { ...prev, notes: e.target.value } : prev)}
                            placeholder="Optional" />
                        </label>
                        <div className="stack" style={{ gap: 8 }}>
                          <span className="label">Reference photos</span>
                          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                            {editForm.file_paths.map(path => {
                              const name = path.split('/').pop() ?? path
                              return (
                                <div key={path} className="tiny" style={FILE_CHIP}>
                                  <span style={FILE_NAME}>{name}</span>
                                  <button
                                    type="button"
                                    className="link tiny"
                                    onClick={() => setEditForm(prev => prev ? { ...prev, file_paths: prev.file_paths.filter(p => p !== path) } : prev)}
                                    title="Remove photo"
                                    style={{ color: 'var(--rose)', flexShrink: 0 }}
                                  >×</button>
                                </div>
                              )
                            })}
                            {editForm.file_paths.length < MAX_FILES && (
                              <label className="btn btn-quiet btn-sm" style={{ cursor: uploadingPhoto ? 'default' : 'pointer', opacity: uploadingPhoto ? 0.6 : 1 }}>
                                <input
                                  type="file"
                                  accept="image/jpeg,image/png,image/svg+xml,application/pdf,.ai,.eps,.dxf"
                                  style={{ display: 'none' }}
                                  disabled={uploadingPhoto}
                                  onChange={e => { const f = e.target.files?.[0]; if (f) { e.target.value = ''; addPhoto(f) } }}
                                />
                                {uploadingPhoto ? 'Uploading…' : '+ Add Photo'}
                              </label>
                            )}
                          </div>
                          {uploadPhotoError && <p className="err">{uploadPhotoError}</p>}
                          {editForm.file_paths.length > 0 && <p className="tiny muted" style={{ margin: 0 }}>Removing a photo cannot be undone after saving.</p>}
                        </div>

                        <div className="stack" style={{ gap: 8 }}>
                          <span className="label">Items</span>
                          {editForm.items.map((item, idx) => {
                            const photos = item.ref_photos ?? []
                            const uploading = editItemUploading === idx
                            return (
                            <div key={idx} style={{ border: '1px solid var(--line)', borderRadius: 'var(--r-md)', background: 'var(--surface)', padding: 12, display: 'grid', gap: 8 }}>
                              <div style={{ display: 'grid', gridTemplateColumns: '76px minmax(0, 1fr) auto', gap: 8, alignItems: 'center' }}>
                                <input type="number" min={1} className="input" aria-label="Quantity" value={item.quantity}
                                  onChange={e => updateEditItem(idx, 'quantity', parseInt(e.target.value) || 1)}
                                  style={{ textAlign: 'center', paddingLeft: 8, paddingRight: 8 }} />
                                <input type="text" className="input" value={item.name}
                                  onChange={e => updateEditItem(idx, 'name', e.target.value)}
                                  aria-label="Item name"
                                  placeholder="Item name" />
                                <button type="button" className="link tiny" onClick={() => setEditForm(prev => prev ? { ...prev, items: prev.items.filter((_, i) => i !== idx) } : prev)}
                                  disabled={editForm.items.length === 1}
                                  aria-label="Remove item"
                                  style={{ color: 'var(--rose)', fontSize: 18, padding: '0 4px', opacity: editForm.items.length === 1 ? 0.3 : 1 }}>×</button>
                              </div>
                              <div className="grid2" style={{ gap: 8 }}>
                                <input type="text" className="input" value={item.size}
                                  onChange={e => updateEditItem(idx, 'size', e.target.value)}
                                  aria-label="Size"
                                  placeholder="Size" />
                                <select className="input" aria-label="Material" value={item.material}
                                  onChange={e => updateEditItem(idx, 'material', e.target.value)}>
                                  {MATERIALS.map(m => (
                                    <option key={m} value={m}>{m}</option>
                                  ))}
                                </select>
                              </div>
                              <textarea
                                className="input"
                                value={item.description ?? ''}
                                rows={2}
                                onChange={e => updateEditItem(idx, 'description', e.target.value)}
                                aria-label="Notes for this item"
                                placeholder="Notes for this item (optional) — colours, finish, placement…" />
                              <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                                {photos.map(path => {
                                  const name = path.split('/').pop() ?? path
                                  return (
                                    <div key={path} className="tiny" style={FILE_CHIP}>
                                      <span style={{ ...FILE_NAME, maxWidth: 150 }}>{name}</span>
                                      <button type="button" className="link tiny" onClick={() => removeEditItemFile(idx, path)} title="Remove"
                                        style={{ color: 'var(--rose)', flexShrink: 0 }}>×</button>
                                    </div>
                                  )
                                })}
                                {photos.length < 5 && (
                                  <label className="btn btn-quiet btn-sm" style={{ cursor: uploading ? 'default' : 'pointer', opacity: uploading ? 0.6 : 1 }}>
                                    <input
                                      type="file"
                                      accept="image/jpeg,image/png,image/svg+xml,application/pdf,.ai,.eps,.dxf"
                                      style={{ display: 'none' }}
                                      disabled={uploading}
                                      onChange={e => { const f = e.target.files?.[0]; if (f) { e.target.value = ''; addEditItemFile(idx, f) } }}
                                    />
                                    {uploading ? 'Uploading…' : '+ Example / file'}
                                  </label>
                                )}
                              </div>
                            </div>
                            )
                          })}
                          {editForm.items.length < MAX_PIECES && (
                            <button type="button" className="btn btn-quiet btn-sm" style={{ justifySelf: 'start' }}
                              onClick={() => setEditForm(prev => prev ? { ...prev, items: [...prev.items, { name: '', quantity: 1, size: '', material: 'vinyl' }] } : prev)}>
                              + Add Item
                            </button>
                          )}
                        </div>
                        <div className="row" style={{ gap: 14, justifyContent: 'flex-end' }}>
                          <button type="button" className="link tiny" onClick={cancelEdit}>Cancel</button>
                          <button type="button" className="btn btn-ink btn-sm" onClick={() => saveEdit(job.id)} disabled={savingEdit} style={{ opacity: savingEdit ? 0.6 : 1 }}>
                            {savingEdit ? 'Saving…' : 'Save Changes'}
                          </button>
                        </div>
                      </section>
                    )}

                    {/* Add-to-Job panel (append-only, in-progress jobs) */}
                    {addingJob === job.id && (
                      <section id={`add-${job.id}`} className="panel" style={{ padding: 20, display: 'grid', gap: 14, scrollMarginTop: 16 }}>
                        <div className="stack" style={{ gap: 6 }}>
                          <h2 className="sec-title" style={{ margin: 0 }}>Add to this job</h2>
                          <p className="small muted" style={{ margin: 0 }}>
                            Add new items or documents to a job already in production. Existing items aren&apos;t affected — we&apos;ll quote and proof the additions separately.
                          </p>
                        </div>
                        {addError && <div className="alert" role="alert">{addError}</div>}

                        <div className="stack" style={{ gap: 8 }}>
                          <span className="label">New items</span>
                          {addItems.map((item, idx) => {
                            const photos = item.ref_photos ?? []
                            const uploading = addItemUploading === idx
                            return (
                            <div key={idx} style={{ border: '1px solid var(--line)', borderRadius: 'var(--r-md)', background: 'var(--surface)', padding: 12, display: 'grid', gap: 8 }}>
                              <div style={{ display: 'grid', gridTemplateColumns: '76px minmax(0, 1fr) auto', gap: 8, alignItems: 'center' }}>
                                <input type="number" min={1} className="input" aria-label="Quantity" value={item.quantity}
                                  onChange={e => updateAddItem(idx, 'quantity', parseInt(e.target.value) || 1)}
                                  style={{ textAlign: 'center', paddingLeft: 8, paddingRight: 8 }} />
                                <input type="text" className="input" value={item.name}
                                  onChange={e => updateAddItem(idx, 'name', e.target.value)}
                                  aria-label="Item name"
                                  placeholder="Item name" />
                                <button type="button" className="link tiny" onClick={() => setAddItems(prev => prev.filter((_, i) => i !== idx))}
                                  aria-label="Remove item"
                                  style={{ color: 'var(--rose)', fontSize: 18, padding: '0 4px' }}>×</button>
                              </div>
                              <div className="grid2" style={{ gap: 8 }}>
                                <input type="text" className="input" value={item.size}
                                  onChange={e => updateAddItem(idx, 'size', e.target.value)}
                                  aria-label="Size"
                                  placeholder="Size" />
                                <select className="input" aria-label="Material" value={item.material}
                                  onChange={e => updateAddItem(idx, 'material', e.target.value)}>
                                  {MATERIALS.map(m => (
                                    <option key={m} value={m}>{m}</option>
                                  ))}
                                </select>
                              </div>
                              <textarea
                                className="input"
                                value={item.description ?? ''}
                                rows={2}
                                onChange={e => updateAddItem(idx, 'description', e.target.value)}
                                aria-label="Notes for this item"
                                placeholder="Notes for this item (optional) — colours, finish, placement…" />
                              <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                                {photos.map(path => {
                                  const name = path.split('/').pop() ?? path
                                  return (
                                    <div key={path} className="tiny" style={FILE_CHIP}>
                                      <span style={{ ...FILE_NAME, maxWidth: 150 }}>{name}</span>
                                      <button type="button" className="link tiny" onClick={() => removeItemFile(idx, path)} title="Remove"
                                        style={{ color: 'var(--rose)', flexShrink: 0 }}>×</button>
                                    </div>
                                  )
                                })}
                                {photos.length < 5 && (
                                  <label className="btn btn-quiet btn-sm" style={{ cursor: uploading ? 'default' : 'pointer', opacity: uploading ? 0.6 : 1 }}>
                                    <input
                                      type="file"
                                      accept="image/jpeg,image/png,image/svg+xml,application/pdf,.ai,.eps,.dxf"
                                      style={{ display: 'none' }}
                                      disabled={uploading}
                                      onChange={e => { const f = e.target.files?.[0]; if (f) { e.target.value = ''; addItemFile(idx, f) } }}
                                    />
                                    {uploading ? 'Uploading…' : '+ Example / file'}
                                  </label>
                                )}
                              </div>
                            </div>
                            )
                          })}
                          {addItems.length < MAX_PIECES && (
                            <button type="button" className="btn btn-quiet btn-sm" style={{ justifySelf: 'start' }}
                              onClick={() => setAddItems(prev => [...prev, { name: '', quantity: 1, size: '', material: 'vinyl' }])}>
                              + Add Item
                            </button>
                          )}
                        </div>

                        <div className="stack" style={{ gap: 8 }}>
                          <span className="label">New documents / photos</span>
                          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                            {addFiles.map(path => {
                              const name = path.split('/').pop() ?? path
                              return (
                                <div key={path} className="tiny" style={FILE_CHIP}>
                                  <span style={FILE_NAME}>{name}</span>
                                  <button
                                    type="button"
                                    className="link tiny"
                                    onClick={() => setAddFiles(prev => prev.filter(p => p !== path))}
                                    title="Remove file"
                                    style={{ color: 'var(--rose)', flexShrink: 0 }}
                                  >×</button>
                                </div>
                              )
                            })}
                            {addFiles.length < MAX_FILES && (
                              <label className="btn btn-quiet btn-sm" style={{ cursor: addUploading ? 'default' : 'pointer', opacity: addUploading ? 0.6 : 1 }}>
                                <input
                                  type="file"
                                  accept="image/jpeg,image/png,image/svg+xml,application/pdf,.ai,.eps,.dxf"
                                  style={{ display: 'none' }}
                                  disabled={addUploading}
                                  onChange={e => { const f = e.target.files?.[0]; if (f) { e.target.value = ''; addExtraFile(f) } }}
                                />
                                {addUploading ? 'Uploading…' : '+ Add File'}
                              </label>
                            )}
                          </div>
                        </div>

                        <div className="row" style={{ gap: 14, justifyContent: 'flex-end' }}>
                          <button type="button" className="link tiny" onClick={cancelAdd}>Cancel</button>
                          <button type="button" className="btn btn-ink btn-sm" onClick={() => saveAdd(job.id)} disabled={savingAdd} style={{ opacity: savingAdd ? 0.6 : 1 }}>
                            {savingAdd ? 'Adding…' : 'Add to Job'}
                          </button>
                        </div>
                      </section>
                    )}
                  </div>
                  <aside className="sticky stack" style={{ gap: 16, minWidth: 0 }}>
                    {/* Plan B: deposit card */}
                    <div className="panel" style={{ padding: 22, display: 'grid', gap: 10, overflowWrap: 'anywhere' }}>
                      <span className="label">Details</span>
                      <div className="small"><span className="muted">Sent</span><br />{(() => { const d = new Date(job.submitted_at); return prettyDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`) })()}</div>
                      {!isProduct && job.setup_location && <div className="small"><span className="muted">Setup</span><br />{[job.setup_time, job.setup_location].filter(Boolean).join(' · ')}</div>}
                      {!isProduct && job.removal_location && <div className="small"><span className="muted">Removal</span><br />{[job.removal_time, job.removal_location].filter(Boolean).join(' · ')}</div>}
                      {isProduct && <div className="small"><span className="muted">Hand-over</span><br />{place || '—'}{job.setup_time ? ` · ${job.setup_time}` : ''}</div>}
                      {job.notes && <div className="small"><span className="muted">Notes</span><br />{job.notes}</div>}
                      <hr className="rule" />
                      {canEdit && <button type="button" className="btn btn-quiet btn-sm" onClick={() => { if (editingJob === job.id) { cancelEdit() } else { startEdit(job); scrollToId(`edit-${job.id}`) } }}>{editingJob === job.id ? 'Cancel editing' : 'Edit brief'}</button>}
                      {canAdd && <button type="button" className="btn btn-quiet btn-sm" onClick={() => { if (addingJob === job.id) { cancelAdd() } else { startAdd(job); scrollToId(`add-${job.id}`) } }}><Plus size={14} /> {addingJob === job.id ? 'Cancel' : 'Add a piece to this job'}</button>}
                    </div>
                  </aside>
                </div>
                <nav className="dock only-sm" aria-label="Quick actions">
                  <button type="button" className="d-btn" aria-label="Top of page" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}><Home size={18} /></button>
                  {canAdd && <button type="button" className="fab" aria-label="Add a piece" onClick={() => { if (addingJob !== job.id) startAdd(job); scrollToId(`add-${job.id}`) }}><Plus size={22} /></button>}
                  {proofItems.length > 0 && <button type="button" className="d-btn" aria-label="Designs" onClick={() => document.getElementById(`proofs-${job.id}`)?.scrollIntoView({ behavior: 'smooth' })}><MessageCircle size={18} /></button>}
                </nav>
              </article>
            )
          })}
        </>
      )}
      <SiteFoot brand={BRAND} />
    </Page>
  )
}
