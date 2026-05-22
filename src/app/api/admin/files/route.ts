import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { requireAdmin } from '@/lib/admin-auth'

export async function POST(req: NextRequest) {
  const auth = await requireAdmin()
  if ('unauthorized' in auth) return auth.unauthorized

  const { paths } = await req.json() as { paths: string[] }
  if (!paths || !Array.isArray(paths)) {
    return NextResponse.json({ error: 'Invalid paths' }, { status: 400 })
  }

  // Generate all signed URLs in parallel (1 hour TTL)
  const results = await Promise.all(
    paths.map(path =>
      supabaseAdmin.storage.from('job-files').createSignedUrl(path, 60 * 60)
    )
  )

  const urls = results
    .map((r, i) =>
      r.data?.signedUrl
        ? { path: paths[i], url: r.data.signedUrl, name: paths[i].split('/').pop() ?? paths[i] }
        : null
    )
    .filter((u): u is { path: string; url: string; name: string } => u !== null)

  return NextResponse.json({ urls })
}
