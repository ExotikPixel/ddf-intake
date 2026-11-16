import { baseUrl } from '@/lib/file-tokens'
import { NextRequest, NextResponse } from 'next/server'
import { getJob } from '@/lib/jobs-repo'
import { requireAdmin } from '@/lib/admin-auth'
import { signReviewToken } from '@/lib/review-token'

export const dynamic = 'force-dynamic'

// Admin-only: returns the public, no-login approval link for a job.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin()
  if ('unauthorized' in auth) return auth.unauthorized

  const { id } = await params
  const jobId = parseInt(id, 10)
  if (isNaN(jobId)) return NextResponse.json({ error: 'Invalid job ID' }, { status: 400 })

  // Only mint a link for a job in the admin's own workspace.
  const { data: job } = await getJob(jobId, ['id'], auth.tenantId)
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  const url = `${baseUrl()}/review/${signReviewToken(jobId)}`

  return NextResponse.json({ url })
}
