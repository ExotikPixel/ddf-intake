import { NextRequest, NextResponse } from 'next/server'
import { createMiddlewareClient } from '@/lib/supabase-middleware'

const ipMap = new Map<string, { count: number; resetAt: number }>()
const WINDOW_MS = 60_000
const MAX_REQUESTS = 5

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl
  const res = NextResponse.next()

  // Rate limit POST /api/*
  if (req.method === 'POST' && pathname.startsWith('/api/')) {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
    const now = Date.now()
    const entry = ipMap.get(ip)
    if (!entry || now > entry.resetAt) {
      ipMap.set(ip, { count: 1, resetAt: now + WINDOW_MS })
    } else {
      entry.count++
      if (entry.count > MAX_REQUESTS) {
        return NextResponse.json(
          { error: 'Too many requests. Please wait a moment and try again.' },
          { status: 429, headers: { 'Retry-After': '60' } }
        )
      }
    }
  }

  // Auth guard for /admin only. /portal is public and self-gating: it shows the
  // signed-in client's jobs (magic-link session), the one job unlocked by a
  // no-login portal token (reference # + email), or the lookup form when there's
  // neither. Every /api/portal route still enforces ownership via portalCanAccess,
  // so a public /portal page leaks nothing on its own.
  if (pathname.startsWith('/admin')) {
    const supabase = createMiddlewareClient(req, res)
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      const loginUrl = new URL('/login', req.url)
      loginUrl.searchParams.set('next', pathname)
      return NextResponse.redirect(loginUrl)
    }

    const adminEmail = process.env.ADMIN_EMAIL
    if (!adminEmail || user.email !== adminEmail) {
      return NextResponse.redirect(new URL('/portal', req.url))
    }
  }

  return res
}

export const config = {
  matcher: ['/api/:path*', '/admin/:path*'],
}
