import { NextResponse } from 'next/server'
import { promises as fsp, constants } from 'node:fs'
import { db } from '@/lib/db'
import { filesRoot } from '@/lib/file-store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Used by the ops loop (every 10 min) and the uptime check. Reveals nothing but up/down.
export async function GET() {
  const status = { db: 'down', files: 'down' }
  try { await db()`select 1`; status.db = 'ok' } catch (e) { console.error('[health] db:', e) }
  try { await fsp.access(filesRoot(), constants.W_OK); status.files = 'ok' } catch (e) { console.error('[health] files:', e) }
  const ok = status.db === 'ok' && status.files === 'ok'
  return NextResponse.json(status, { status: ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } })
}
