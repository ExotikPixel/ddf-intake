import { NextRequest, NextResponse } from 'next/server'
import { createMiddlewareClient } from '@/lib/supabase-middleware'

const ipMap = new Map<string, { count: number; resetAt: number }>()
const WINDOW_MS = 60_000
// A client uploading final artwork makes several POSTs per item (signed URL,
// preview, save) — 5/min was hit by two items in a row. Signed-URL requests
// are cheap and already validated, so they get their own, looser budget.
const MAX_REQUESTS = 20
const MAX_UPLOAD_URL_REQUESTS = 60

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl
  const res = NextResponse.next()

  // Rate limit POST /api/*
  if (req.method === 'POST' && pathname.startsWith('/api/')) {
    const isUploadUrl = pathname === '/api/upload-url'
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
    const bucket = isUploadUrl ? `${ip}:upload` : ip
    const limit = isUploadUrl ? MAX_UPLOAD_URL_REQUESTS : MAX_REQUESTS
    const now = Date.now()
    const entry = ipMap.get(bucket)
    if (!entry || now > entry.resetAt) {
      ipMap.set(bucket, { count: 1, resetAt: now + WINDOW_MS })
    } else {
      entry.count++
      if (entry.count > limit) {
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
