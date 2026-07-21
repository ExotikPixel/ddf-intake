import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { requireAdmin } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

// The admin's reusable design library — stock images (a white stage, standard
// backdrops, …) attached to items without re-uploading. Files live in the
// job-files bucket; this table is the catalogue.

export async function GET() {
  const auth = await requireAdmin()
  if ('unauthorized' in auth) return auth.unauthorized

  const { data, error } = await supabaseAdmin
    .from('design_library')
    .select('id, name, path, created_at')
    .eq('tenant_id', auth.tenantId)
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: 'Failed to load library' }, { status: 500 })

  const rows = data ?? []
  const signed = await Promise.all(
    rows.map(r => supabaseAdmin.storage.from('job-files').createSignedUrl(r.path, 60 * 60))
  )
  const items = rows.map((r, i) => ({ ...r, url: signed[i].data?.signedUrl ?? null }))
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

  const { data, error } = await supabaseAdmin
    .from('design_library')
    .insert({ tenant_id: auth.tenantId, name: name.slice(0, 120), path })
    .select('id, name, path, created_at')
    .single()
  if (error || !data) return NextResponse.json({ error: 'Failed to save library entry' }, { status: 500 })

  const { data: s } = await supabaseAdmin.storage.from('job-files').createSignedUrl(path, 60 * 60)
  return NextResponse.json({ item: { ...data, url: s?.signedUrl ?? null } })
}

// Remove from the catalogue only — the storage object stays, so jobs that
// already attached this design keep their proofs/examples intact.
export async function DELETE(req: NextRequest) {
  const auth = await requireAdmin()
  if ('unauthorized' in auth) return auth.unauthorized

  const body = await req.json().catch(() => ({}))
  if (typeof body.id !== 'number') {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }
  const { error } = await supabaseAdmin
    .from('design_library')
    .delete()
    .eq('id', body.id)
    .eq('tenant_id', auth.tenantId)
  if (error) return NextResponse.json({ error: 'Failed to delete' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
