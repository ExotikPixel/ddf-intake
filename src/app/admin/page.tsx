'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { useRouter } from 'next/navigation'
import { STATUSES, STATUS_LABELS, STATUS_CONFIG, APPROVAL_CONFIG, itemProofs, itemRefPhotos, itemExamplePhotos, approvedProofs, itemThread, designsMode } from '@/lib/job-types'
import type { JobItem, ApprovalStatus, ItemMessage } from '@/lib/job-types'

interface Job {
  id: number
  reference_number: string
  client_name: string
  company_name: string
  contact_email: string
  event_name: string | null
  date_required: string
  notes: string | null
  setup_location: string | null
  setup_time: string | null
  removal_location: string | null
  removal_time: string | null
  status: string
  submitted_at: string
  items: JobItem[]
  file_paths: string[]
  notify_client: boolean
}

interface EditForm {
  date_required: string
  event_name: string
  notes: string
  setup_location: string
  setup_time: string
  removal_location: string
  removal_time: string
  items: JobItem[]
  file_paths: string[]
}

// ── XSS guard ──────────────────────────────────────────────────────────────
function escHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
         .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

// Items are often named "June 15 - Welcome Sign" — the part before " - " is the
// event date used to group designs; the rest is the description.
function parseItemDate(name: string): { label: string; short: string } {
  const i = name.indexOf(' - ')
  if (i > 0) return { label: name.slice(0, i).trim(), short: name.slice(i + 3).trim() }
  return { label: '', short: name }
}
// Sortable timestamp for a date label ("June 15" or "15 June 2026"); unparseable → last.
function dateSortKey(label: string): number {
  if (!label) return Infinity
  let t = new Date(label).getTime()
  if (isNaN(t)) t = new Date(`${label} ${new Date().getFullYear()}`).getTime()
  return isNaN(t) ? Infinity : t
}

// ── SVG Icons ──────────────────────────────────────────────────────────────
function PrintIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 6 2 18 2 18 9"/>
      <path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/>
      <rect x="6" y="14" width="12" height="8"/>
    </svg>
  )
}
function InvoiceIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="16" y1="13" x2="8" y2="13"/>
      <line x1="16" y1="17" x2="8" y2="17"/>
      <polyline points="10 9 9 9 8 9"/>
    </svg>
  )
}
function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  )
}
function EditIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
    </svg>
  )
}

