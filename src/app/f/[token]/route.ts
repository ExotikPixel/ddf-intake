import { NextRequest, NextResponse } from 'next/server'
import { Readable } from 'node:stream'
import path from 'node:path'
import { verifyFileToken } from '@/lib/file-tokens'
import { stat, readStream } from '@/lib/file-store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const TYPES: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  heic: 'image/heic', svg: 'image/svg+xml', pdf: 'application/pdf',
  ai: 'application/postscript', eps: 'application/postscript',
}

// Streams a stored file for a signed link. Files are now served from the app's
// own origin (Supabase used a separate one), so SVGs get a CSP that blocks scripts.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const claims = verifyFileToken(token)
  if (!claims) return new NextResponse('This file link has expired.', { status: 403 })

  let size: number
  try { size = (await stat(claims.key)).size } catch { return new NextResponse('File not found', { status: 404 }) }

  const ext = path.extname(claims.key).slice(1).toLowerCase()
  const headers: Record<string, string> = {
    'Content-Type': TYPES[ext] ?? 'application/octet-stream',
    'Content-Length': String(size),
    'Cache-Control': 'private, max-age=300',
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': 'inline',
  }
  if (ext === 'svg') headers['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'; sandbox"

  const body = Readable.toWeb(readStream(claims.key)) as unknown as ReadableStream<Uint8Array>
  return new NextResponse(body, { headers })
}
