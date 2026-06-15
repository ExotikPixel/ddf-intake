import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
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
  const { data: job } = await supabaseAdmin
    .from('jobs')
    .select('id')
    .eq('id', jobId)
    .eq('tenant_id', auth.tenantId)
    .maybeSingle()
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  const proto = req.headers.get('x-forwarded-proto') ?? 'https'
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? ''
  const url = `${proto}://${host}/review/${signReviewToken(jobId)}`

  return NextResponse.json({ url })
}