// ── Status pill ────────────────────────────────────────────────────────────
function StatusPill({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending
  return (
    <span style={{
      background: cfg.bg,
      color: cfg.color,
      fontSize: '10px',
      fontWeight: 700,
      letterSpacing: '0.8px',
      textTransform: 'uppercase',
      padding: '2px 8px',
      border: `1px solid ${cfg.color}33`,
      whiteSpace: 'nowrap',
    }}>
      {cfg.label}
    </span>
  )
}

function ApprovalPill({ status }: { status: ApprovalStatus }) {
  const cfg = APPROVAL_CONFIG[status]
  return (
    <span style={{
      background: cfg.bg, color: cfg.color, fontSize: 9, fontWeight: 700,
      letterSpacing: '0.6px', textTransform: 'uppercase', padding: '1px 7px',
      border: `1px solid ${cfg.color}33`, whiteSpace: 'nowrap',
    }}>
      {cfg.label}
    </span>
  )
}

const STATUS_COLORS: Record<string, string> = Object.fromEntries(
  Object.entries(STATUS_CONFIG).map(([k, v]) => [k, v.color])
)

// ── Page ───────────────────────────────────────────────────────────────────
export default function AdminPage() {
  const [jobs, setJobs]                 = useState<Job[]>([])
  const [loading, setLoading]           = useState(true)
  const [loadError, setLoadError]       = useState('')
  const [filter, setFilter]             = useState('all')
  const [search, setSearch]             = useState('')
  const [openOverride, setOpenOverride] = useState<Record<number, boolean>>({})
  const [updating, setUpdating]         = useState<number | null>(null)
  const [togglingNotify, setTogglingNotify] = useState<number | null>(null)
  const [fileUrls, setFileUrls]         = useState<Record<number, { path: string; name: string; url: string }[]>>({})
  const [loadingFiles, setLoadingFiles] = useState<number | null>(null)
  const [fileError, setFileError]       = useState<number | null>(null)
  const [openRefs, setOpenRefs]         = useState<string | null>(null) // `${jobId}:${itemIndex}` whose ref photos are revealed
  const [sendingToCC, setSendingToCC]   = useState<number | null>(null)
  const [sentToCC, setSentToCC]         = useState<Set<number>>(new Set())
  const [resyncing, setResyncing]       = useState<number | null>(null)
  const [resynced, setResynced]         = useState<Set<number>>(new Set())
  const [editingJob, setEditingJob]     = useState<number | null>(null)
  const [editForm, setEditForm]         = useState<EditForm | null>(null)
  const [savingEdit, setSavingEdit]     = useState(false)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [uploadPhotoError, setUploadPhotoError] = useState('')
  const [uploadingProof, setUploadingProof] = useState<number | null>(null)
  const [proofError, setProofError] = useState('')
  const [uploadingExample, setUploadingExample] = useState<number | null>(null)
  const [exampleError, setExampleError] = useState('')
  const [copyingLink, setCopyingLink] = useState<number | null>(null)
  const [copiedLink, setCopiedLink] = useState<number | null>(null)
  const [approvingItem, setApprovingItem] = useState<string | null>(null)
  const [replyDraft, setReplyDraft] = useState<Record<string, string>>({})   // `${jobId}:${idx}` → draft reply
  const [chatItem, setChatItem] = useState<{ jobId: number; idx: number } | null>(null) // open conversation drawer
  const [approvePicker, setApprovePicker] = useState<{ jobId: number; idx: number } | null>(null) // pick-a-design before approving
  const [pickerChoice, setPickerChoice] = useState<string | null>(null)
  const chatBodyRef = useRef<HTMLDivElement>(null)
  const [sendingReply, setSendingReply] = useState<string | null>(null)
  const [uploadingRevision, setUploadingRevision] = useState<string | null>(null)
  const [revisionError, setRevisionError] = useState<Record<string, string>>({})
  const [dragProof, setDragProof] = useState<number | null>(null)
  const [buildingProdSheet, setBuildingProdSheet] = useState(false)
  const router = useRouter()

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { router.push('/login'); return }
      fetchJobs()
    })
  }, [router])

  // Stop the browser from opening a file if it's dropped outside a drop zone.
  useEffect(() => {
    const prevent = (e: DragEvent) => e.preventDefault()
    window.addEventListener('dragover', prevent)
    window.addEventListener('drop', prevent)
    return () => {
      window.removeEventListener('dragover', prevent)
      window.removeEventListener('drop', prevent)
    }
  }, [])

  async function fetchJobs() {
    try {
      const res = await fetch('/api/admin/jobs')
      if (res.status === 401) { router.push('/login'); return }
      if (!res.ok) { setLoadError('Failed to load jobs — please refresh.'); return }
      const { jobs: data } = await res.json()
      setJobs(data ?? [])
    } catch {
      setLoadError('Network error — please check your connection and refresh.')
    } finally {
      setLoading(false)
    }
  }

  async function updateStatus(jobId: number, newStatus: string) {
    setUpdating(jobId)
    try {
      const res = await fetch(`/api/admin/jobs/${jobId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      if (res.ok) {
        setJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: newStatus } : j))
      } else {
        alert('Failed to update status — please try again.')
      }
    } catch {
      alert('Network error — status not updated.')
    } finally {
      setUpdating(null)
    }
  }

  async function toggleNotify(jobId: number, currentValue: boolean) {
    const newValue = !currentValue
    // Optimistic update
    setJobs(prev => prev.map(j => j.id === jobId ? { ...j, notify_client: newValue } : j))
    setTogglingNotify(jobId)
    try {
      const res = await fetch(`/api/admin/jobs/${jobId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notify_client: newValue }),
      })
      if (!res.ok) throw new Error('PATCH failed')
    } catch {
      // Rollback on failure
      setJobs(prev => prev.map(j => j.id === jobId ? { ...j, notify_client: currentValue } : j))
    } finally {
      setTogglingNotify(null)
    }
  }

  async function loadFiles(jobId: number, paths: string[]) {
    const have = fileUrls[jobId] ?? []
    const haveSet = new Set(have.map(f => f.path))
    const missing = paths.filter(p => !haveSet.has(p))
    if (missing.length === 0) return have
    setLoadingFiles(jobId)
    setFileError(null)
    try {
      const res = await fetch('/api/admin/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: missing }),
      })
      if (!res.ok) { setFileError(jobId); return have }
      const { urls } = await res.json()
      const merged = [...have, ...(urls as { path: string; name: string; url: string }[])]
      setFileUrls(prev => ({ ...prev, [jobId]: merged }))
      return merged
    } catch {
      setFileError(jobId)
      return have
    } finally {
      setLoadingFiles(null)
    }
  }

  function startEdit(job: Job) {
    setEditingJob(job.id)
    setEditForm({
      date_required: job.date_required,
      event_name: job.event_name ?? '',
      notes: job.notes ?? '',
      setup_location: job.setup_location ?? '',
      setup_time: job.setup_time ?? '',
      removal_location: job.removal_location ?? '',
      removal_time: job.removal_time ?? '',
      items: job.items.map(i => ({ ...i })),
      file_paths: [...job.file_paths],
    })
    // Sign reference photos + every item's proofs so the edit panel can show
    // thumbnails (the stored filenames are random — a preview tells them apart).
    const proofPaths = job.items.flatMap(it => [...itemProofs(it), ...itemRefPhotos(it), ...itemExamplePhotos(it)])
    const all = [...job.file_paths, ...proofPaths]
    if (all.length > 0) void loadFiles(job.id, all)
  }

  function cancelEdit() {
    setEditingJob(null)
    setEditForm(null)
  }

  async function saveEdit(jobId: number) {
    if (!editForm) return
    setSavingEdit(true)
    try {
      const res = await fetch(`/api/admin/jobs/${jobId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date_required: editForm.date_required,
          event_name: editForm.event_name || null,
          notes: editForm.notes || null,
          setup_location: editForm.setup_location || null,
          setup_time: editForm.setup_time || null,
          removal_location: editForm.removal_location || null,
          removal_time: editForm.removal_time || null,
          items: editForm.items,
          file_paths: editForm.file_paths,
        }),
      })
      if (res.ok) {
        setJobs(prev => prev.map(j => j.id === jobId ? {
          ...j,
          date_required: editForm.date_required,
          event_name: editForm.event_name || null,
          notes: editForm.notes || null,
          setup_location: editForm.setup_location || null,
          setup_time: editForm.setup_time || null,
          removal_location: editForm.removal_location || null,
          removal_time: editForm.removal_time || null,
          items: editForm.items,
          file_paths: editForm.file_paths,
        } : j))
        // clear cached file urls if files were removed
        setFileUrls(prev => {
          const next = { ...prev }
          if (next[jobId]) {
            next[jobId] = next[jobId].filter(f => editForm.file_paths.includes(f.path))
          }
          return next
        })
        cancelEdit()
      } else {
        alert('Failed to save changes — please try again.')
      }
    } catch {
      alert('Network error — changes not saved.')
    } finally {
      setSavingEdit(false)
    }
  }

  function updateEditItem(index: number, field: keyof JobItem, value: string | number) {
    if (!editForm) return
    setEditForm(prev => {
      if (!prev) return prev
      const items = [...prev.items]
      items[index] = { ...items[index], [field]: value }
      return { ...prev, items }
    })
  }

  function addEditItem() {
    if (!editForm) return
    setEditForm(prev => prev ? {
      ...prev,
      items: [...prev.items, { name: '', quantity: 1, size: '', material: 'vinyl' }],
    } : prev)
  }

  function removeEditItem(index: number) {
    if (!editForm) return
    setEditForm(prev => prev ? {
      ...prev,
      items: prev.items.filter((_, i) => i !== index),
    } : prev)
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
      const putRes = await fetch(signedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      })
      if (!putRes.ok) { setUploadPhotoError('Upload failed — please try again.'); return }
      setEditForm(prev => prev ? { ...prev, file_paths: [...prev.file_paths, path] } : prev)
    } catch {
      setUploadPhotoError('Network error during upload.')
    } finally {
      setUploadingPhoto(false)
    }
  }

  async function addProof(index: number, file: File) {
    if (!editForm) return
    setProofError('')
    setUploadingProof(index)
    try {
      const urlRes = await fetch('/api/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: [{ name: file.name, type: file.type, size: file.size }] }),
      })
      if (!urlRes.ok) {
        const { error } = await urlRes.json()
        setProofError(error ?? 'Could not get upload URL')
        return
      }
      const { uploads } = await urlRes.json()
      const { path, signedUrl } = uploads[0]
      const putRes = await fetch(signedUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file })
      if (!putRes.ok) { setProofError('Proof upload failed — please try again.'); return }
      // Adding a proof resets that item's approval — the proof set the client saw has changed.
      setEditForm(prev => {
        if (!prev) return prev
        const items = [...prev.items]
        const target = items[index]
        const cur = itemProofs(target)
        if (target.approval_status === 'changes_requested' && cur.length > 0) {
          // The client asked for changes — this upload is a NEW VERSION. The
          // design(s) they reviewed move to history; the new one becomes current.
          items[index] = {
            ...target,
            proof_history: [...(target.proof_history ?? []), ...cur],
            proof_urls: [path], proof_url: undefined,
            approval_status: 'pending', approved_proof_url: undefined,
            client_note: undefined, approved_at: undefined,
          }
        } else {
          // Still building the design set (first upload / alternatives) — append.
          items[index] = { ...target, proof_urls: [...cur, path], proof_url: undefined, approval_status: 'pending', approved_proof_url: undefined, client_note: undefined, approved_at: undefined }
        }
        return { ...prev, items }
      })
    } catch {
      setProofError('Network error during proof upload.')
    } finally {
      setUploadingProof(null)
    }
  }

  function removeProof(index: number, path: string) {
    setEditForm(prev => {
      if (!prev) return prev
      const items = [...prev.items]
      const cur = itemProofs(items[index]).filter(p => p !== path)
      items[index] = { ...items[index], proof_urls: cur, proof_url: undefined, approval_status: 'pending', approved_proof_url: undefined, client_note: undefined, approved_at: undefined }
      return { ...prev, items }
    })
  }

  // Example/inspiration photos the client sees alongside the proofs. Purely
  // informative — adding or removing one does NOT reset the item's approval.
  async function addExamplePhoto(index: number, file: File) {
    if (!editForm) return
    setExampleError('')
    setUploadingExample(index)
    try {
      const urlRes = await fetch('/api/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: [{ name: file.name, type: file.type, size: file.size }] }),
      })
      if (!urlRes.ok) {
        const { error } = await urlRes.json()
        setExampleError(error ?? 'Could not get upload URL')
        return
      }
      const { uploads } = await urlRes.json()
      const { path, signedUrl } = uploads[0]
      const putRes = await fetch(signedUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file })
      if (!putRes.ok) { setExampleError('Upload failed — please try again.'); return }
      setEditForm(prev => {
        if (!prev) return prev
        const items = [...prev.items]
        items[index] = { ...items[index], example_photos: [...itemExamplePhotos(items[index]), path] }
        return { ...prev, items }
      })
    } catch {
      setExampleError('Network error during upload.')
    } finally {
      setUploadingExample(null)
    }
  }

  function removeExamplePhoto(index: number, path: string) {
    setEditForm(prev => {
      if (!prev) return prev
      const items = [...prev.items]
      items[index] = { ...items[index], example_photos: itemExamplePhotos(items[index]).filter(p => p !== path) }
      return { ...prev, items }
    })
  }

  async function copyApprovalLink(jobId: number) {
    setCopyingLink(jobId)
    try {
      const res = await fetch(`/api/admin/jobs/${jobId}/review-link`)
      if (!res.ok) { alert('Could not generate the approval link — please try again.'); return }
      const { url } = await res.json()
      try {
        await navigator.clipboard.writeText(url)
        setCopiedLink(jobId)
        setTimeout(() => setCopiedLink(c => c === jobId ? null : c), 2500)
      } catch {
        // Clipboard blocked (e.g. insecure context) — show the link to copy manually.
        prompt('Copy this approval link to send to your client:', url)
      }
    } catch {
      alert('Network error — could not generate the link.')
    } finally {
      setCopyingLink(null)
    }
  }

  async function sendToCommandCentre(job: Job) {
    setSendingToCC(job.id)
    try {
      const res = await fetch('/api/admin/send-to-cc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: job.id }),
      })
      if (res.ok) {
        setSentToCC(prev => new Set(prev).add(job.id))
      } else {
        alert('Failed to send to Command Centre — please try again.')
      }
    } catch {
      alert('Network error — could not reach Command Centre.')
    } finally {
      setSendingToCC(null)
    }
  }

  // Manually re-push a job's approved items to the Command Centre Kanban board
  // (refreshes client notes / designs / specs) without re-approving an item.
  async function resyncToKanban(job: Job) {
    setResyncing(job.id)
    try {
      const res = await fetch(`/api/admin/jobs/${job.id}/resync`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.ok) {
        setResynced(prev => new Set(prev).add(job.id))
        setTimeout(() => setResynced(prev => { const n = new Set(prev); n.delete(job.id); return n }), 2500)
      } else {
        const reason = data?.reason
        alert(
          reason === 'none_approved'  ? 'No approved items to sync yet — approve a design first.' :
          reason === 'not_configured' ? 'Command Centre Kanban isn’t configured (missing webhook).' :
          reason === 'webhook_failed' ? 'Command Centre rejected the sync — please check the board.' :
          'Could not re-sync to Command Centre — please try again.'
        )
      }
    } catch {
      alert('Network error — could not reach Command Centre.')
    } finally {
      setResyncing(null)
    }
  }

  async function printJobTicket(job: Job) {
    const statusLabel   = STATUS_LABELS[job.status] ?? job.status
    const submittedDate = new Date(job.submitted_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' })
    const printDate     = new Date().toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    const BRAND = '#b8955a'

    const itemRows = job.items.map(item => `
      <tr>
        <td style="width:52px;text-align:center;font-size:22px;font-weight:900;color:${BRAND};border-bottom:1px solid #e8e8e8;padding:10px 8px;">${item.quantity}</td>
        <td style="font-weight:600;border-bottom:1px solid #e8e8e8;padding:10px 12px;">${escHtml(item.name)}${item.description ? `<div style="font-weight:400;font-size:11px;color:#777;margin-top:3px;line-height:1.5;">${escHtml(item.description)}</div>` : ''}</td>
        <td style="border-bottom:1px solid #e8e8e8;padding:10px 12px;color:#555;">${escHtml(item.size || '—')}</td>
        <td style="border-bottom:1px solid #e8e8e8;padding:10px 12px;color:#555;">${escHtml(item.material || '—')}</td>
      </tr>
    `).join('')

    const logRow = (label: string, loc?: string | null, time?: string | null) => (loc || time) ? `
        <div>
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#999;margin-bottom:2px;">${label}</div>
          <div style="font-size:14px;font-weight:600;">${escHtml([loc, time].filter(Boolean).join(' — '))}</div>
        </div>` : ''
    const logisticsSection = (job.setup_location || job.setup_time || job.removal_location || job.removal_time) ? `
      <div style="margin-bottom:24px;">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#999;border-bottom:1px solid #e8e8e8;padding-bottom:6px;margin-bottom:12px;">Setup &amp; Removal</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
          ${logRow('Setup', job.setup_location, job.setup_time)}
          ${logRow('Removal', job.removal_location, job.removal_time)}
        </div>
      </div>` : ''

    const notesSection = job.notes ? `
      <div style="margin-bottom:24px;">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#999;border-bottom:1px solid #e8e8e8;padding-bottom:6px;margin-bottom:10px;">Notes / Special Instructions</div>
        <div style="background:#fafafa;border-left:4px solid ${BRAND};padding:12px 16px;font-size:13px;line-height:1.6;color:#333;">${escHtml(job.notes)}</div>
      </div>` : ''

    const eventSection = job.event_name ? `
      <div>
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#999;margin-bottom:2px;">Event / Location</div>
        <div style="font-size:14px;font-weight:600;">${escHtml(job.event_name)}</div>
      </div>` : ''

    // Load reference photos if not already cached
    let resolvedFiles = fileUrls[job.id]
    if (!resolvedFiles && job.file_paths.length > 0) {
      resolvedFiles = await loadFiles(job.id, job.file_paths) ?? []
    }

    const imageSection = resolvedFiles && resolvedFiles.length > 0 ? `
      <div style="margin-bottom:24px;">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#999;border-bottom:1px solid #e8e8e8;padding-bottom:6px;margin-bottom:12px;">Reference Photos (${resolvedFiles.length})</div>
        <div style="display:flex;flex-wrap:wrap;gap:12px;">
          ${resolvedFiles.map(f => `
            <div style="text-align:center;">
              <img src="${f.url}" alt="${escHtml(f.name)}" style="max-width:200px;max-height:160px;object-fit:contain;border:1px solid #e8e8e8;display:block;" />
              <div style="font-size:10px;color:#999;margin-top:4px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(f.name)}</div>
            </div>
          `).join('')}
        </div>
      </div>` : ''

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Job Ticket — ${escHtml(job.reference_number)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #1a1a1a; background: #fff; padding: 32px; }
    table { width: 100%; border-collapse: collapse; }
    @media print {
      body { padding: 0; }
      @page { margin: 18mm 20mm; size: A4 portrait; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>
  <div class="no-print" style="margin-bottom:24px;display:flex;gap:10px;">
    <button onclick="window.print()" style="background:#1a1a1a;color:#fff;border:none;padding:10px 24px;font-size:13px;font-weight:700;cursor:pointer;letter-spacing:1px;text-transform:uppercase;">Print Ticket</button>
    <button onclick="window.close()" style="background:#fff;color:#1a1a1a;border:1px solid #ccc;padding:10px 24px;font-size:13px;cursor:pointer;">Close</button>
  </div>
  <div style="max-width:720px;margin:0 auto;">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #1a1a1a;padding-bottom:20px;margin-bottom:24px;">
      <div>
        <div style="font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#999;margin-bottom:4px;">DDF x Pixel</div>
        <div style="font-size:32px;font-weight:900;color:${BRAND};letter-spacing:1px;line-height:1;">${escHtml(job.reference_number)}</div>
        <div style="margin-top:8px;display:inline-block;padding:3px 10px;background:#1a1a1a;color:#fff;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">${escHtml(statusLabel)}</div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:22px;font-weight:900;letter-spacing:2px;text-transform:uppercase;color:#1a1a1a;">Job Ticket</div>
        <div style="font-size:12px;color:#666;margin-top:4px;">Submitted: ${submittedDate}</div>
      </div>
    </div>
    <div style="margin-bottom:24px;">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#999;border-bottom:1px solid #e8e8e8;padding-bottom:6px;margin-bottom:12px;">Client Information</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;">
        <div>
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#999;margin-bottom:2px;">Client Name</div>
          <div style="font-size:15px;font-weight:700;">${escHtml(job.client_name)}</div>
        </div>
        <div>
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#999;margin-bottom:2px;">Company</div>
          <div style="font-size:15px;font-weight:700;">${escHtml(job.company_name)}</div>
        </div>
        <div>
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#999;margin-bottom:2px;">Contact Email</div>
          <div style="font-size:13px;color:#555;">${escHtml(job.contact_email)}</div>
        </div>
        <div>
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#999;margin-bottom:2px;">Due Date</div>
          <div style="font-size:15px;font-weight:900;color:${BRAND};">${escHtml(job.date_required)}</div>
        </div>
        ${eventSection}
      </div>
    </div>
    <div style="margin-bottom:24px;">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#999;border-bottom:1px solid #e8e8e8;padding-bottom:6px;margin-bottom:0;">Items (${job.items.length})</div>
      <table>
        <thead>
          <tr>
            <th style="background:#1a1a1a;color:#fff;padding:9px 8px;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;text-align:center;width:52px;">Qty</th>
            <th style="background:#1a1a1a;color:#fff;padding:9px 12px;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;text-align:left;">Description</th>
            <th style="background:#1a1a1a;color:#fff;padding:9px 12px;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;text-align:left;">Size</th>
            <th style="background:#1a1a1a;color:#fff;padding:9px 12px;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;text-align:left;">Material</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>
    </div>
    ${logisticsSection}
    ${notesSection}
    ${imageSection}
    <div style="margin-top:32px;padding-top:12px;border-top:1px solid #e8e8e8;display:flex;justify-content:space-between;font-size:11px;color:#aaa;">
      <span>DDF x Pixel — Internal Job Ticket</span>
      <span>Printed: ${printDate}</span>
    </div>
  </div>
</body>
</html>`

    const win = window.open('', '_blank', 'width=800,height=900')
    if (!win) return
    win.document.write(html)
    win.document.close()
  }

  // Admin marks an item approved (or back to pending) for print — the team's call, not the client's.
  // For multi-design items the approved design is recorded (chosenProof), same as the client flow,
  // so admin- and client-approval write identical data.
  async function approveItem(job: Job, idx: number, approve: boolean, chosenProof?: string) {
    const key = `${job.id}:${idx}`
    setApprovingItem(key)
    let patch: Record<string, unknown>
    if (!approve) {
      patch = { approval_status: 'pending', approved_at: null }
    } else {
      const it = job.items[idx]
      const proofs = itemProofs(it)
      patch = {
        approval_status: 'approved',
        approved_at: new Date().toISOString(),
        approved_proof_url: chosenProof ?? (proofs.length === 1 ? proofs[0] : it.approved_proof_url) ?? null,
        client_note: null,
      }
    }
    try {
      const res = await fetch(`/api/admin/jobs/${job.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemPatch: { index: idx, patch } }),
      })
      if (res.ok) {
        const { items } = await res.json()
        setJobs(prev => prev.map(j => j.id === job.id ? { ...j, items } : j))
      } else alert('Failed to update approval — please try again.')
    } catch {
      alert('Network error — approval not saved.')
    } finally {
      setApprovingItem(null)
    }
  }

  // Post a reply from the shop into an item's conversation thread.
  async function sendReply(job: Job, idx: number) {
    const key = `${job.id}:${idx}`
    const text = (replyDraft[key] ?? '').trim()
    if (!text) return
    setSendingReply(key)
    const msg: ItemMessage = { from: 'shop', text, at: new Date().toISOString() }
    // Migrated items can append safely (concurrent-safe); legacy items without a
    // messages array get their thread seeded from itemThread() in the patch.
    const it = job.items[idx]
    const itemPatch = Array.isArray(it.messages)
      ? { index: idx, patch: {}, appendMessage: msg }
      : { index: idx, patch: { messages: [...itemThread(it), msg] } }
    try {
      const res = await fetch(`/api/admin/jobs/${job.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemPatch }),
      })
      if (res.ok) {
        const { items } = await res.json()
        setJobs(prev => prev.map(j => j.id === job.id ? { ...j, items } : j))
        setReplyDraft(prev => ({ ...prev, [key]: '' }))
      } else alert('Failed to send reply — please try again.')
    } catch {
      alert('Network error — reply not sent.')
    } finally {
      setSendingReply(null)
    }
  }

  // Upload a corrected design as the NEW version: the current proof(s) move to
  // history, the new one becomes what the client reviews, approval resets.
  async function uploadRevision(job: Job, idx: number, file: File) {
    const key = `${job.id}:${idx}`
    setRevisionError(prev => ({ ...prev, [key]: '' }))
    setUploadingRevision(key)
    try {
      const urlRes = await fetch('/api/upload-url', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: [{ name: file.name, type: file.type, size: file.size }] }),
      })
      if (!urlRes.ok) { setRevisionError(prev => ({ ...prev, [key]: 'Could not get upload URL' })); return }
      const { uploads } = await urlRes.json()
      const { path, signedUrl } = uploads[0]
      const putRes = await fetch(signedUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file })
      if (!putRes.ok) { setRevisionError(prev => ({ ...prev, [key]: 'Upload failed — please try again.' })); return }

      const sys: ItemMessage = { from: 'shop', text: 'Uploaded a revised design — please review.', at: new Date().toISOString() }
      const it = job.items[idx]
      const archived = [...(it.proof_history ?? []), ...itemProofs(it)]   // old version(s) → history
      const basePatch: Record<string, unknown> = {
        proof_history: archived,
        proof_urls: [path], proof_url: null,
        approval_status: 'pending', approved_proof_url: null,
        approved_at: null, client_note: null,
      }
      const itemPatch = Array.isArray(it.messages)
        ? { index: idx, patch: basePatch, appendMessage: sys }
        : { index: idx, patch: { ...basePatch, messages: [...itemThread(it), sys] } }
      const res = await fetch(`/api/admin/jobs/${job.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemPatch }),
      })
      if (res.ok) {
        const { items } = await res.json()
        setJobs(prev => prev.map(j => j.id === job.id ? { ...j, items } : j))
      } else setRevisionError(prev => ({ ...prev, [key]: 'Could not save the new version.' }))
    } catch {
      setRevisionError(prev => ({ ...prev, [key]: 'Network error during upload.' }))
    } finally {
      setUploadingRevision(null)
    }
  }

  async function printApprovedSheet(job: Job) {
    const CORAL = '#ff4d2d'
    const printDate = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    const createdDate = new Date(job.submitted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

    const proofItems = job.items.filter(i => itemProofs(i).length > 0)
    const approved = job.items
      .map((it, i) => ({ it, i }))
      .filter(x => itemProofs(x.it).length > 0 && x.it.approval_status === 'approved')
    const total = proofItems.length
    const isFull = approved.length === total

    const paths = approved.flatMap(x => approvedProofs(x.it))
    const urlMap: Record<string, string> = {}
    if (paths.length) {
      try {
        const res = await fetch('/api/admin/files', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paths }),
        })
        if (res.ok) {
          const { urls } = await res.json() as { urls: { path: string; url: string }[] }
          urls.forEach(u => { urlMap[u.path] = u.url })
        }
      } catch { /* images just won't render */ }
    }

    // Group approved proofs by the event-date prefix in the item name
    // ("June 15 - Welcome Sign" → "June 15"); compact 2-up grid per date.
    type Cell = { label: string; short: string; size: string; qty: number; path: string; pi: number; total: number; when: string }
    const allCells: Cell[] = []
    approved.forEach(({ it }) => {
      const proofs = approvedProofs(it)
      const { label, short } = parseItemDate(it.name)
      const when = it.approved_at
        ? new Date(it.approved_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : ''
      proofs.forEach((p, pi) => allCells.push({ label, short, size: it.size, qty: it.quantity, path: p, pi, total: proofs.length, when }))
    })

    const renderCell = (c: Cell) => {
      const u = urlMap[c.path]
      const cap = `${c.qty}× ${c.short}${c.size ? ' · ' + c.size : ''}${c.total > 1 ? ` (${c.pi + 1}/${c.total})` : ''}`
      return `
        <div style="page-break-inside:avoid;border:1px solid #e8e8e8;">
          ${u
            ? `<img src="${u}" alt="${escHtml(c.short)}" style="width:100%;height:240px;object-fit:contain;display:block;background:#fafafa;border-bottom:1px solid #eee;" />`
            : `<div style="height:240px;display:flex;align-items:center;justify-content:center;color:#aaa;font-size:12px;">Image unavailable</div>`}
          <div style="padding:7px 10px;display:flex;justify-content:space-between;align-items:baseline;gap:8px;">
            <span style="font-size:11px;font-weight:700;line-height:1.3;">${escHtml(cap)}</span>
            <span style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#1B7F4F;white-space:nowrap;">✓${c.when ? ' ' + c.when : ''}</span>
          </div>
        </div>`
    }
    const grid = (cells: Cell[]) => `<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">${cells.map(renderCell).join('')}</div>`

    const labels = [...new Set(allCells.map(c => c.label))].sort((a, b) => dateSortKey(a) - dateSortKey(b) || a.localeCompare(b))
    const onlyUnlabeled = labels.length <= 1 && (labels[0] ?? '') === ''
    const itemBlocks = allCells.length === 0
      ? ''
      : onlyUnlabeled
        ? grid(allCells)
        : labels.map(lab => {
            const cells = allCells.filter(c => c.label === lab)
            return `
              <div style="margin-bottom:18px;page-break-inside:avoid;break-inside:avoid;">
                <div style="display:flex;justify-content:space-between;align-items:baseline;border-bottom:1px solid #ddd;padding-bottom:4px;margin-bottom:12px;">
                  <span style="font-size:14px;font-weight:800;">${escHtml(lab || 'Other')}</span>
                  <span style="font-size:10px;color:#999;text-transform:uppercase;letter-spacing:1px;">${cells.length} design${cells.length !== 1 ? 's' : ''}</span>
                </div>
                ${grid(cells)}
              </div>`
          }).join('')

    const cell = (label: string, value: string, strong = false) =>
      `<td style="padding:14px 16px;border:1px solid #ececec;vertical-align:top;">
        <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#aaa;margin-bottom:4px;">${label}</div>
        <div style="font-size:14px;font-weight:${strong ? 800 : 600};color:${strong ? '#1a1a1a' : '#333'};">${value || '—'}</div>
      </td>`

    const statusPill = isFull
      ? `<span style="display:inline-block;padding:4px 12px;background:#eef7f3;color:#1B7F4F;border:1px solid #1B7F4F33;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;">Fully Approved</span>`
      : `<span style="display:inline-block;padding:4px 12px;background:#fff7ed;color:#b06a00;border:1px solid #b06a0033;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;">Partial · ${approved.length} of ${total} approved</span>`

    const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8" /><title>Approved Designs — ${escHtml(job.reference_number)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #1a1a1a; background: #fff; padding: 32px; }
  table { width: 100%; border-collapse: collapse; }
  @media print { body { padding: 0; } @page { margin: 14mm 16mm; size: A4 portrait; } .no-print { display: none !important; } }
</style></head>
<body>
  <div class="no-print" style="margin-bottom:24px;display:flex;gap:10px;align-items:center;">
    <button id="printBtn" onclick="printWhenReady()" style="background:#1a1a1a;color:#fff;border:none;padding:10px 24px;font-size:13px;font-weight:700;cursor:pointer;letter-spacing:1px;text-transform:uppercase;">Print</button>
    <button onclick="window.close()" style="background:#fff;color:#1a1a1a;border:1px solid #ccc;padding:10px 24px;font-size:13px;cursor:pointer;">Close</button>
    <span id="loadNote" style="font-size:12px;color:#999;"></span>
  </div>
  <div style="max-width:760px;margin:0 auto;">

    <!-- Header -->
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;">
      <div>
        <div style="font-size:22px;font-weight:900;letter-spacing:1px;color:#1a1a1a;">DDF <span style="font-weight:400;">X</span> PIXEL</div>
        <div style="font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#999;margin-top:2px;">Approved Designs</div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:22px;font-weight:900;letter-spacing:0.5px;color:#1a1a1a;">#${escHtml(job.reference_number)}</div>
        <div style="font-size:11px;color:#888;margin-top:4px;">Printed ${escHtml(printDate)}</div>
        <div style="font-size:11px;color:#888;">Created ${escHtml(createdDate)}</div>
      </div>
    </div>

    <!-- Accent bar -->
    <div style="display:flex;height:4px;margin-bottom:22px;">
      <div style="width:76px;background:${CORAL};"></div>
      <div style="flex:1;background:#1a1a1a;"></div>
    </div>

    <!-- Title + status -->
    <h1 style="font-size:26px;font-weight:800;line-height:1.15;margin-bottom:12px;">${escHtml(job.event_name || job.reference_number)}</h1>
    <div style="margin-bottom:22px;">${statusPill}</div>

    <!-- Job details -->
    <div style="font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#999;margin-bottom:8px;">Job Details</div>
    <table style="margin-bottom:26px;">
      <tr>
        ${cell('Client Name', escHtml(job.client_name))}
        ${cell('Client Contact', escHtml(job.contact_email))}
        ${cell('Due Date', escHtml(job.date_required), true)}
      </tr>
      <tr>
        ${cell('Company', escHtml(job.company_name))}
        ${cell('Event / Location', job.event_name ? escHtml(job.event_name) : '—')}
        ${cell('Approved', `${approved.length} of ${total} items`, true)}
      </tr>
    </table>

    ${(job.setup_location || job.setup_time || job.removal_location || job.removal_time) ? `
    <!-- Setup & removal -->
    <div style="font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#999;margin-bottom:8px;">Setup &amp; Removal</div>
    <table style="margin-bottom:26px;">
      <tr>
        ${cell('Setup', escHtml([job.setup_location, job.setup_time].filter(Boolean).join(' — ') || '—'), true)}
        ${cell('Removal', escHtml([job.removal_location, job.removal_time].filter(Boolean).join(' — ') || '—'), true)}
      </tr>
    </table>` : ''}

    <!-- Approved designs -->
    <div style="font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#999;border-bottom:1px solid #e8e8e8;padding-bottom:6px;margin-bottom:16px;">
      Approved Designs (${approved.length})${!isFull ? ' — partial; remaining items still awaiting client approval' : ''}
    </div>
    ${itemBlocks || '<p style="color:#aaa;">No approved designs yet.</p>'}

    <!-- Footer -->
    <div style="margin-top:24px;padding-top:12px;border-top:1px solid #e8e8e8;display:flex;justify-content:space-between;font-size:11px;color:#aaa;">
      <span>DDF x Pixel — hello@ddfevents.ca</span>
      <span>1 of 1</span>
    </div>
  </div>
  <script>
    function printWhenReady(){
      var imgs = Array.prototype.slice.call(document.images);
      var pending = imgs.filter(function(i){ return !i.complete; });
      if(pending.length===0){ window.print(); return; }
      var btn=document.getElementById('printBtn'), note=document.getElementById('loadNote');
      if(btn) btn.disabled=true;
      var left=pending.length;
      if(note) note.textContent='Loading designs… ('+left+' left)';
      function done(){ left--; if(note) note.textContent = left>0 ? ('Loading designs… ('+left+' left)') : ''; if(left<=0){ if(btn) btn.disabled=false; window.print(); } }
      pending.forEach(function(i){ i.addEventListener('load',done); i.addEventListener('error',done); });
    }
  </script>
</body></html>`

    const win = window.open('', '_blank', 'width=820,height=900')
    if (!win) return
    win.document.write(html)
    win.document.close()
  }

  // Cross-job production sheet: every approved design across active jobs,
  // grouped by event (due) date, each date starting a new page.
  async function printProductionSheet() {
    setBuildingProdSheet(true)
    try {
      type Entry = { group: string; jobRef: string; event: string | null; qty: number; short: string; size: string; path: string }
      const entries: Entry[] = []
      for (const job of jobs) {
        if (job.status === 'completed' || job.status === 'cancelled') continue
        for (const it of job.items) {
          if (it.approval_status !== 'approved') continue
          const { label, short } = parseItemDate(it.name)
          const group = label || new Date(job.date_required + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
          for (const path of approvedProofs(it)) {
            entries.push({ group, jobRef: job.reference_number, event: job.event_name, qty: it.quantity, short, size: it.size, path })
          }
        }
      }
      if (entries.length === 0) { alert('No approved designs to print yet.'); return }

      const paths = [...new Set(entries.map(e => e.path))]
      const urlMap: Record<string, string> = {}
      try {
        const res = await fetch('/api/admin/files', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paths }) })
        if (res.ok) { const { urls } = await res.json() as { urls: { path: string; url: string }[] }; urls.forEach(u => { urlMap[u.path] = u.url }) }
      } catch { /* images just won't render */ }

      const byDate = new Map<string, Entry[]>()
      for (const e of entries) { const a = byDate.get(e.group) ?? []; a.push(e); byDate.set(e.group, a) }
      const groups = [...byDate.keys()].sort((a, b) => dateSortKey(a) - dateSortKey(b) || a.localeCompare(b))

      const sections = groups.map((g, gi) => {
        const list = byDate.get(g)!
        const cells = list.map(e => {
          const u = urlMap[e.path]
          return `
            <div style="page-break-inside:avoid;border:1px solid #e8e8e8;">
              ${u
                ? `<img src="${u}" alt="${escHtml(e.short)}" style="width:100%;height:230px;object-fit:contain;display:block;background:#fafafa;border-bottom:1px solid #eee;" />`
                : `<div style="height:230px;display:flex;align-items:center;justify-content:center;color:#aaa;font-size:12px;">Image unavailable</div>`}
              <div style="padding:7px 10px;">
                <div style="font-size:11px;font-weight:700;line-height:1.3;">${escHtml(e.qty + '× ' + e.short)}${e.size ? `<span style="font-weight:400;color:#888;"> · ${escHtml(e.size)}</span>` : ''}</div>
                <div style="font-size:9px;color:#999;margin-top:2px;">${escHtml(e.jobRef)}${e.event ? ' · ' + escHtml(e.event) : ''}</div>
              </div>
            </div>`
        }).join('')
        return `
          <section style="${gi > 0 ? 'page-break-before:always;' : ''}">
            <div style="display:flex;justify-content:space-between;align-items:baseline;border-bottom:2px solid #1a1a1a;padding-bottom:6px;margin:0 0 14px;">
              <span style="font-size:18px;font-weight:800;">${escHtml(g)}</span>
              <span style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;white-space:nowrap;">${list.length} design${list.length !== 1 ? 's' : ''}</span>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">${cells}</div>
          </section>`
      }).join('')

      const CORAL = '#ff4d2d'
      const printDate = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
      const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8" /><title>Production Sheet — Approved Designs by Date</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #1a1a1a; background: #fff; padding: 32px; }
  section { margin-bottom: 24px; }
  @media print { body { padding: 0; } @page { margin: 14mm 16mm; size: A4 portrait; } .no-print { display: none !important; } }
</style></head>
<body>
  <div class="no-print" style="margin-bottom:24px;display:flex;gap:10px;align-items:center;">
    <button id="printBtn" onclick="printWhenReady()" style="background:#1a1a1a;color:#fff;border:none;padding:10px 24px;font-size:13px;font-weight:700;cursor:pointer;letter-spacing:1px;text-transform:uppercase;">Print</button>
    <button onclick="window.close()" style="background:#fff;color:#1a1a1a;border:1px solid #ccc;padding:10px 24px;font-size:13px;cursor:pointer;">Close</button>
    <span id="loadNote" style="font-size:12px;color:#999;"></span>
  </div>
  <div style="max-width:760px;margin:0 auto;">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;">
      <div>
        <div style="font-size:22px;font-weight:900;letter-spacing:1px;">DDF <span style="font-weight:400;">X</span> PIXEL</div>
        <div style="font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#999;margin-top:2px;">Production Sheet · Approved designs by date</div>
      </div>
      <div style="text-align:right;font-size:11px;color:#888;">
        <div>Printed ${escHtml(printDate)}</div>
        <div>${entries.length} design${entries.length !== 1 ? 's' : ''} · ${groups.length} date${groups.length !== 1 ? 's' : ''}</div>
      </div>
    </div>
    <div style="display:flex;height:4px;margin-bottom:22px;"><div style="width:76px;background:${CORAL};"></div><div style="flex:1;background:#1a1a1a;"></div></div>
    ${sections}
    <div style="margin-top:24px;padding-top:12px;border-top:1px solid #e8e8e8;display:flex;justify-content:space-between;font-size:11px;color:#aaa;">
      <span>DDF x Pixel — hello@ddfevents.ca</span>
      <span>Approved for print</span>
    </div>
  </div>
  <script>
    function printWhenReady(){
      var imgs = Array.prototype.slice.call(document.images);
      var pending = imgs.filter(function(i){ return !i.complete; });
      if(pending.length===0){ window.print(); return; }
      var btn=document.getElementById('printBtn'), note=document.getElementById('loadNote');
      if(btn) btn.disabled=true;
      var left=pending.length;
      if(note) note.textContent='Loading designs… ('+left+' left)';
      function done(){ left--; if(note) note.textContent = left>0 ? ('Loading designs… ('+left+' left)') : ''; if(left<=0){ if(btn) btn.disabled=false; window.print(); } }
      pending.forEach(function(i){ i.addEventListener('load',done); i.addEventListener('error',done); });
    }
  </script>
</body></html>`

      const win = window.open('', '_blank', 'width=820,height=900')
      if (!win) return
      win.document.write(html)
      win.document.close()
    } finally {
      setBuildingProdSheet(false)
    }
  }

  async function signOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  const filtered = useMemo(() => {
    const byStatus = filter === 'all' ? jobs : jobs.filter(j => j.status === filter)
    const q = search.trim().toLowerCase()
    if (!q) return byStatus
    return byStatus.filter(j =>
      [j.client_name, j.company_name, j.reference_number, j.event_name, j.contact_email]
        .some(v => v && String(v).toLowerCase().includes(q))
    )
  }, [jobs, filter, search])

  const statCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    STATUSES.forEach(s => { counts[s] = jobs.filter(j => j.status === s).length })
    return counts
  }, [jobs])

  // Keep the conversation drawer scrolled to the newest message.
  useEffect(() => {
    if (chatItem && chatBodyRef.current) chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight
  }, [chatItem, jobs])

  return (
    <main style={{ minHeight: '100vh', background: '#f2f1ef', fontFamily: 'var(--font-body)' }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .stat-btn:hover { opacity: 0.85; }
        .filter-btn:hover { background: #f5f5f5 !important; }
        .job-action-btn:hover:not(:disabled) { filter: brightness(0.95); }
        .invoice-btn:hover:not(:disabled) { background: #dcfce7 !important; }
        .file-link:hover { opacity: 0.8; }
        .job-head:hover { background: #fcfbf9; }
        .job-search:focus { outline: none; border-color: var(--coral); box-shadow: 0 0 0 3px var(--coral)22; }
        @media (max-width: 640px) {
          .admin-wrap { padding: 18px 14px 56px !important; }
          .stats-grid { grid-template-columns: repeat(5, 1fr) !important; gap: 4px !important; }
          .stats-grid .stat-num { font-size: 20px !important; }
          .stats-grid .stat-lbl { font-size: 8px !important; letter-spacing: 1px !important; }
          .filter-row { justify-content: flex-start !important; }
        }
        @keyframes chatIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        .chat-backdrop { position: fixed; inset: 0; background: rgba(20,18,16,0.45); z-index: 200; animation: fadeIn 0.2s ease; }
        .chat-drawer { position: fixed; top: 0; right: 0; height: 100dvh; width: 420px; max-width: 100%; background: #faf9f7; z-index: 201; display: flex; flex-direction: column; box-shadow: -10px 0 30px rgba(0,0,0,0.18); animation: chatIn 0.22s ease; }
        .chat-head { background: #131313; color: #fff; padding: 14px 16px; display: flex; align-items: center; justify-content: space-between; gap: 10px; border-bottom: 2px solid var(--coral); flex-shrink: 0; }
        .chat-head-title { font-weight: 700; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .chat-head-sub { font-size: 11px; color: #b9b4ad; margin-top: 2px; }
        .chat-close { background: rgba(255,255,255,0.14); color: #fff; border: none; width: 32px; height: 32px; border-radius: 50%; font-size: 14px; cursor: pointer; flex-shrink: 0; }
        .chat-body { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
        .chat-empty { text-align: center; color: #888; font-size: 13.5px; line-height: 1.6; margin: auto 0; padding: 24px; }
        .chat-row { display: flex; flex-direction: column; max-width: 84%; }
        .chat-row.me { align-self: flex-end; align-items: flex-end; }
        .chat-row.them { align-self: flex-start; align-items: flex-start; }
        .chat-bubble { padding: 9px 13px; border-radius: 16px; font-size: 14px; line-height: 1.45; white-space: pre-wrap; word-break: break-word; }
        .chat-row.me .chat-bubble { background: #131313; color: #fff; border-bottom-right-radius: 4px; }
        .chat-row.them .chat-bubble { background: #fff; color: #2a2a2a; border: 1px solid #e6e3dc; border-bottom-left-radius: 4px; }
        .chat-meta { font-size: 10.5px; color: #999; margin-top: 4px; padding: 0 4px; }
        .chat-foot { border-top: 1px solid #e6e3dc; padding: 12px; padding-bottom: calc(12px + env(safe-area-inset-bottom)); background: #fff; flex-shrink: 0; }
        .chat-compose { display: flex; gap: 8px; align-items: flex-end; }
        .chat-input { flex: 1; padding: 10px 14px; border: 1px solid #d8d5cd; border-radius: 20px; font-size: 15px; font-family: var(--font-body); resize: none; max-height: 120px; box-sizing: border-box; outline: none; }
        .chat-input:focus { border-color: var(--coral); }
        .chat-send { background: var(--coral); color: #fff; border: none; border-radius: 20px; padding: 11px 18px; font-weight: 700; font-size: 14px; cursor: pointer; font-family: var(--font-body); flex-shrink: 0; }
        .chat-send:disabled { opacity: 0.5; cursor: default; }
        .chat-revise { display: flex; align-items: center; justify-content: center; gap: 7px; width: 100%; margin-top: 10px; padding: 11px; border: 1px dashed #d6a85e; border-radius: 6px; background: #fff8ef; color: #9a6a00; font-size: 13px; font-weight: 700; cursor: pointer; font-family: var(--font-body); }
        .chat-err { font-size: 12px; color: #dc2626; margin-bottom: 6px; }
        @media (max-width: 560px) { .chat-drawer { width: 100%; } }
      `}</style>

      {/* Header */}
      <header style={{
        background: '#1a1a1a',
        height: 54,
        padding: '0 28px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: '2px solid var(--coral)',
        position: 'sticky',
        top: 0,
        zIndex: 50,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <img src="/logo-ddfpixel.png" alt="DDF x Pixel" style={{ height: 30, width: 'auto', filter: 'brightness(0) invert(1)' }} />
          <span style={{ fontSize: 9, background: 'var(--coral)', color: '#fff', padding: '2px 7px', fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase' }}>
            ADMIN
          </span>
        </div>
        <button
          onClick={signOut}
          style={{ background: 'none', border: '1px solid #3a3a3a', color: '#777', padding: '5px 14px', fontSize: 11, cursor: 'pointer', fontFamily: 'var(--font-body)', letterSpacing: '0.5px' }}
        >
          Sign out
        </button>
      </header>

      <div className="admin-wrap" style={{ maxWidth: 1140, margin: '0 auto', padding: '28px 24px 64px' }}>

        {/* Page title */}
        <div style={{ marginBottom: 24, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <p style={{ margin: '0 0 4px', fontSize: 10, fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--coral)' }}>
              DDF x Pixel
            </p>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, fontFamily: 'var(--font-heading)', textTransform: 'uppercase', letterSpacing: '0.5px', color: '#1a1a1a' }}>
              Job Dashboard
            </h1>
          </div>
          <button
            onClick={printProductionSheet}
            disabled={buildingProdSheet}
            title="Print all approved designs across jobs, grouped by event date"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, padding: '9px 16px', background: '#1a1a1a', color: '#fff', border: 'none', cursor: buildingProdSheet ? 'default' : 'pointer', opacity: buildingProdSheet ? 0.6 : 1, fontFamily: 'var(--font-body)', letterSpacing: '0.5px', textTransform: 'uppercase' }}
          >
            <PrintIcon /> {buildingProdSheet ? 'Building…' : 'Production Sheet'}
          </button>
        </div>

        {/* ── Loading ────────────────────────────────────────────────────────── */}
        {loading ? (
          <div style={{ padding: '80px 0', textAlign: 'center' }}>
            <div style={{ width: 32, height: 32, border: '3px solid #e0e0e0', borderTopColor: 'var(--coral)', borderRadius: '50%', margin: '0 auto 14px', animation: 'spin 0.8s linear infinite' }} />
            <p style={{ color: '#999', fontSize: 13, margin: 0 }}>Loading jobs…</p>
          </div>

        ) : loadError ? (
          <div style={{ background: '#fff0f0', border: '1px solid #fca5a5', padding: '14px 18px', color: '#b91c1c', fontSize: 13 }}>
            {loadError}
          </div>

        ) : (
          <>
            {/* ── Stats bar ───────────────────────────────────────────────────── */}
            <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6, marginBottom: 24 }}>
              {STATUSES.map(s => (
                <button
                  key={s}
                  className="stat-btn"
                  onClick={() => setFilter(prev => prev === s ? 'all' : s)}
                  style={{
                    background: filter === s ? STATUS_CONFIG[s].bg : '#fff',
                    border: `1px solid ${filter === s ? STATUS_CONFIG[s].color + '55' : '#e0e0e0'}`,
                    borderTop: `3px solid ${STATUS_CONFIG[s].color}`,
                    padding: '14px 14px 12px',
                    textAlign: 'left',
                    cursor: 'pointer',
                    fontFamily: 'var(--font-body)',
                    transition: 'opacity 0.15s',
                  }}
                >
                  <div className="stat-num" style={{ fontSize: 26, fontWeight: 800, fontFamily: 'var(--font-heading)', color: STATUS_CONFIG[s].color, lineHeight: 1, letterSpacing: '-0.5px' }}>
                    {statCounts[s] ?? 0}
                  </div>
                  <div className="stat-lbl" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase', color: '#999', marginTop: 5 }}>
                    {STATUS_LABELS[s]}
                  </div>
                </button>
              ))}
            </div>

            {/* ── Search ──────────────────────────────────────────────────────── */}
            <div style={{ position: 'relative', marginBottom: 12 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#aaa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
                <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
              </svg>
              <input
                type="search"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search client, company, ref or event…"
                aria-label="Search jobs"
                className="job-search"
                style={{ width: '100%', boxSizing: 'border-box', height: 44, padding: '0 14px 0 38px', fontSize: 14, border: '1px solid #ddd', background: '#fff', fontFamily: 'var(--font-body)', color: '#1a1a1a' }}
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  aria-label="Clear search"
                  style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#999', fontSize: 18, lineHeight: 1, cursor: 'pointer', padding: 6 }}
                >×</button>
              )}
            </div>

            {/* ── Toolbar ─────────────────────────────────────────────────────── */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
              <p style={{ margin: 0, fontSize: 12, color: '#999' }}>
                {search
                  ? `${filtered.length} match${filtered.length !== 1 ? 'es' : ''}`
                  : filter === 'all'
                    ? `${jobs.length} job${jobs.length !== 1 ? 's' : ''} total`
                    : `${filtered.length} ${STATUS_LABELS[filter]?.toLowerCase()}`}
              </p>
              <div className="filter-row" style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                {(['all', ...STATUSES] as string[]).map(s => (
                  <button
                    key={s}
                    className="filter-btn"
                    onClick={() => setFilter(s)}
                    style={{
                      padding: '4px 11px',
                      fontSize: 11,
                      fontWeight: filter === s ? 700 : 500,
                      background: filter === s ? '#1a1a1a' : '#fff',
                      color: filter === s ? '#fff' : '#666',
                      border: `1px solid ${filter === s ? '#1a1a1a' : '#ddd'}`,
                      cursor: 'pointer',
                      fontFamily: 'var(--font-body)',
                      letterSpacing: '0.3px',
                    }}
                  >
                    {s === 'all' ? 'All' : STATUS_LABELS[s]}
                  </button>
                ))}
              </div>
            </div>

            {/* ── Empty state ──────────────────────────────────────────────────── */}
            {filtered.length === 0 ? (
              <div style={{ background: '#fff', border: '1px solid #e0e0e0', padding: '48px 32px', textAlign: 'center', color: '#aaa', fontSize: 13 }}>
                {search
                  ? `No jobs match “${search}”.`
                  : `No ${filter !== 'all' ? STATUS_LABELS[filter]?.toLowerCase() + ' ' : ''}jobs.`}
              </div>
            ) : (

              /* ── Job list ──────────────────────────────────────────────────── */
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {filtered.map(job => {
                  const proofed = job.items.filter(it => itemProofs(it).length > 0)
                  const approvedCount = proofed.filter(it => it.approval_status === 'approved').length
                  // "Needs attention": a proof is attached but not yet approved, or the client asked for changes.
                  const needsAttention = proofed.some(it =>
                    it.approval_status === 'changes_requested' ||
                    !it.approval_status || it.approval_status === 'pending'
                  )
                  // Always start collapsed — the amber dot still flags jobs that need attention.
                  const baseOpen = job.id in openOverride ? openOverride[job.id] : false
                  const open = baseOpen || editingJob === job.id
                  return (
                  <div
                    key={job.id}
                    style={{
                      background: '#fff',
                      border: '1px solid #e0e0e0',
                      borderLeft: `4px solid ${STATUS_COLORS[job.status] ?? '#ccc'}`,
                    }}
                  >
                    {/* Card top: identity + date — click to expand/collapse */}
                    <div
                      className="job-head"
                      onClick={() => setOpenOverride(prev => ({ ...prev, [job.id]: !open }))}
                      style={{ padding: '15px 18px 13px', borderBottom: open ? '1px solid #f2f2f2' : 'none', cursor: 'pointer' }}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          {/* Ref + status + file badge */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5, flexWrap: 'wrap' }}>
                            <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 14, color: 'var(--coral)', letterSpacing: '0.5px' }}>
                              {job.reference_number}
                            </span>
                            <StatusPill status={job.status} />
                            {job.file_paths.length > 0 && (
                              <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.8px', color: '#999', background: '#f5f5f5', border: '1px solid #e0e0e0', padding: '1px 6px' }}>
                                {job.file_paths.length} FILE{job.file_paths.length !== 1 ? 'S' : ''}
                              </span>
                            )}
                            {proofed.length > 0 && (
                              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.6px', textTransform: 'uppercase', padding: '1px 7px', border: '1px solid', color: approvedCount === proofed.length ? '#15803d' : '#9a6a00', background: approvedCount === proofed.length ? '#dcfce7' : '#fff7e6', borderColor: approvedCount === proofed.length ? '#86efac' : '#f0d28a' }}>
                                {approvedCount}/{proofed.length} approved
                              </span>
                            )}
                          </div>
                          {/* Client name + company */}
                          <p style={{ margin: '0 0 3px', fontWeight: 700, fontSize: 14, color: '#1a1a1a' }}>
                            {job.client_name}
                            {job.company_name && (
                              <span style={{ fontWeight: 400, color: '#888', fontSize: 13 }}> — {job.company_name}</span>
                            )}
                          </p>
                          {/* Meta row */}
                          <div style={{ fontSize: 12, color: '#999', display: 'flex', flexWrap: 'wrap', columnGap: 14, rowGap: 2, marginTop: 1 }}>
                            <a href={`mailto:${job.contact_email}`} onClick={e => e.stopPropagation()} style={{ color: '#999', textDecoration: 'none' }}>
                              {job.contact_email}
                            </a>
                            <span>
                              Due&nbsp;
                              <strong style={{ color: '#1a1a1a', fontWeight: 700 }}>{job.date_required}</strong>
                            </span>
                            {job.event_name && <span>{job.event_name}</span>}
                          </div>
                        </div>
                        {/* Submitted date + expand chevron */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, paddingTop: 1 }}>
                          {!open && needsAttention && (
                            <span title="Needs attention" aria-label="Needs attention" style={{ width: 7, height: 7, borderRadius: '50%', background: '#C8702A', display: 'inline-block' }} />
                          )}
                          <span style={{ fontSize: 11, color: '#bbb', whiteSpace: 'nowrap' }}>
                            {new Date(job.submitted_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })}
                          </span>
                          <button
                            onClick={e => { e.stopPropagation(); setOpenOverride(prev => ({ ...prev, [job.id]: !open })) }}
                            aria-label={open ? 'Collapse job' : 'Expand job'}
                            aria-expanded={open}
                            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, background: 'none', border: 'none', cursor: 'pointer', color: '#999', flexShrink: 0 }}
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.18s' }}>
                              <path d="m6 9 6 6 6-6" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    </div>
                    {open && (<>


                    {/* Items */}
                    <div style={{ padding: '10px 18px', borderBottom: '1px solid #f2f2f2', display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {job.items.map((item, i) => {
                        const refs = itemRefPhotos(item)
                        return (
                        <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 12, color: '#444' }}>
                            <span style={{ background: '#f8f7f5', border: '1px solid #eaeaea', padding: '3px 9px' }}>
                              <strong style={{ color: 'var(--coral)', marginRight: 2 }}>{item.quantity}×</strong>
                              {item.name}
                              {item.size     && <span style={{ color: '#999' }}> · {item.size}</span>}
                              {item.material && <span style={{ color: '#bbb' }}> · {item.material}</span>}
                            </span>
                            {refs.length > 0 && (() => {
                              const key = `${job.id}:${i}`
                              const isOpen = openRefs === key
                              return (
                                <button
                                  onClick={() => {
                                    if (isOpen) { setOpenRefs(null); return }
                                    void loadFiles(job.id, refs)
                                    setOpenRefs(key)
                                  }}
                                  title={`${refs.length} client reference photo${refs.length > 1 ? 's' : ''} — click to view`}
                                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, color: isOpen ? '#fff' : '#5a8a6f', background: isOpen ? '#5a8a6f' : '#f0fbf4', border: '1px solid #cfe9d8', borderRadius: 4, padding: '2px 7px', cursor: 'pointer', fontFamily: 'var(--font-body)' }}
                                >📎 {refs.length}</button>
                              )
                            })()}
                            {itemProofs(item).length > 0 && (
                              item.approval_status && item.approval_status !== 'pending'
                                ? <ApprovalPill status={item.approval_status} />
                                : <span title="Proof attached — not yet approved for print" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.6px', color: '#888', background: '#f0f0f0', border: '1px solid #ddd', padding: '1px 6px', textTransform: 'uppercase' }}>Awaiting Approval</span>
                            )}
                          </span>
                          {refs.length > 0 && openRefs === `${job.id}:${i}` && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, paddingLeft: 2, marginTop: 4 }}>
                              {refs.map(p => {
                                const signed = fileUrls[job.id]?.find(f => f.path === p)
                                return signed ? (
                                  <a key={p} href={signed.url} target="_blank" rel="noopener noreferrer" title={`Open ${signed.name}`} style={{ display: 'block', width: 64, height: 64 }}>
                                    <img src={signed.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', border: '1px solid #cfe9d8', borderRadius: 6, display: 'block' }} />
                                  </a>
                                ) : (
                                  <span key={p} style={{ width: 64, height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f4f2', border: '1px solid #e7e5e1', borderRadius: 6, color: '#bbb', fontSize: 11 }}>
                                    {fileError === job.id ? '!' : loadingFiles === job.id ? '…' : '·'}
                                  </span>
                                )
                              })}
                            </div>
                          )}
                          {item.description && <span style={{ fontSize: 11.5, color: '#777', lineHeight: 1.4, paddingLeft: 2 }}>{item.description}</span>}
                        </div>
                        )
                      })}
                    </div>

                    {/* Setup / removal logistics */}
                    {(job.setup_location || job.setup_time || job.removal_location || job.removal_time) && (
                      <div style={{ padding: '10px 18px', borderBottom: '1px solid #f2f2f2', display: 'flex', flexWrap: 'wrap', gap: '4px 28px' }}>
                        {(job.setup_location || job.setup_time) && (
                          <div style={{ fontSize: 12, color: '#555' }}>
                            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: '#bbb', marginRight: 6 }}>Setup</span>
                            {[job.setup_location, job.setup_time].filter(Boolean).join(' · ')}
                          </div>
                        )}
                        {(job.removal_location || job.removal_time) && (
                          <div style={{ fontSize: 12, color: '#555' }}>
                            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: '#bbb', marginRight: 6 }}>Removal</span>
                            {[job.removal_location, job.removal_time].filter(Boolean).join(' · ')}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Design approval — admin marks items approved for print */}
                    {(() => {
                      const proofed = job.items.map((it, i) => ({ it, i })).filter(x => itemProofs(x.it).length > 0)
                      if (proofed.length === 0) return null
                      return (
                        <div style={{ padding: '10px 18px', borderBottom: '1px solid #f2f2f2', background: '#fbfaf8' }}>
                          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '1.2px', textTransform: 'uppercase', color: '#bbb', marginBottom: 8 }}>Design Approval</div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {proofed.map(({ it, i }) => {
                              const key = `${job.id}:${i}`
                              const approved = it.approval_status === 'approved'
                              const busy = approvingItem === key
                              const thread = itemThread(it)
                              const lastFromClient = thread.length > 0 && thread[thread.length - 1].from === 'client'
                              const needsAction = !approved && (it.approval_status === 'changes_requested' || lastFromClient)
                              return (
                                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: needsAction ? '#fff8ef' : '#fff', border: '1px solid #efeee9', borderLeft: `3px solid ${needsAction ? '#e0922a' : approved ? '#1B7F4F' : '#e0ded7'}`, borderRadius: 4 }}>
                                  <span style={{ fontSize: 12.5, color: '#333', flex: 1, minWidth: 0, lineHeight: 1.3 }}>
                                    <strong style={{ color: 'var(--coral)' }}>{it.quantity}×</strong> {it.name}
                                    {approved && it.approved_proof_url && itemProofs(it).length > 1 && (
                                      <span style={{ display: 'inline-block', marginLeft: 6, fontSize: 10, fontWeight: 700, color: '#15803d' }}>· picked {itemProofs(it).indexOf(it.approved_proof_url) + 1}/{itemProofs(it).length}</span>
                                    )}
                                  </span>
                                  {it.approval_status && it.approval_status !== 'pending' && <ApprovalPill status={it.approval_status} />}
                                  <button
                                    onClick={() => setChatItem({ jobId: job.id, idx: i })}
                                    title={thread.length > 0 ? `${thread.length} message${thread.length > 1 ? 's' : ''}` : 'Open conversation'}
                                    style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, padding: '6px 11px', background: needsAction ? '#e0922a' : '#fff', color: needsAction ? '#fff' : '#555', border: `1px solid ${needsAction ? '#e0922a' : '#dcdad3'}`, borderRadius: 4, cursor: 'pointer', fontFamily: 'var(--font-body)', whiteSpace: 'nowrap' }}>
                                    💬 {thread.length > 0 ? thread.length : 'Reply'}
                                  </button>
                                  <button
                                    onClick={() => {
                                      if (approved) { approveItem(job, i, false); return }
                                      // Alternatives (pick-one) → make the team choose which design. All-needed
                                      // items (the default for multiple designs) approve the whole set directly.
                                      if (designsMode(it) === 'pick' && itemProofs(it).length > 1 && !it.approved_proof_url) {
                                        setPickerChoice(null)
                                        setApprovePicker({ jobId: job.id, idx: i })
                                        void loadFiles(job.id, itemProofs(it))
                                      } else {
                                        approveItem(job, i, true)
                                      }
                                    }}
                                    disabled={busy}
                                    style={{
                                      fontSize: 11, fontWeight: 700, padding: '6px 12px', borderRadius: 4,
                                      cursor: busy ? 'default' : 'pointer', fontFamily: 'var(--font-body)', whiteSpace: 'nowrap',
                                      color: approved ? '#15803d' : '#fff',
                                      background: approved ? '#dcfce7' : '#1B7F4F',
                                      border: approved ? '1px solid #86efac' : 'none',
                                      opacity: busy ? 0.6 : 1,
                                    }}
                                  >
                                    {busy ? '…' : approved ? '✓ Approved' : designsMode(it) === 'pick' && itemProofs(it).length > 1 && !it.approved_proof_url ? 'Approve…' : 'Approve'}
                                  </button>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })()}

                    {/* Notes */}
                    {job.notes && (
                      <div style={{ padding: '9px 18px', borderBottom: '1px solid #f2f2f2', background: '#fafafa', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '1.2px', textTransform: 'uppercase', color: '#bbb', paddingTop: 1, flexShrink: 0 }}>Notes</span>
                        <span style={{ fontSize: 12, color: '#666', lineHeight: 1.5 }}>{job.notes}</span>
                      </div>
                    )}

                    {/* Files */}
                    {job.file_paths.length > 0 && (
                      <div style={{ padding: '9px 18px', borderBottom: '1px solid #f2f2f2', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        {fileUrls[job.id] ? (
                          <>
                            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '1.2px', textTransform: 'uppercase', color: '#bbb' }}>Files</span>
                            {fileUrls[job.id].map(f => (
                              <a
                                key={f.path}
                                href={f.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="file-link"
                                style={{ fontSize: 12, color: 'var(--coral)', textDecoration: 'none', fontWeight: 600, background: '#fff8f6', border: '1px solid var(--coral)44', padding: '2px 9px' }}
                              >
                                ↓ {f.name}
                              </a>
                            ))}
                          </>
                        ) : fileError === job.id ? (
                          <span style={{ fontSize: 12, color: '#b91c1c' }}>Failed to load files.</span>
                        ) : (
                          <button
                            onClick={() => loadFiles(job.id, job.file_paths)}
                            disabled={loadingFiles === job.id}
                            style={{ fontSize: 12, fontWeight: 600, color: 'var(--coral)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'var(--font-body)' }}
                          >
                            {loadingFiles === job.id
                              ? 'Loading…'
                              : `View ${job.file_paths.length} attached file${job.file_paths.length !== 1 ? 's' : ''} →`}
                          </button>
                        )}
                      </div>
                    )}

                    {/* Actions footer */}
                    <div style={{ padding: '10px 18px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, background: '#fafafa', flexWrap: 'wrap' }}>

                      {/* Edit */}
                      <button
                        onClick={() => editingJob === job.id ? cancelEdit() : startEdit(job)}
                        className="job-action-btn"
                        title="Edit brief"
                        style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, color: editingJob === job.id ? 'var(--coral)' : '#555', background: editingJob === job.id ? '#fff8f6' : '#fff', border: `1px solid ${editingJob === job.id ? 'var(--coral)44' : '#ddd'}`, padding: '5px 11px', cursor: 'pointer', fontFamily: 'var(--font-body)' }}
                      >
                        <EditIcon /> {editingJob === job.id ? 'Cancel' : 'Edit Brief'}
                      </button>

                      {/* Print */}
                      <button
                        onClick={() => printJobTicket(job)}
                        className="job-action-btn"
                        title="Print job ticket"
                        style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, color: '#555', background: '#fff', border: '1px solid #ddd', padding: '5px 11px', cursor: 'pointer', fontFamily: 'var(--font-body)' }}
                      >
                        <PrintIcon /> Print
                      </button>

                      {/* Copy public approval link */}
                      {(() => {
                        const hasProof = job.items.some(i => itemProofs(i).length > 0)
                        const isCopied = copiedLink === job.id
                        return (
                          <button
                            onClick={() => copyApprovalLink(job.id)}
                            disabled={!hasProof || copyingLink === job.id}
                            className="job-action-btn"
                            title={hasProof ? 'Copy a no-login approval link to send to the client' : 'Attach a proof to an item first'}
                            style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, color: isCopied ? '#15803d' : 'var(--coral)', background: isCopied ? '#dcfce7' : '#fff8f6', border: `1px solid ${isCopied ? '#86efac' : 'var(--coral)44'}`, padding: '5px 11px', cursor: hasProof ? 'pointer' : 'not-allowed', opacity: hasProof ? (copyingLink === job.id ? 0.6 : 1) : 0.45, fontFamily: 'var(--font-body)' }}
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/>
                              <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>
                            </svg>
                            {isCopied ? 'Copied!' : copyingLink === job.id ? 'Copying…' : 'Approval Link'}
                          </button>
                        )
                      })()}

                      {/* Approved designs sheet — appears as soon as any item is approved (partial OK) */}
                      {(() => {
                        const proofItems = job.items.filter(i => itemProofs(i).length > 0)
                        const approvedCount = proofItems.filter(i => i.approval_status === 'approved').length
                        if (approvedCount === 0) return null
                        const isFull = approvedCount === proofItems.length
                        return (
                          <button
                            onClick={() => printApprovedSheet(job)}
                            className="job-action-btn"
                            title={isFull ? 'Print all approved designs' : `Print the ${approvedCount} approved item${approvedCount !== 1 ? 's' : ''} so the team can start`}
                            style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, color: '#15803d', background: '#dcfce7', border: '1px solid #86efac', padding: '5px 11px', cursor: 'pointer', fontFamily: 'var(--font-body)' }}
                          >
                            <CheckIcon /> Approved Sheet {isFull ? '' : `(${approvedCount}/${proofItems.length})`}
                          </button>
                        )
                      })()}

                      {/* Invoice → Command Centre */}
                      <button
                        onClick={() => sendToCommandCentre(job)}
                        disabled={sendingToCC === job.id || sentToCC.has(job.id)}
                        className="job-action-btn invoice-btn"
                        title={sentToCC.has(job.id) ? 'Draft invoice created in Command Centre' : 'Create draft invoice in Command Centre'}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 5,
                          fontSize: 11, fontWeight: 700,
                          color: sentToCC.has(job.id) ? '#15803d' : '#166534',
                          background: sentToCC.has(job.id) ? '#dcfce7' : '#f0fdf4',
                          border: `1px solid ${sentToCC.has(job.id) ? '#86efac' : '#bbf7d0'}`,
                          padding: '5px 11px',
                          cursor: (sendingToCC === job.id || sentToCC.has(job.id)) ? 'default' : 'pointer',
                          opacity: sendingToCC === job.id ? 0.6 : 1,
                          fontFamily: 'var(--font-body)',
                        }}
                      >
                        {sentToCC.has(job.id)
                          ? <><CheckIcon /> Invoiced</>
                          : sendingToCC === job.id
                            ? 'Sending…'
                            : <><InvoiceIcon /> Invoice</>}
                      </button>

                      {/* Re-sync approved items to the Command Centre Kanban board */}
                      {(() => {
                        const approvedCount = job.items.filter(i => itemProofs(i).length > 0 && i.approval_status === 'approved').length
                        if (approvedCount === 0) return null
                        const done = resynced.has(job.id)
                        return (
                          <button
                            onClick={() => resyncToKanban(job)}
                            disabled={resyncing === job.id}
                            className="job-action-btn"
                            title="Push this job's approved items to the Command Centre Kanban board again — refreshes client notes, designs and specs on the tile"
                            style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, color: done ? '#15803d' : '#555', background: done ? '#dcfce7' : '#fff', border: `1px solid ${done ? '#86efac' : '#ddd'}`, padding: '5px 11px', cursor: resyncing === job.id ? 'default' : 'pointer', opacity: resyncing === job.id ? 0.6 : 1, fontFamily: 'var(--font-body)' }}
                          >
                            {done ? <><CheckIcon /> Synced</> : resyncing === job.id ? 'Syncing…' : (
                              <>
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="23 4 23 10 17 10"/>
                                  <polyline points="1 20 1 14 7 14"/>
                                  <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
                                </svg>
                                Re-sync
                              </>
                            )}
                          </button>
                        )
                      })()}

                      {/* Notify client toggle */}
                      <button
                        onClick={() => toggleNotify(job.id, job.notify_client)}
                        disabled={togglingNotify === job.id}
                        title={job.notify_client ? 'Client notifications ON — click to disable' : 'Client notifications OFF — click to enable'}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 5,
                          padding: '5px 9px',
                          fontSize: 11,
                          fontWeight: 600,
                          border: '1px solid',
                          borderColor: job.notify_client ? '#C8702A' : '#ddd',
                          background: job.notify_client ? '#fff7ed' : '#fff',
                          color: job.notify_client ? '#C8702A' : '#999',
                          cursor: togglingNotify === job.id ? 'wait' : 'pointer',
                          opacity: togglingNotify === job.id ? 0.6 : 1,
                          fontFamily: 'var(--font-body)',
                        }}
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                          <path d="M13.73 21a2 2 0 01-3.46 0"/>
                        </svg>
                        {job.notify_client ? 'Notify: ON' : 'Notify: OFF'}
                      </button>

                      {/* Status dropdown */}
                      <select
                        value={job.status}
                        disabled={updating === job.id}
                        onChange={e => updateStatus(job.id, e.target.value)}
                        style={{ padding: '5px 9px', fontSize: 11, border: '1px solid #ddd', background: '#fff', cursor: 'pointer', fontFamily: 'var(--font-body)', color: '#333', fontWeight: 600 }}
                      >
                        {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                      </select>
                    </div>

                    {/* ── Edit panel ───────────────────────────────────────── */}
                    {editingJob === job.id && editForm && (
                      <div style={{ padding: '18px', borderTop: '2px solid var(--coral)', background: '#fffdf9' }}>
                        <p style={{ margin: '0 0 14px', fontSize: 10, fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--coral)' }}>Edit Brief</p>

                        {/* Date + Event */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, fontWeight: 600, color: '#555', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
                            Due Date
                            <input
                              type="date"
                              value={editForm.date_required}
                              onChange={e => setEditForm(prev => prev ? { ...prev, date_required: e.target.value } : prev)}
                              style={{ padding: '6px 9px', border: '1px solid #ddd', fontSize: 12, fontFamily: 'var(--font-body)', color: '#1a1a1a' }}
                            />
                          </label>
                          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, fontWeight: 600, color: '#555', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
                            Event / Location
                            <input
                              type="text"
                              value={editForm.event_name}
                              onChange={e => setEditForm(prev => prev ? { ...prev, event_name: e.target.value } : prev)}
                              placeholder="Optional"
                              style={{ padding: '6px 9px', border: '1px solid #ddd', fontSize: 12, fontFamily: 'var(--font-body)', color: '#1a1a1a' }}
                            />
                          </label>
                        </div>

                        {/* Notes */}
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, fontWeight: 600, color: '#555', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 14 }}>
                          Notes / Special Instructions
                          <textarea
                            value={editForm.notes}
                            onChange={e => setEditForm(prev => prev ? { ...prev, notes: e.target.value } : prev)}
                            rows={3}
                            placeholder="Optional"
                            style={{ padding: '8px 9px', border: '1px solid #ddd', fontSize: 12, fontFamily: 'var(--font-body)', color: '#1a1a1a', resize: 'vertical' }}
                          />
                        </label>

                        {/* Setup & Removal logistics */}
                        <p style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 10px', paddingBottom: 6, borderBottom: '1px solid #ececec', fontSize: 11, fontWeight: 700, color: 'var(--charcoal)', textTransform: 'uppercase', letterSpacing: '1px' }}><span style={{ width: 3, height: 12, background: 'var(--coral)', borderRadius: 2 }} />Setup &amp; Removal</p>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
                          {([
                            ['Setup location', 'setup_location', 'Venue / address'],
                            ['Setup time', 'setup_time', 'e.g. Fri 8:00 AM'],
                            ['Removal location', 'removal_location', 'Same as setup, or other'],
                            ['Removal time', 'removal_time', 'e.g. Sun 11:00 PM'],
                          ] as const).map(([label, key, ph]) => (
                            <label key={key} style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, fontWeight: 600, color: '#555', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
                              {label}
                              <input
                                type="text"
                                value={editForm[key]}
                                onChange={e => setEditForm(prev => prev ? { ...prev, [key]: e.target.value } : prev)}
                                placeholder={ph}
                                style={{ padding: '6px 9px', border: '1px solid #ddd', fontSize: 12, fontFamily: 'var(--font-body)', color: '#1a1a1a' }}
                              />
                            </label>
                          ))}
                        </div>

                        {/* Reference Photos */}
                        <div style={{ marginBottom: 14 }}>
                          <p style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 10px', paddingBottom: 6, borderBottom: '1px solid #ececec', fontSize: 11, fontWeight: 700, color: 'var(--charcoal)', textTransform: 'uppercase', letterSpacing: '1px' }}><span style={{ width: 3, height: 12, background: 'var(--coral)', borderRadius: 2 }} />Reference Photos <span style={{ color: '#aaa', fontWeight: 600, letterSpacing: 0 }}>· job-wide</span></p>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                            {editForm.file_paths.map(path => {
                              const name = path.split('/').pop() ?? path
                              const cached = fileUrls[job.id]?.find(f => f.path === path)
                              return (
                                <div key={path} style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#f8f7f5', border: '1px solid #e0e0e0', padding: '4px 8px 4px 4px' }}>
                                  {cached && (
                                    <img src={cached.url} alt={name} style={{ width: 36, height: 36, objectFit: 'cover', flexShrink: 0 }} />
                                  )}
                                  <span style={{ fontSize: 11, color: '#555', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                                  <button
                                    onClick={() => setEditForm(prev => prev ? { ...prev, file_paths: prev.file_paths.filter(p => p !== path) } : prev)}
                                    title="Remove photo"
                                    style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 14, fontWeight: 700, lineHeight: 1, padding: '0 2px', flexShrink: 0 }}
                                  >×</button>
                                </div>
                              )
                            })}
                            {editForm.file_paths.length < 3 && (
                              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, color: uploadingPhoto ? '#aaa' : 'var(--coral)', background: 'none', border: '1px dashed var(--coral)66', padding: '5px 12px', cursor: uploadingPhoto ? 'default' : 'pointer' }}>
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
                          {editForm.file_paths.length > 0 && <p style={{ margin: 0, fontSize: 11, color: '#aaa' }}>Removing a photo cannot be undone after saving.</p>}
                        </div>

                        {/* Items */}
                        <div style={{ marginBottom: 14 }}>
                          <p style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 10px', paddingBottom: 6, borderBottom: '1px solid #ececec', fontSize: 11, fontWeight: 700, color: 'var(--charcoal)', textTransform: 'uppercase', letterSpacing: '1px' }}><span style={{ width: 3, height: 12, background: 'var(--coral)', borderRadius: 2 }} />Items <span style={{ color: '#aaa', fontWeight: 600, letterSpacing: 0 }}>({editForm.items.length})</span></p>
                          {editForm.items.map((item, idx) => {
                            const proofs = itemProofs(item)
                            return (
                            <div key={idx} style={{ background: '#fff', border: '1px solid #e7e5e1', borderRadius: 8, padding: '12px 12px 14px', marginBottom: 10, boxShadow: '0 1px 2px rgba(20,18,16,0.04)' }}>
                              {/* Item header: number badge + name + remove */}
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0, fontSize: 12.5, fontWeight: 700, color: 'var(--charcoal)' }}>
                                  <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 20, height: 20, borderRadius: 5, background: 'var(--coral)', color: '#fff', fontSize: 11, fontWeight: 800, flexShrink: 0 }}>{idx + 1}</span>
                                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name?.trim() ? item.name : `Item ${idx + 1}`}</span>
                                </span>
                                <button
                                  onClick={() => removeEditItem(idx)}
                                  disabled={editForm.items.length === 1}
                                  title={editForm.items.length === 1 ? 'A job needs at least one item' : 'Remove this item'}
                                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', color: editForm.items.length === 1 ? '#ccc' : '#C62828', cursor: editForm.items.length === 1 ? 'default' : 'pointer', fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-body)', padding: 4, flexShrink: 0 }}
                                >✕ Remove</button>
                              </div>
                              {/* Approval status strip */}
                              {item.approval_status && item.approval_status !== 'pending' && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                                  <ApprovalPill status={item.approval_status} />
                                  {item.client_note && (
                                    <span style={{ fontSize: 11.5, color: '#C62828', fontStyle: 'italic' }}>“{item.client_note}”</span>
                                  )}
                                </div>
                              )}
                              {/* Core fields */}
                              <div style={{ display: 'grid', gridTemplateColumns: '64px 1fr', gap: 8, marginBottom: 8 }}>
                                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 9, fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase', color: '#999' }}>Qty
                                  <input
                                    type="number" min={1} value={item.quantity}
                                    onChange={e => updateEditItem(idx, 'quantity', parseInt(e.target.value) || 1)}
                                    style={{ padding: '7px 9px', border: '1px solid #dcdcdc', borderRadius: 6, fontSize: 12.5, fontFamily: 'var(--font-body)', color: '#1a1a1a', background: '#fff', width: '100%', boxSizing: 'border-box', textAlign: 'center' }}
                                  />
                                </label>
                                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 9, fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase', color: '#999' }}>Item name
                                  <input
                                    type="text" value={item.name}
                                    onChange={e => updateEditItem(idx, 'name', e.target.value)}
                                    placeholder="e.g. Welcome Sign"
                                    style={{ padding: '7px 9px', border: '1px solid #dcdcdc', borderRadius: 6, fontSize: 12.5, fontFamily: 'var(--font-body)', color: '#1a1a1a', background: '#fff', width: '100%', boxSizing: 'border-box' }}
                                  />
                                </label>
                              </div>
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 9, fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase', color: '#999' }}>Size
                                  <input
                                    type="text" value={item.size}
                                    onChange={e => updateEditItem(idx, 'size', e.target.value)}
                                    placeholder="e.g. 22×28"
                                    style={{ padding: '7px 9px', border: '1px solid #dcdcdc', borderRadius: 6, fontSize: 12.5, fontFamily: 'var(--font-body)', color: '#1a1a1a', background: '#fff', width: '100%', boxSizing: 'border-box' }}
                                  />
                                </label>
                                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 9, fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase', color: '#999' }}>Material
                                  <select
                                    value={item.material}
                                    onChange={e => updateEditItem(idx, 'material', e.target.value)}
                                    style={{ padding: '7px 9px', border: '1px solid #dcdcdc', borderRadius: 6, fontSize: 12.5, fontFamily: 'var(--font-body)', color: '#1a1a1a', background: '#fff', width: '100%', boxSizing: 'border-box' }}
                                  >
                                    {['vinyl','fabric','foam-board','acrylic','cardstock','wood','pvc','other'].map(m => (
                                      <option key={m} value={m}>{m}</option>
                                    ))}
                                  </select>
                                </label>
                              </div>
                              {/* Per-item client brief */}
                              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 9, fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase', color: '#999' }}>Description / brief
                                <textarea
                                  value={item.description ?? ''}
                                  onChange={e => updateEditItem(idx, 'description', e.target.value)}
                                  rows={2}
                                  placeholder="Finishing, sides, easel back, etc."
                                  style={{ padding: '7px 9px', border: '1px solid #dcdcdc', borderRadius: 6, fontSize: 12.5, fontFamily: 'var(--font-body)', color: '#1a1a1a', background: '#fff', width: '100%', boxSizing: 'border-box', resize: 'vertical' }}
                                />
                              </label>
                              {/* Per-item reference photos (read-only thumbnails) */}
                              {itemRefPhotos(item).length > 0 && (
                                <div style={{ marginTop: 12 }}>
                                  <span style={{ display: 'block', fontSize: 9, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: '#999', marginBottom: 8 }}>Reference photos · {itemRefPhotos(item).length}</span>
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                    {itemRefPhotos(item).map(p => {
                                      const signed = fileUrls[job.id]?.find(f => f.path === p)
                                      return signed ? (
                                        <a key={p} href={signed.url} target="_blank" rel="noopener noreferrer" title="Reference photo" style={{ display: 'block', width: 60, height: 60 }}>
                                          <img src={signed.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', border: '1px solid #e0e0e0', borderRadius: 6, display: 'block' }} />
                                        </a>
                                      ) : <span key={p} style={{ width: 60, height: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f4f2', border: '1px solid #e7e5e1', borderRadius: 6, color: '#bbb', fontSize: 8, fontWeight: 700 }}>IMG</span>
                                    })}
                                  </div>
                                </div>
                              )}
                              {/* Shop note shown to the client at review */}
                              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 12, fontSize: 9, fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase', color: '#999' }}>Note for client
                                <textarea
                                  value={item.admin_note ?? ''}
                                  onChange={e => updateEditItem(idx, 'admin_note', e.target.value)}
                                  rows={2}
                                  placeholder="Explain the concept, finish, or how this will be made — the client sees this above the proofs."
                                  style={{ padding: '7px 9px', border: '1px solid #dcdcdc', borderRadius: 6, fontSize: 12.5, fontFamily: 'var(--font-body)', color: '#1a1a1a', background: '#fff', width: '100%', boxSizing: 'border-box', resize: 'vertical' }}
                                />
                              </label>
                              {/* Shop example/inspiration photos shown to the client */}
                              <div style={{ marginTop: 12 }}>
                                <span style={{ display: 'block', fontSize: 9, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: '#999', marginBottom: 8 }}>
                                  Example photos for client{itemExamplePhotos(item).length > 0 ? ` · ${itemExamplePhotos(item).length}` : ''}
                                </span>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                  {itemExamplePhotos(item).map(p => {
                                    const signed = fileUrls[job.id]?.find(f => f.path === p)
                                    return (
                                      <div key={p} style={{ position: 'relative', width: 60, height: 60, flexShrink: 0 }}>
                                        {signed ? (
                                          <a href={signed.url} target="_blank" rel="noopener noreferrer" title="Example photo" style={{ display: 'block', width: '100%', height: '100%' }}>
                                            <img src={signed.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', border: '1px solid #e0e0e0', borderRadius: 6, display: 'block' }} />
                                          </a>
                                        ) : <span style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f4f2', border: '1px solid #e7e5e1', borderRadius: 6, color: '#bbb', fontSize: 8, fontWeight: 700 }}>IMG</span>}
                                        <button
                                          onClick={() => removeExamplePhoto(idx, p)}
                                          title="Remove example photo"
                                          style={{ position: 'absolute', top: -7, right: -7, width: 18, height: 18, borderRadius: '50%', background: '#fff', border: '1px solid #f0caca', color: '#C62828', cursor: 'pointer', fontSize: 11, fontWeight: 700, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 2px rgba(0,0,0,0.12)' }}
                                        >×</button>
                                      </div>
                                    )
                                  })}
                                  {itemExamplePhotos(item).length < 8 && (
                                    <label
                                      title="Attach an example / inspiration photo for the client"
                                      style={{
                                        width: 60, height: 60, flexShrink: 0,
                                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
                                        textAlign: 'center', lineHeight: 1.15,
                                        fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.3px',
                                        color: uploadingExample === idx ? '#aaa' : 'var(--coral)',
                                        border: '1.5px dashed var(--coral)77', borderRadius: 6, background: '#fff',
                                        cursor: uploadingExample === idx ? 'default' : 'pointer',
                                      }}
                                    >
                                      <input
                                        type="file"
                                        accept="image/jpeg,image/png,image/webp,image/svg+xml"
                                        style={{ display: 'none' }}
                                        disabled={uploadingExample === idx}
                                        onChange={e => { const f = e.target.files?.[0]; if (f) { e.target.value = ''; addExamplePhoto(idx, f) } }}
                                      />
                                      {uploadingExample === idx ? '…' : (<><span style={{ fontSize: 16, lineHeight: 1 }}>+</span><span>Example</span></>)}
                                    </label>
                                  )}
                                </div>
                                {exampleError && <p style={{ margin: '4px 0 0', fontSize: 11, color: '#dc2626' }}>{exampleError}</p>}
                              </div>
                              {/* Per-item design proofs (multiple) */}
                              <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #f0efec' }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                                  <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: '#999' }}>
                                    Design proofs{proofs.length > 0 ? ` · ${proofs.length}` : ''}
                                  </span>
                                  {item.approval_status === 'changes_requested' && (
                                    <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color: '#C62828' }}>Upload replaces current →</span>
                                  )}
                                </div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                  {proofs.map(p => {
                                    const nm = p.split('/').pop() ?? p
                                    const signed = fileUrls[job.id]?.find(f => f.path === p)
                                    return (
                                      <div key={p} title={nm} style={{ position: 'relative', width: 60, height: 60, flexShrink: 0 }}>
                                        {signed ? (
                                          <a href={signed.url} target="_blank" rel="noopener noreferrer" title="Click to view full image" style={{ display: 'block', width: '100%', height: '100%' }}>
                                            <img src={signed.url} alt={nm} style={{ width: '100%', height: '100%', objectFit: 'cover', border: '1px solid #d6f0dd', borderRadius: 6, display: 'block', cursor: 'zoom-in' }} />
                                          </a>
                                        ) : (
                                          <span style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 6, color: '#86c8a0', fontSize: 8, fontWeight: 700 }}>IMG</span>
                                        )}
                                        <button
                                          onClick={() => removeProof(idx, p)}
                                          title={`Remove ${nm}`}
                                          style={{ position: 'absolute', top: -7, right: -7, width: 18, height: 18, borderRadius: '50%', background: '#fff', border: '1px solid #f0caca', color: '#C62828', cursor: 'pointer', fontSize: 11, fontWeight: 700, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 2px rgba(0,0,0,0.12)' }}
                                        >×</button>
                                      </div>
                                    )
                                  })}
                                  {(proofs.length < 6 || item.approval_status === 'changes_requested') && (
                                    <label
                                      onDragOver={e => { e.preventDefault(); if (uploadingProof !== idx) setDragProof(idx) }}
                                      onDragLeave={() => setDragProof(prev => prev === idx ? null : prev)}
                                      onDrop={e => { e.preventDefault(); setDragProof(null); const f = e.dataTransfer.files?.[0]; if (f && uploadingProof !== idx) addProof(idx, f) }}
                                      title={item.approval_status === 'changes_requested' ? 'Upload the revised design — the current one moves to Earlier versions' : 'Attach a design proof'}
                                      style={{
                                        width: 60, height: 60, flexShrink: 0,
                                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
                                        textAlign: 'center', lineHeight: 1.15,
                                        fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.3px',
                                        color: uploadingProof === idx ? '#aaa' : dragProof === idx ? '#15803d' : 'var(--coral)',
                                        border: `1.5px dashed ${dragProof === idx ? '#15803d' : 'var(--coral)77'}`,
                                        borderRadius: 6,
                                        background: dragProof === idx ? '#f0fdf4' : '#fff',
                                        cursor: uploadingProof === idx ? 'default' : 'pointer',
                                        transition: 'background 0.12s, border-color 0.12s',
                                      }}
                                    >
                                      <input
                                        type="file"
                                        accept="image/jpeg,image/png,image/svg+xml,application/pdf,.ai,.eps"
                                        style={{ display: 'none' }}
                                        disabled={uploadingProof === idx}
                                        onChange={e => { const f = e.target.files?.[0]; if (f) { e.target.value = ''; addProof(idx, f) } }}
                                      />
                                      {uploadingProof === idx ? '…' : dragProof === idx ? 'Drop' : (
                                        <>
                                          <span style={{ fontSize: 16, lineHeight: 1 }}>{item.approval_status === 'changes_requested' ? '↑' : '+'}</span>
                                          <span>{item.approval_status === 'changes_requested' ? 'New version' : proofs.length > 0 ? 'Add' : 'Add proof'}</span>
                                        </>
                                      )}
                                    </label>
                                  )}
                                </div>
                              </div>
                              {/* When an item has several designs: are they all needed, or alternatives? */}
                              {proofs.length > 1 && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                                  <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: '#bbb' }}>Multiple designs</span>
                                  {(['all', 'pick'] as const).map(m => {
                                    const on = designsMode(item) === m
                                    return (
                                      <button key={m}
                                        onClick={() => setEditForm(prev => {
                                          if (!prev) return prev
                                          const items = [...prev.items]
                                          // Switching to "print all" drops any recorded single pick so every design prints.
                                          items[idx] = { ...items[idx], designs_mode: m, ...(m === 'all' ? { approved_proof_url: undefined } : {}) }
                                          return { ...prev, items }
                                        })}
                                        style={{ fontSize: 11, fontWeight: 700, padding: '4px 11px', cursor: 'pointer', fontFamily: 'var(--font-body)', background: on ? '#131313' : '#fff', color: on ? '#fff' : '#666', border: `1px solid ${on ? '#131313' : '#ddd'}` }}>
                                        {m === 'all' ? 'Print all' : 'Client picks one'}
                                      </button>
                                    )
                                  })}
                                  <span style={{ fontSize: 10, color: '#999' }}>{designsMode(item) === 'all' ? 'every design is printed' : 'they are alternatives'}</span>
                                </div>
                              )}
                            </div>
                          )})}
                          {proofError && <p style={{ margin: '4px 0 0', fontSize: 11, color: '#dc2626' }}>{proofError}</p>}
                          {editForm.items.length < 10 && (
                            <button
                              onClick={addEditItem}
                              style={{ fontSize: 11, fontWeight: 600, color: 'var(--coral)', background: 'none', border: '1px dashed var(--coral)66', padding: '5px 14px', cursor: 'pointer', fontFamily: 'var(--font-body)', marginTop: 4 }}
                            >
                              + Add Item
                            </button>
                          )}
                        </div>

                        {/* Save / Cancel */}
                        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                          <button onClick={cancelEdit} style={{ fontSize: 12, padding: '7px 18px', border: '1px solid #ddd', background: '#fff', cursor: 'pointer', fontFamily: 'var(--font-body)' }}>
                            Cancel
                          </button>
                          <button
                            onClick={() => saveEdit(job.id)}
                            disabled={savingEdit}
                            style={{ fontSize: 12, fontWeight: 700, padding: '7px 20px', background: '#1a1a1a', color: '#fff', border: 'none', cursor: savingEdit ? 'default' : 'pointer', opacity: savingEdit ? 0.6 : 1, fontFamily: 'var(--font-body)', letterSpacing: '0.5px' }}
                          >
                            {savingEdit ? 'Saving…' : 'Save Changes'}
                          </button>
                        </div>
                      </div>
                    )}
                    </>)}

                  </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* Conversation drawer — reply to the client + upload a revised version */}
      {chatItem && (() => {
        const job = jobs.find(j => j.id === chatItem.jobId)
        const it = job?.items[chatItem.idx]
        if (!job || !it) return null
        const idx = chatItem.idx
        const key = `${job.id}:${idx}`
        const thread = itemThread(it)
        const draft = replyDraft[key] ?? ''
        const approved = it.approval_status === 'approved'
        const sending = sendingReply === key
        const uploading = uploadingRevision === key
        return (
          <>
            <div className="chat-backdrop" onClick={() => setChatItem(null)} />
            <aside className="chat-drawer" role="dialog" aria-label={`Conversation about ${it.name}`}>
              <div className="chat-head">
                <div style={{ minWidth: 0 }}>
                  <div className="chat-head-title">{it.quantity}× {it.name}</div>
                  <div className="chat-head-sub">{job.reference_number}</div>
                </div>
                <button className="chat-close" onClick={() => setChatItem(null)} aria-label="Close conversation">✕</button>
              </div>

              <div className="chat-body" ref={chatBodyRef}>
                {thread.length === 0 ? (
                  <div className="chat-empty">No messages yet.<br />Write to the client below, or upload a revised version.</div>
                ) : thread.map((m, mi) => {
                  const mine = m.from === 'shop'
                  return (
                    <div key={mi} className={`chat-row ${mine ? 'me' : 'them'}`}>
                      <div className="chat-bubble">{m.text}</div>
                      <div className="chat-meta">{mine ? 'DDF x Pixel team reply' : 'Client reply'}{m.at ? ` · ${new Date(m.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}</div>
                    </div>
                  )
                })}
              </div>

              <div className="chat-foot">
                {revisionError[key] && <div className="chat-err">{revisionError[key]}</div>}
                <div className="chat-compose">
                  <textarea
                    rows={1}
                    value={draft}
                    onChange={ev => setReplyDraft(prev => ({ ...prev, [key]: ev.target.value }))}
                    onKeyDown={ev => { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); if (draft.trim() && !sending) sendReply(job, idx) } }}
                    placeholder="Write back to the client…"
                    className="chat-input"
                  />
                  <button className="chat-send" onClick={() => sendReply(job, idx)} disabled={sending || !draft.trim()}>
                    {sending ? '…' : 'Send'}
                  </button>
                </div>
                {!approved && (
                  <label className="chat-revise" style={{ cursor: uploading ? 'default' : 'pointer' }}>
                    <input type="file" accept="image/*" disabled={uploading} style={{ display: 'none' }}
                      onChange={e => { const f = e.target.files?.[0]; if (f) uploadRevision(job, idx, f); e.currentTarget.value = '' }} />
                    {uploading ? '⏳ Uploading new version…' : '⬆ Upload revised version'}
                  </label>
                )}
              </div>
            </aside>
          </>
        )
      })()}

      {/* Approve picker — choose which design before approving a multi-design item */}
      {approvePicker && (() => {
        const job = jobs.find(j => j.id === approvePicker.jobId)
        const it = job?.items[approvePicker.idx]
        if (!job || !it) return null
        const proofs = itemProofs(it)
        const key = `${job.id}:${approvePicker.idx}`
        const busy = approvingItem === key
        return (
          <div onClick={() => setApprovePicker(null)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(20,18,16,0.5)', zIndex: 210, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
            <div onClick={e => e.stopPropagation()}
              style={{ background: '#fff', width: 460, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', borderRadius: 8, boxShadow: '0 20px 50px rgba(0,0,0,0.3)' }}>
              <div style={{ padding: '16px 18px', borderBottom: '1px solid #eee' }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#131313' }}>Which design is approved?</div>
                <div style={{ fontSize: 12.5, color: '#777', marginTop: 3 }}>{it.quantity}× {it.name} — only the chosen design goes to print.</div>
              </div>
              <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {proofs.map((p, pi) => {
                  const u = fileUrls[job.id]?.find(f => f.path === p)?.url
                  const chosen = pickerChoice === p
                  return (
                    <button key={p} onClick={() => setPickerChoice(p)}
                      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 10, textAlign: 'left', background: chosen ? '#eef7f3' : '#fafafa', border: `2px solid ${chosen ? '#1B7F4F' : '#e6e3dc'}`, borderRadius: 6, cursor: 'pointer', fontFamily: 'var(--font-body)' }}>
                      <span style={{ width: 18, height: 18, borderRadius: '50%', flexShrink: 0, border: `2px solid ${chosen ? '#1B7F4F' : '#bbb'}`, background: chosen ? '#1B7F4F' : '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11, fontWeight: 700 }}>{chosen ? '✓' : ''}</span>
                      <span style={{ width: 64, height: 64, flexShrink: 0, background: '#f0eee9', border: '1px solid #e6e3dc', overflow: 'hidden' }}>
                        {u && <img src={u} alt={`Design ${pi + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
                      </span>
                      <span style={{ fontSize: 13.5, fontWeight: 700, color: '#333' }}>Design {pi + 1}</span>
                    </button>
                  )
                })}
              </div>
              <div style={{ padding: '12px 14px', borderTop: '1px solid #eee', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button onClick={() => setApprovePicker(null)}
                  style={{ fontSize: 13, padding: '9px 14px', background: '#fff', border: '1px solid #ddd', borderRadius: 5, cursor: 'pointer', fontFamily: 'var(--font-body)' }}>Cancel</button>
                <button disabled={!pickerChoice || busy}
                  onClick={async () => { await approveItem(job, approvePicker.idx, true, pickerChoice!); setApprovePicker(null) }}
                  style={{ fontSize: 13, fontWeight: 700, padding: '9px 16px', background: '#1B7F4F', color: '#fff', border: 'none', borderRadius: 5, cursor: (!pickerChoice || busy) ? 'default' : 'pointer', opacity: (!pickerChoice || busy) ? 0.5 : 1, fontFamily: 'var(--font-body)' }}>
                  {busy ? 'Approving…' : '✓ Approve this design'}
                </button>
              </div>
            </div>
          </div>
        )
      })()}
    </main>
  )
}
