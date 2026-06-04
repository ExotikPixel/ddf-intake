'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { useRouter } from 'next/navigation'
import { STATUSES, STATUS_LABELS, STATUS_CONFIG } from '@/lib/job-types'
import type { JobItem } from '@/lib/job-types'

interface Job {
  id: number
  reference_number: string
  client_name: string
  company_name: string
  contact_email: string
  event_name: string | null
  date_required: string
  notes: string | null
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
  items: JobItem[]
  file_paths: string[]
}

// ── XSS guard ──────────────────────────────────────────────────────────────
function escHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
         .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
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

const STATUS_COLORS: Record<string, string> = Object.fromEntries(
  Object.entries(STATUS_CONFIG).map(([k, v]) => [k, v.color])
)

// ── Page ───────────────────────────────────────────────────────────────────
export default function AdminPage() {
  const [jobs, setJobs]                 = useState<Job[]>([])
  const [loading, setLoading]           = useState(true)
  const [loadError, setLoadError]       = useState('')
  const [filter, setFilter]             = useState('all')
  const [updating, setUpdating]         = useState<number | null>(null)
  const [togglingNotify, setTogglingNotify] = useState<number | null>(null)
  const [fileUrls, setFileUrls]         = useState<Record<number, { path: string; name: string; url: string }[]>>({})
  const [loadingFiles, setLoadingFiles] = useState<number | null>(null)
  const [fileError, setFileError]       = useState<number | null>(null)
  const [sendingToCC, setSendingToCC]   = useState<number | null>(null)
  const [sentToCC, setSentToCC]         = useState<Set<number>>(new Set())
  const [editingJob, setEditingJob]     = useState<number | null>(null)
  const [editForm, setEditForm]         = useState<EditForm | null>(null)
  const [savingEdit, setSavingEdit]     = useState(false)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [uploadPhotoError, setUploadPhotoError] = useState('')
  const router = useRouter()

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { router.push('/login'); return }
      fetchJobs()
    })
  }, [router])

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
    if (fileUrls[jobId] || paths.length === 0) return
    setLoadingFiles(jobId)
    setFileError(null)
    try {
      const res = await fetch('/api/admin/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths }),
      })
      if (!res.ok) { setFileError(jobId); return }
      const { urls } = await res.json()
      setFileUrls(prev => ({ ...prev, [jobId]: urls }))
      return urls as { path: string; name: string; url: string }[]
    } catch {
      setFileError(jobId)
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
      items: job.items.map(i => ({ ...i })),
      file_paths: [...job.file_paths],
    })
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

  async function printJobTicket(job: Job) {
    const statusLabel   = STATUS_LABELS[job.status] ?? job.status
    const submittedDate = new Date(job.submitted_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' })
    const printDate     = new Date().toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    const BRAND = '#b8955a'

    const itemRows = job.items.map(item => `
      <tr>
        <td style="width:52px;text-align:center;font-size:22px;font-weight:900;color:${BRAND};border-bottom:1px solid #e8e8e8;padding:10px 8px;">${item.quantity}</td>
        <td style="font-weight:600;border-bottom:1px solid #e8e8e8;padding:10px 12px;">${escHtml(item.name)}</td>
        <td style="border-bottom:1px solid #e8e8e8;padding:10px 12px;color:#555;">${escHtml(item.size || '—')}</td>
        <td style="border-bottom:1px solid #e8e8e8;padding:10px 12px;color:#555;">${escHtml(item.material || '—')}</td>
      </tr>
    `).join('')

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
        <div style="font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#999;margin-bottom:4px;">Pixel Production</div>
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
    ${notesSection}
    ${imageSection}
    <div style="margin-top:32px;padding-top:12px;border-top:1px solid #e8e8e8;display:flex;justify-content:space-between;font-size:11px;color:#aaa;">
      <span>Pixel Production — Internal Job Ticket</span>
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

  async function signOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  const filtered = useMemo(
    () => filter === 'all' ? jobs : jobs.filter(j => j.status === filter),
    [jobs, filter]
  )

  const statCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    STATUSES.forEach(s => { counts[s] = jobs.filter(j => j.status === s).length })
    return counts
  }, [jobs])

  return (
    <main style={{ minHeight: '100vh', background: '#f2f1ef', fontFamily: 'var(--font-body)' }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .stat-btn:hover { opacity: 0.85; }
        .filter-btn:hover { background: #f5f5f5 !important; }
        .job-action-btn:hover:not(:disabled) { filter: brightness(0.95); }
        .invoice-btn:hover:not(:disabled) { background: #dcfce7 !important; }
        .file-link:hover { opacity: 0.8; }
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
          <img src="/logo-pixel.png" alt="Pixel Production" style={{ height: 26, width: 'auto', filter: 'brightness(0) invert(1)' }} />
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

      <div style={{ maxWidth: 1140, margin: '0 auto', padding: '28px 24px 64px' }}>

        {/* Page title */}
        <div style={{ marginBottom: 24 }}>
          <p style={{ margin: '0 0 4px', fontSize: 10, fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--coral)' }}>
            Pixel Production
          </p>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, fontFamily: 'var(--font-heading)', textTransform: 'uppercase', letterSpacing: '0.5px', color: '#1a1a1a' }}>
            Job Dashboard
          </h1>
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
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6, marginBottom: 24 }}>
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
                  <div style={{ fontSize: 26, fontWeight: 800, fontFamily: 'var(--font-heading)', color: STATUS_CONFIG[s].color, lineHeight: 1, letterSpacing: '-0.5px' }}>
                    {statCounts[s] ?? 0}
                  </div>
                  <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase', color: '#999', marginTop: 5 }}>
                    {STATUS_LABELS[s]}
                  </div>
                </button>
              ))}
            </div>

            {/* ── Toolbar ─────────────────────────────────────────────────────── */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
              <p style={{ margin: 0, fontSize: 12, color: '#999' }}>
                {filter === 'all'
                  ? `${jobs.length} job${jobs.length !== 1 ? 's' : ''} total`
                  : `${filtered.length} ${STATUS_LABELS[filter]?.toLowerCase()}`}
              </p>
              <div style={{ display: 'flex', gap: 3 }}>
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
                No {filter !== 'all' ? STATUS_LABELS[filter]?.toLowerCase() + ' ' : ''}jobs.
              </div>
            ) : (

              /* ── Job list ──────────────────────────────────────────────────── */
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {filtered.map(job => (
                  <div
                    key={job.id}
                    style={{
                      background: '#fff',
                      border: '1px solid #e0e0e0',
                      borderLeft: `4px solid ${STATUS_COLORS[job.status] ?? '#ccc'}`,
                    }}
                  >
                    {/* Card top: identity + date */}
                    <div style={{ padding: '15px 18px 13px', borderBottom: '1px solid #f2f2f2' }}>
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
                            <a href={`mailto:${job.contact_email}`} style={{ color: '#999', textDecoration: 'none' }}>
                              {job.contact_email}
                            </a>
                            <span>
                              Due&nbsp;
                              <strong style={{ color: '#1a1a1a', fontWeight: 700 }}>{job.date_required}</strong>
                            </span>
                            {job.event_name && <span>{job.event_name}</span>}
                          </div>
                        </div>
                        {/* Submitted date */}
                        <span style={{ fontSize: 11, color: '#bbb', whiteSpace: 'nowrap', flexShrink: 0, paddingTop: 2 }}>
                          {new Date(job.submitted_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </span>
                      </div>
                    </div>

                    {/* Items */}
                    <div style={{ padding: '10px 18px', borderBottom: '1px solid #f2f2f2', display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                      {job.items.map((item, i) => (
                        <span key={i} style={{ background: '#f8f7f5', border: '1px solid #eaeaea', padding: '3px 9px', fontSize: 12, color: '#444' }}>
                          <strong style={{ color: 'var(--coral)', marginRight: 2 }}>{item.quantity}×</strong>
                          {item.name}
                          {item.size     && <span style={{ color: '#999' }}> · {item.size}</span>}
                          {item.material && <span style={{ color: '#bbb' }}> · {item.material}</span>}
                        </span>
                      ))}
                    </div>

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
                    <div style={{ padding: '10px 18px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, background: '#fafafa' }}>

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

                        {/* Reference Photos */}
                        <div style={{ marginBottom: 14 }}>
                          <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 600, color: '#555', textTransform: 'uppercase', letterSpacing: '0.8px' }}>Reference Photos</p>
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
                          <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 600, color: '#555', textTransform: 'uppercase', letterSpacing: '0.8px' }}>Items</p>
                          {editForm.items.map((item, idx) => (
                            <div key={idx} style={{ display: 'grid', gridTemplateColumns: '52px 1fr 120px 140px 32px', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                              <input
                                type="number" min={1} value={item.quantity}
                                onChange={e => updateEditItem(idx, 'quantity', parseInt(e.target.value) || 1)}
                                style={{ padding: '6px 6px', border: '1px solid #ddd', fontSize: 12, fontFamily: 'var(--font-body)', textAlign: 'center' }}
                                placeholder="Qty"
                              />
                              <input
                                type="text" value={item.name}
                                onChange={e => updateEditItem(idx, 'name', e.target.value)}
                                style={{ padding: '6px 9px', border: '1px solid #ddd', fontSize: 12, fontFamily: 'var(--font-body)' }}
                                placeholder="Description"
                              />
                              <input
                                type="text" value={item.size}
                                onChange={e => updateEditItem(idx, 'size', e.target.value)}
                                style={{ padding: '6px 9px', border: '1px solid #ddd', fontSize: 12, fontFamily: 'var(--font-body)' }}
                                placeholder="Size"
                              />
                              <select
                                value={item.material}
                                onChange={e => updateEditItem(idx, 'material', e.target.value)}
                                style={{ padding: '6px 6px', border: '1px solid #ddd', fontSize: 12, fontFamily: 'var(--font-body)' }}
                              >
                                {['vinyl','fabric','foam-board','acrylic','other'].map(m => (
                                  <option key={m} value={m}>{m}</option>
                                ))}
                              </select>
                              <button
                                onClick={() => removeEditItem(idx)}
                                disabled={editForm.items.length === 1}
                                style={{ background: 'none', border: '1px solid #fca5a5', color: '#dc2626', cursor: 'pointer', fontSize: 13, fontWeight: 700, padding: '4px 6px', opacity: editForm.items.length === 1 ? 0.3 : 1 }}
                              >×</button>
                            </div>
                          ))}
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

                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  )
}
