'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { useRouter } from 'next/navigation'

interface Job {
  id: number
  reference_number: string
  event_name: string | null
  date_required: string
  status: string
  submitted_at: string
  items: Array<{ name: string; quantity: number; size: string; material: string }>
}

const STATUS_COLORS: Record<string, string> = {
  pending: '#999',
  received: '#1B7F4F',
  in_progress: '#E67E00',
  completed: '#1A1A1A',
  cancelled: '#C62828',
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  received: 'Received',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

export default function PortalPage() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const router = useRouter()

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { router.push('/login'); return }
      setEmail(user.email ?? '')
      supabase
        .from('jobs')
        .select('id, reference_number, event_name, date_required, status, submitted_at, items')
        .eq('contact_email', user.email)
        .order('submitted_at', { ascending: false })
        .then(({ data }) => {
          setJobs(data ?? [])
          setLoading(false)
        })
    })
  }, [router])

  async function signOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <main style={{ minHeight: '100vh', background: 'var(--bg)', fontFamily: 'var(--font-body)' }}>
      <header style={{ background: '#1a1a1a', color: '#fff', padding: '16px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <img src="/logo-pixel.png" alt="Pixel Production" style={{ height: '30px', width: 'auto', filter: 'brightness(0) invert(1)' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <span style={{ fontSize: 13, color: '#999' }}>{email}</span>
          <button onClick={signOut} style={{ background: 'none', border: '1px solid #555', color: '#ccc', padding: '6px 14px', fontSize: 13, cursor: 'pointer' }}>Sign out</button>
        </div>
      </header>

      <div style={{ maxWidth: 900, margin: '0 auto', padding: '40px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700 }}>Your Jobs</h1>
            <p style={{ margin: '4px 0 0', color: 'var(--charcoal-60)', fontSize: 14 }}>Track your submitted print briefs</p>
          </div>
          <a href="/" style={{ background: 'var(--coral)', color: '#fff', padding: '10px 20px', textDecoration: 'none', fontWeight: 700, fontSize: 12, letterSpacing: '1px', textTransform: 'uppercase', borderRadius: 4 }}>+ New Brief</a>
        </div>

        {loading ? (
          <p style={{ color: 'var(--charcoal-60)' }}>Loading your jobs…</p>
        ) : jobs.length === 0 ? (
          <div style={{ background: '#fff', border: '1px solid var(--charcoal-border)', padding: '48px', textAlign: 'center' }}>
            <p style={{ color: 'var(--charcoal-60)', margin: 0 }}>No jobs submitted yet.</p>
            <a href="/" style={{ display: 'inline-block', marginTop: 16, color: 'var(--coral)', fontWeight: 600 }}>Submit your first brief →</a>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {jobs.map(job => (
              <div key={job.id} style={{ background: '#fff', border: '1px solid var(--charcoal-border)', padding: '20px 24px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
                      <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 15, color: 'var(--coral)' }}>{job.reference_number}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: STATUS_COLORS[job.status] ?? '#999', textTransform: 'uppercase', letterSpacing: 1 }}>
                        {STATUS_LABELS[job.status] ?? job.status}
                      </span>
                    </div>
                    {job.event_name && <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 15 }}>{job.event_name}</p>}
                    <p style={{ margin: 0, fontSize: 13, color: 'var(--charcoal-60)' }}>
                      {job.items.length} item{job.items.length !== 1 ? 's' : ''} &nbsp;·&nbsp; Due {job.date_required}
                    </p>
                  </div>
                  <span style={{ fontSize: 12, color: 'var(--charcoal-60)', whiteSpace: 'nowrap' }}>
                    {new Date(job.submitted_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                </div>
                <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {job.items.map((item, i) => (
                    <span key={i} style={{ background: 'var(--bg)', border: '1px solid var(--charcoal-border)', padding: '3px 10px', fontSize: 12, color: 'var(--charcoal)' }}>
                      {item.quantity}× {item.name} ({item.size})
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
