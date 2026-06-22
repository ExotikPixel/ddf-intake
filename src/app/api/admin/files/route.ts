import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { requireAdmin } from '@/lib/admin-auth'
import { itemProofs, itemRefPhotos, itemExamplePhotos } from '@/lib/job-types'
import type { JobItem } from '@/lib/job-types'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const auth = await requireAdmin()
  if ('unauthorized' in auth) return auth.unauthorized

  const { paths } = await req.json() as { paths: string[] }
  if (!paths || !Array.isArray(paths)) {
    return NextResponse.json({ error: 'Invalid paths' }, { status: 400 })
  }

  // Only sign paths that belong to a job in the admin's own workspace —
  // otherwise an admin could request another tenant's file paths. The allowlist
  // covers job-level files, per-item design proofs, reference photos, and the
  // example/inspiration photos shown to the client.
  const { data: tenantJobs } = await supabaseAdmin
    .from('jobs')
    .select('file_paths, items')
    .eq('tenant_id', auth.tenantId)
  const allowed = new Set<string>()
  for (const j of tenantJobs ?? []) {
    for (const p of ((j.file_paths as string[]) ?? [])) allowed.add(p)
    for (const it of ((j.items as JobItem[]) ?? [])) {
      for (const p of itemProofs(it)) allowed.add(p)
      for (const p of itemRefPhotos(it)) allowed.add(p)
      for (const p of itemExamplePhotos(it)) allowed.add(p)
    }
  }
  const safePaths = paths.filter(p => allowed.has(p))

  // Generate all signed URLs in parallel (1 hour TTL)
  const results = await Promise.all(
    safePaths.map(path =>
      supabaseAdmin.storage.from('job-files').createSignedUrl(path, 60 * 60)
    )
  )

  const urls = results
    .map((r, i) =>
      r.data?.signedUrl
        ? { path: safePaths[i], url: r.data.signedUrl, name: safePaths[i].split('/').pop() ?? safePaths[i] }
        : null
    )
    .filter((u): u is { path: string; url: string; name: string } => u !== null)

  return NextResponse.json({ urls })
}
