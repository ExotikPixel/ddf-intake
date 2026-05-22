'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { useRouter } from 'next/navigation'
import { STATUS_CONFIG } from '@/lib/job-types'
import type { JobItem } from '@/lib/job-types'

interface Job {
  id: number
  reference_number: string
  event_name: string | null
  date_required: string
  status: string
  submitted_at: string
  items: JobItem[]
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
              {jobs.map(job => (
                <div key={job.id} style={{ background: '#fff', border: '1px solid var(--charcoal-border)', padding: '20px 24px', borderLeft: `3px solid ${STATUS_CONFIG[job.status]?.color ?? '#888'}` }}>
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
                    <span style={{ fontSize: '12px', color: 'var(--charcoal-60)', whiteSpace: 'nowrap', flexShrink: 0, marginTop: '2px' }}>
                      {new Date(job.submitted_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </span>
                  </div>
                  <div style={{ marginTop: '14px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {job.items.map((item, i) => (
                      <span key={i} style={{ background: 'var(--bg)', border: '1px solid var(--charcoal-border)', padding: '3px 10px', fontSize: '12px', color: 'var(--charcoal-60)' }}>
                        {item.quantity}× {item.name} · {item.size}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
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
