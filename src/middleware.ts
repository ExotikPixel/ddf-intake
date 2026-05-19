import { NextRequest, NextResponse } from 'next/server'

// In-memory rate limiter: 5 POST requests per IP per minute to /api/*
// Single-region Vercel deployment — sufficient for v1.
// Upgrade to Upstash Redis if multi-region needed in Phase 2.
const ipMap = new Map<string, { count: number; resetAt: number }>()
const WINDOW_MS = 60_000
const MAX_REQUESTS = 5

export function middleware(req: NextRequest) {
  if (req.method !== 'POST' || !req.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.next()
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const now = Date.now()

  const entry = ipMap.get(ip)
  if (!entry || now > entry.resetAt) {
    ipMap.set(ip, { count: 1, resetAt: now + WINDOW_MS })
    return NextResponse.next()
  }

  entry.count++
  if (entry.count > MAX_REQUESTS) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait a moment and try again.' },
      { status: 429, headers: { 'Retry-After': '60' } }
    )
  }

  return NextResponse.next()
}

export const config = {
  matcher: '/api/:path*',
}
