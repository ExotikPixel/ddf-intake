import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { requireAdmin } from '@/lib/admin-auth'
import { itemProofs, itemRefPhotos, itemExamplePhotos } from '@/lib/job-types'
import type { JobItem } from '@/lib/job-types'
import { signProofDisplayUrls } from '@/lib/proof-sign'

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
  const allItems: JobItem[] = []
  for (const j of tenantJobs ?? []) {
    for (const p of ((j.file_paths as string[]) ?? [])) allowed.add(p)
    for (const it of ((j.items as JobItem[]) ?? [])) {
      allItems.push(it)
      for (const p of itemProofs(it)) allowed.add(p)
      for (const p of (it.proof_history ?? [])) allowed.add(p)
      for (const p of itemRefPhotos(it)) allowed.add(p)
      for (const p of itemExamplePhotos(it)) allowed.add(p)
    }
  }
  const safePaths = paths.filter(p => allowed.has(p))

  // Non-image proofs (PDF/AI/EPS) resolve to their preview image or a labelled
  // tile in `url`; `fileUrl` is the signed original for "Open file".
  const { urls: display, fileUrls } = await signProofDisplayUrls(allItems, safePaths)

  const urls = safePaths
    .filter(p => display[p])
    .map(p => ({ path: p, url: display[p], fileUrl: fileUrls[p], name: p.split('/').pop() ?? p }))

  return NextResponse.json({ urls })
}
