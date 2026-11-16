import { NextRequest, NextResponse } from 'next/server'
import { getJob } from '@/lib/jobs-repo'
import { itemProofs, itemExamplePhotos } from '@/lib/job-types'
import type { JobItem } from '@/lib/job-types'
import { portalCanAccess } from '@/lib/portal-auth'
import { signProofDisplayUrls } from '@/lib/proof-sign'

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

  if (!(await portalCanAccess(jobId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: job } = await getJob(jobId, ['items'])
  if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const items = (job.items ?? []) as JobItem[]
  const paths = items.flatMap(it => [...itemProofs(it), ...itemExamplePhotos(it)])

  if (paths.length === 0) return NextResponse.json({ urls: {}, fileUrls: {} })

  // Non-image proofs (PDF/AI/EPS) resolve to their preview image or a labelled
  // tile; fileUrls carries the signed original for "Open file".
  const { urls, fileUrls } = await signProofDisplayUrls(items, paths)

  return NextResponse.json({ urls, fileUrls })
}
