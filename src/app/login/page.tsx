'use client'

import { useState, FormEvent } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

  const next = typeof window !== 'undefined'
    ? new URLSearchParams(location.search).get('next') ?? '/portal'
    : '/portal'
  const isAdmin = next.startsWith('/admin')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const supabase = createClient()

    if (isAdmin) {
      // Password login for admin
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        setError(error.message)
        setLoading(false)
      } else {
        router.push(next)
      }
    } else {
      // Magic link for clients
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
      })
      if (error) {
        setError(error.message)
        setLoading(false)
      } else {
        setSent(true)
      }
    }
  }

  return (
    <main style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-body)' }}>
      <div style={{ background: '#fff', padding: '48px 40px', width: '100%', maxWidth: 420, border: '1px solid var(--charcoal-border)' }}>
        <div style={{ marginBottom: 32 }}>
          <img src="/logo-ddfpixel.png" alt="DDF x Pixel" style={{ height: '54px', width: 'auto', marginBottom: 16 }} />
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: 'var(--charcoal)' }}>
            {isAdmin ? 'Admin' : 'Client Portal'}
          </h1>
          <p style={{ margin: '8px 0 0', color: 'var(--charcoal-60)', fontSize: 14 }}>
            {isAdmin ? 'Sign in to manage jobs' : 'Sign in to track your jobs'}
          </p>
        </div>

        {sent ? (
          <div style={{ background: 'var(--coral-light)', border: '1px solid var(--coral)', padding: '20px 24px' }}>
            <p style={{ margin: 0, fontWeight: 600, color: 'var(--coral-dark)' }}>Check your email</p>
            <p style={{ margin: '8px 0 0', fontSize: 14, color: 'var(--charcoal-60)' }}>
              We sent a sign-in link to <strong>{email}</strong>. Click it to access your portal.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6, color: 'var(--charcoal)' }}>
                Email address
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder={isAdmin ? 'admin@ddfevents.ca' : 'you@company.com'}
                style={{ width: '100%', padding: '10px 14px', border: '1.5px solid var(--charcoal-border)', fontSize: 15, outline: 'none', boxSizing: 'border-box', fontFamily: 'var(--font-body)' }}
              />
            </div>

            {isAdmin && (
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6, color: 'var(--charcoal)' }}>
                  Password
                </label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  style={{ width: '100%', padding: '10px 14px', border: '1.5px solid var(--charcoal-border)', fontSize: 15, outline: 'none', boxSizing: 'border-box', fontFamily: 'var(--font-body)' }}
                />
              </div>
            )}

            {error && <p style={{ color: 'var(--red-err)', fontSize: 13, marginBottom: 16 }}>{error}</p>}

            <button
              type="submit"
              disabled={loading}
              style={{ width: '100%', background: loading ? '#999' : 'var(--coral)', color: '#fff', border: 'none', padding: '12px', fontSize: 15, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', letterSpacing: 0.5 }}
            >
              {loading ? 'Signing in…' : isAdmin ? 'Sign In' : 'Send Sign-in Link'}
            </button>
          </form>
        )}

        {!isAdmin && (
          <p style={{ marginTop: 24, fontSize: 13, color: 'var(--charcoal-60)', textAlign: 'center' }}>
            Need to submit a job? <a href="/" style={{ color: 'var(--coral)', textDecoration: 'none', fontWeight: 600 }}>Submit a brief →</a>
          </p>
        )}
      </div>
    </main>
  )
}
