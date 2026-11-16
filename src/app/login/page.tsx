'use client'

import { useEffect, useState, FormEvent } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [next, setNext] = useState('/admin')

  useEffect(() => {
    const n = new URLSearchParams(location.search).get('next') ?? '/admin'
    // Clients don't sign in any more — the portal uses reference # + email.
    if (!n.startsWith('/admin')) { router.replace('/portal'); return }
    setNext(n)
  }, [router])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      if (res.ok) { router.push(next); return }
      if (res.status === 429) setError('Too many attempts — wait a minute and try again.')
      else setError((await res.json().catch(() => null))?.error ?? 'Sign-in failed.')
    } catch {
      setError('Network error — please try again.')
    }
    setLoading(false)
  }

  const input = { width: '100%', padding: '10px 14px', border: '1.5px solid var(--charcoal-border)', fontSize: 15, outline: 'none', boxSizing: 'border-box' as const, fontFamily: 'var(--font-body)' }
  const label = { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6, color: 'var(--charcoal)' }

  return (
    <main style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-body)' }}>
      <div style={{ background: '#fff', padding: '48px 40px', width: '100%', maxWidth: 420, border: '1px solid var(--charcoal-border)' }}>
        <div style={{ marginBottom: 32 }}>
          <img src="/logo-ddfpixel.png" alt="DDF x Pixel" style={{ height: '54px', width: 'auto', marginBottom: 16 }} />
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: 'var(--charcoal)' }}>Admin</h1>
          <p style={{ margin: '8px 0 0', color: 'var(--charcoal-60)', fontSize: 14 }}>Sign in to manage jobs</p>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <label style={label}>Email address</label>
            <input type="email" required autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} placeholder="admin@ddfevents.ca" style={input} />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={label}>Password</label>
            <input type="password" required autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" style={input} />
          </div>
          {error && <p style={{ color: 'var(--red-err)', fontSize: 13, marginBottom: 16 }}>{error}</p>}
          <button type="submit" disabled={loading} style={{ width: '100%', background: loading ? '#999' : 'var(--coral)', color: '#fff', border: 'none', padding: '12px', fontSize: 15, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', letterSpacing: 0.5 }}>
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </main>
  )
}
