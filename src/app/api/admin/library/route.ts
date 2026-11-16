import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { listLibrary, insertLibraryEntry, deleteLibraryEntry } from '@/lib/library-repo'
import { exists } from '@/lib/file-store'
import { signFileLink } from '@/lib/file-tokens'

export const dynamic = 'force-dynamic'

// The admin's reusable design library — stock images (a white stage, standard
// backdrops, …) attached to items without re-uploading. Files live in the
// files store; this table is the catalogue.

const URL_TTL = 60 * 60

async function urlFor(path: string): Promise<string | null> {
  return (await exists(path)) ? signFileLink(path, URL_TTL) : null
}

export async function GET() {
  const auth = await requireAdmin()
  if ('unauthorized' in auth) return auth.unauthorized

  const { data, error } = await listLibrary(auth.tenantId)
  if (error) return NextResponse.json({ error: 'Failed to load library' }, { status: 500 })

  const rows = data ?? []
  const items = await Promise.all(rows.map(async r => ({ ...r, url: await urlFor(r.path) })))
  return NextResponse.json({ items })
}

// Register a file already uploaded via /api/upload-url as a library entry.
export async function POST(req: NextRequest) {
  const auth = await requireAdmin()
  if ('unauthorized' in auth) return auth.unauthorized

  const body = await req.json().catch(() => ({}))
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const path = typeof body.path === 'string' ? body.path : ''
  if (!name || !path.startsWith('uploads/') || path.includes('..')) {
    return NextResponse.json({ error: 'Invalid name or path' }, { status: 400 })
  }

  const { data, error } = await insertLibraryEntry(auth.tenantId, name.slice(0, 120), path)
  if (error || !data) return NextResponse.json({ error: 'Failed to save library entry' }, { status: 500 })
  return NextResponse.json({ item: { ...data, url: await urlFor(path) } })
}

// Remove from the catalogue only — the file stays, so jobs that already
// attached this design keep their proofs/examples intact.
export async function DELETE(req: NextRequest) {
  const auth = await requireAdmin()
  if ('unauthorized' in auth) return auth.unauthorized

  const body = await req.json().catch(() => ({}))
  if (typeof body.id !== 'number') {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }
  const { error } = await deleteLibraryEntry(body.id, auth.tenantId)
  if (error) return NextResponse.json({ error: 'Failed to delete' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
