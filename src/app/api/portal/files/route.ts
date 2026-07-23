import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { itemProofs, itemExamplePhotos } from '@/lib/job-types'
import type { JobItem } from '@/lib/job-types'
import { portalCanAccess } from '@/lib/portal-auth'

export const dynamic = 'force-dynamic'

// Sign proof URLs for a job the caller owns. Scoped to the job's own item
// proof paths so a client can never sign an arbitrary storage path.
export async function POST(req: NextRequest) {
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
  if (!(await portalCanAccess(jobId, job.contact_email))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const paths = ((job.items ?? []) as JobItem[]).flatMap(it => [...itemProofs(it), ...itemExamplePhotos(it)])

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
