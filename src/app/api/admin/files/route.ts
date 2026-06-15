import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { requireAdmin } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const auth = await requireAdmin()
  if ('unauthorized' in auth) return auth.unauthorized

  const { paths } = await req.json() as { paths: string[] }
  if (!paths || !Array.isArray(paths)) {
    return NextResponse.json({ error: 'Invalid paths' }, { status: 400 })
  }

  // Only sign paths that belong to a job in the admin's own workspace —
  // otherwise an admin could request another tenant's file paths.
  const { data: tenantJobs } = await supabaseAdmin
    .from('jobs')
    .select('file_paths')
    .eq('tenant_id', auth.tenantId)
  const allowed = new Set((tenantJobs ?? []).flatMap(j => (j.file_paths as string[]) ?? []))
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
