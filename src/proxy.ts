import { NextRequest, NextResponse } from 'next/server'
import { verifySession, ADMIN_COOKIE } from '@/lib/session'

const ipMap = new Map<string, { count: number; resetAt: number }>()
const WINDOW_MS = 60_000
// A client uploading final artwork makes several POSTs per item (signed URL,
// preview, save), so signed-URL requests get their own, looser budget.
const MAX_REQUESTS = 20
const MAX_UPLOAD_URL_REQUESTS = 60
const MAX_LOGIN_REQUESTS = 5

function clientIp(req: NextRequest): string {
  // Behind Cloudflare Tunnel the real client IP is in CF-Connecting-IP.
  return req.headers.get('cf-connecting-ip')
    ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? 'unknown'
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Rate limit POST /api/*
  if (req.method === 'POST' && pathname.startsWith('/api/')) {
    const kind = pathname === '/api/upload-url' ? 'upload' : pathname === '/api/admin/login' ? 'login' : 'api'
    const limit = kind === 'upload' ? MAX_UPLOAD_URL_REQUESTS : kind === 'login' ? MAX_LOGIN_REQUESTS : MAX_REQUESTS
    const bucket = `${clientIp(req)}:${kind}`
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

  // /admin pages need a valid admin session cookie. API routes re-check with
  // requireAdmin() (which also confirms the admin still exists).
  if (pathname.startsWith('/admin')) {
    const session = await verifySession(req.cookies.get(ADMIN_COOKIE)?.value)
    if (!session) {
      const loginUrl = new URL('/login', req.url)
      loginUrl.searchParams.set('next', pathname)
      return NextResponse.redirect(loginUrl)
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/api/:path*', '/admin/:path*'],
}
