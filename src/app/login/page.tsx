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

  return (
    <main className="cx">
      <div className="paper-grain" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 20 }}>
        <div className="panel" style={{ width: '100%', maxWidth: 420, padding: '40px 34px', display: 'grid', gap: 22 }}>
          <div style={{ display: 'grid', gap: 14 }}>
            <img src="/logo-ddfpixel.png" alt="DDF x Pixel" className="logo" style={{ height: 40 }} />
            <h1 className="display" style={{ margin: 0, fontSize: 40 }}>Welcome <span className="serif">back.</span></h1>
            <p className="muted" style={{ margin: 0 }}>Sign in to manage jobs.</p>
          </div>
          <form onSubmit={handleSubmit} className="stack" style={{ gap: 16 }}>
            <div className="field">
              <label className="label" htmlFor="l-email">Email</label>
              <input id="l-email" className="input" type="email" required autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} placeholder="admin@ddfevents.ca" />
            </div>
            <div className="field">
              <label className="label" htmlFor="l-pass">Password</label>
              <input id="l-pass" className="input" type="password" required autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" />
            </div>
            {error && <div className="alert" role="alert">{error}</div>}
            <button type="submit" className="btn btn-ink btn-block" disabled={loading}>{loading ? 'Signing in…' : 'Sign in'}</button>
          </form>
          <a className="link tiny" href="/portal" style={{ justifySelf: 'center' }}>Looking for your job? Open the client portal</a>
        </div>
      </div>
    </main>
  )
}
