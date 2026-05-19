'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { useRouter } from 'next/navigation'

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
  items: Array<{ name: string; quantity: number; size: string; material: string }>
  file_paths: string[]
}

const STATUSES = ['pending', 'received', 'in_progress', 'completed', 'cancelled']
const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  received: 'Received',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
}
const STATUS_COLORS: Record<string, string> = {
  pending: '#999',
  received: '#1B7F4F',
  in_progress: '#E67E00',
  completed: '#1A1A1A',
  cancelled: '#C62828',
}

export default function AdminPage() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [updating, setUpdating] = useState<number | null>(null)
  const router = useRouter()

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { router.push('/login'); return }
      fetchJobs(supabase)
    })
  }, [router])

  async function fetchJobs(supabase: ReturnType<typeof createClient>) {
    const { data } = await supabase
      .from('jobs')
      .select('*')
      .order('submitted_at', { ascending: false })
    setJobs(data ?? [])
    setLoading(false)
  }

  async function updateStatus(jobId: number, newStatus: string) {
    setUpdating(jobId)
    const res = await fetch(`/api/admin/jobs/${jobId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    })
    if (res.ok) {
      setJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: newStatus } : j))
    }
    setUpdating(null)
  }

  async function signOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  const filtered = filter === 'all' ? jobs : jobs.filter(j => j.status === filter)

  return (
    <main style={{ minHeight: '100vh', background: 'var(--bg)', fontFamily: 'var(--font-body)' }}>
      <header style={{ background: '#1a1a1a', color: '#fff', padding: '16px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, letterSpacing: 3, fontSize: 18 }}>DDF-PIXEL</span>
          <span style={{ marginLeft: 12, fontSize: 12, background: 'var(--coral)', padding: '2px 8px', fontWeight: 700, letterSpacing: 1 }}>ADMIN</span>
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

        {loading ? <p style={{ color: 'var(--charcoal-60)' }}>Loading…</p> : (
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
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
