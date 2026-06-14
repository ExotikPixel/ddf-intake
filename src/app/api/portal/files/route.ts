import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { itemProofs } from '@/lib/job-types'
import type { JobItem } from '@/lib/job-types'

export const dynamic = 'force-dynamic'

// Sign proof URLs for a job the caller owns. Scoped to the job's own item
// proof paths so a client can never sign an arbitrary storage path.
export async function POST(req: NextRequest) {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { jobId?: number }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const jobId = Number(body.jobId)
  if (!Number.isInteger(jobId)) return NextResponse.json({ error: 'Invalid jobId' }, { status: 400 })

  const { data: job } = await supabaseAdmin
    .from('jobs')
    .select('contact_email, items')
    .eq('id', jobId)
    .single()

  if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (job.contact_email !== user.email) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const paths = ((job.items ?? []) as JobItem[]).flatMap(itemProofs)

  if (paths.length === 0) return NextResponse.json({ urls: {} })

  const results = await Promise.all(
    paths.map(path => supabaseAdmin.storage.from('job-files').createSignedUrl(path, 60 * 60))
  )

  const urls: Record<string, string> = {}
  results.forEach((r, i) => {
    if (r.data?.signedUrl) urls[paths[i]] = r.data.signedUrl
  })

  return NextResponse.json({ urls })
}
