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
}

function escHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
         .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

const STATUS_COLORS: Record<string, string> = Object.fromEntries(
  Object.entries(STATUS_CONFIG).map(([k, v]) => [k, v.color])
)

export default function AdminPage() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [filter, setFilter] = useState('all')
  const [updating, setUpdating] = useState<number | null>(null)
  const [fileUrls, setFileUrls] = useState<Record<number, { path: string; name: string; url: string }[]>>({})
  const [loadingFiles, setLoadingFiles] = useState<number | null>(null)
  const [fileError, setFileError] = useState<number | null>(null)
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
    } catch {
      setFileError(jobId)
    } finally {
      setLoadingFiles(null)
    }
  }

  function printJobTicket(job: Job) {
    const statusLabel = STATUS_LABELS[job.status] ?? job.status
    const submittedDate = new Date(job.submitted_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' })
    const printDate = new Date().toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })

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
  <!-- Print button (screen only) -->
  <div class="no-print" style="margin-bottom:24px;display:flex;gap:10px;">
    <button onclick="window.print()" style="background:#1a1a1a;color:#fff;border:none;padding:10px 24px;font-size:13px;font-weight:700;cursor:pointer;letter-spacing:1px;text-transform:uppercase;">Print Ticket</button>
    <button onclick="window.close()" style="background:#fff;color:#1a1a1a;border:1px solid #ccc;padding:10px 24px;font-size:13px;cursor:pointer;">Close</button>
  </div>

  <!-- Ticket start -->
  <div style="max-width:720px;margin:0 auto;">

    <!-- Header -->
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

    <!-- Client info -->
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

    <!-- Items -->
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

    <!-- Footer -->
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

  return (
    <main style={{ minHeight: '100vh', background: 'var(--bg)', fontFamily: 'var(--font-body)' }}>
      <header style={{ background: '#1a1a1a', color: '#fff', padding: '16px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <img src="/logo-pixel.png" alt="Pixel Production" style={{ height: '30px', width: 'auto', filter: 'brightness(0) invert(1)' }} />
            <span style={{ fontSize: 11, background: 'var(--coral)', color: '#fff', padding: '2px 8px', fontWeight: 700, letterSpacing: 1, borderRadius: 3 }}>ADMIN</span>
          </div>
        </div>
        <button onClick={signOut} style={{ background: 'none', border: '1px solid #555', color: '#ccc', padding: '6px 14px', fontSize: 13, cursor: 'pointer' }}>Sign out</button>
      </header>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '40px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700 }}>All Jobs <span style={{ fontSize: 18, color: 'var(--charcoal-60)', fontWeight: 400 }}>({filtered.length})</span></h1>
          <div style={{ display: 'flex', gap: 8 }}>
            {['all', ...STATUSES].map(s => (
              <button key={s} onClick={() => setFilter(s)}
                style={{ padding: '6px 14px', fontSize: 13, fontWeight: filter === s ? 700 : 400, background: filter === s ? '#1a1a1a' : '#fff', color: filter === s ? '#fff' : 'var(--charcoal)', border: '1px solid var(--charcoal-border)', cursor: 'pointer' }}>
                {s === 'all' ? 'All' : STATUS_LABELS[s]}
              </button>
            ))}
          </div>
        </div>

        {loading ? <p style={{ color: 'var(--charcoal-60)' }}>Loading…</p> : loadError ? <p style={{ color: 'var(--red-err)' }}>{loadError}</p> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {filtered.map(job => (
              <div key={job.id} style={{ background: '#fff', border: '1px solid var(--charcoal-border)', padding: '20px 24px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
                      <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, color: 'var(--coral)' }}>{job.reference_number}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: STATUS_COLORS[job.status], textTransform: 'uppercase', letterSpacing: 1 }}>
                        {STATUS_LABELS[job.status]}
                      </span>
                    </div>
                    <p style={{ margin: '0 0 2px', fontWeight: 600 }}>{job.client_name} — {job.company_name}</p>
                    <p style={{ margin: 0, fontSize: 13, color: 'var(--charcoal-60)' }}>
                      <a href={`mailto:${job.contact_email}`} style={{ color: 'var(--charcoal-60)' }}>{job.contact_email}</a>
                      &nbsp;·&nbsp; Due <strong style={{ color: 'var(--charcoal)' }}>{job.date_required}</strong>
                      {job.event_name && <>&nbsp;·&nbsp; {job.event_name}</>}
                    </p>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: 12, color: 'var(--charcoal-60)' }}>
                      {new Date(job.submitted_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </span>
                    <button
                      onClick={() => printJobTicket(job)}
                      title="Print job ticket"
                      style={{ fontSize: 12, fontWeight: 700, color: 'var(--charcoal)', background: '#fff', border: '1px solid var(--charcoal-border)', padding: '6px 12px', cursor: 'pointer', fontFamily: 'var(--font-body)', display: 'flex', alignItems: 'center', gap: 5 }}
                    >
                      🖨 Print
                    </button>
                    <select
                      value={job.status}
                      disabled={updating === job.id}
                      onChange={e => updateStatus(job.id, e.target.value)}
                      style={{ padding: '6px 10px', fontSize: 13, border: '1.5px solid var(--charcoal-border)', background: '#fff', cursor: 'pointer', fontFamily: 'var(--font-body)' }}
                    >
                      {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                    </select>
                  </div>
                </div>
                <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {job.items.map((item, i) => (
                    <span key={i} style={{ background: 'var(--bg)', border: '1px solid var(--charcoal-border)', padding: '3px 10px', fontSize: 12 }}>
                      {item.quantity}× {item.name} ({item.size}, {item.material})
                    </span>
                  ))}
                </div>
                {job.notes && <p style={{ margin: '10px 0 0', fontSize: 13, color: 'var(--charcoal-60)', borderTop: '1px solid var(--charcoal-border)', paddingTop: 10 }}><strong>Notes:</strong> {job.notes}</p>}

                {/* Files section */}
                {job.file_paths.length > 0 && (
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--charcoal-border)' }}>
                    {fileUrls[job.id] ? (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--charcoal-60)', textTransform: 'uppercase', letterSpacing: 1 }}>Files:</span>
                        {fileUrls[job.id].map(f => (
                          <a
                            key={f.path}
                            href={f.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ fontSize: 12, color: 'var(--coral)', textDecoration: 'none', fontWeight: 600, background: 'var(--coral-light)', border: '1px solid var(--coral)', padding: '3px 10px' }}
                          >
                            ↓ {f.name}
                          </a>
                        ))}
                      </div>
                    ) : fileError === job.id ? (
                      <span style={{ fontSize: 12, color: 'var(--red-err)' }}>Failed to load files — try again.</span>
                    ) : (
                      <button
                        onClick={() => loadFiles(job.id, job.file_paths)}
                        disabled={loadingFiles === job.id}
                        style={{ fontSize: 12, fontWeight: 700, color: 'var(--coral)', background: 'none', border: '1px solid var(--coral)', padding: '4px 12px', cursor: 'pointer', fontFamily: 'var(--font-body)' }}
                      >
                        {loadingFiles === job.id ? 'Loading…' : `View ${job.file_paths.length} attached file${job.file_paths.length !== 1 ? 's' : ''}`}
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
