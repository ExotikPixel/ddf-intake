import { NextRequest, NextResponse } from 'next/server'
import { createMiddlewareClient } from '@/lib/supabase-middleware'

const ipMap = new Map<string, { count: number; resetAt: number }>()
const WINDOW_MS = 60_000
const MAX_REQUESTS = 5

export async function middleware(req: NextRequest) {
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

  // Auth guard for /portal and /admin
  if (pathname.startsWith('/portal') || pathname.startsWith('/admin')) {
    const supabase = createMiddlewareClient(req, res)
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      const loginUrl = new URL('/login', req.url)
      loginUrl.searchParams.set('next', pathname)
      return NextResponse.redirect(loginUrl)
    }

    // Admin-only guard
    if (pathname.startsWith('/admin')) {
      const adminEmail = process.env.ADMIN_EMAIL
      if (!adminEmail || user.email !== adminEmail) {
        return NextResponse.redirect(new URL('/portal', req.url))
      }
    }
  }

  return res
}

export const config = {
  matcher: ['/api/:path*', '/portal/:path*', '/admin/:path*'],
}
