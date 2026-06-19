import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { requireAdmin } from '@/lib/admin-auth'
import { syncApprovedItemsToKanban } from '@/lib/kanban-sync'

export const dynamic = 'force-dynamic'

// Admin-only: manually re-push a job's approved items to the Command Centre
// Kanban board (refreshes client notes, designs, and specs on existing tiles)
// without needing to re-approve an item.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin()
  if ('unauthorized' in auth) return auth.unauthorized

  const { id } = await params
  const jobId = parseInt(id, 10)
  if (isNaN(jobId)) return NextResponse.json({ error: 'Invalid job ID' }, { status: 400 })

  // Only resync a job in the admin's own workspace.
  const { data: job } = await supabaseAdmin
    .from('jobs')
    .select('id')
    .eq('id', jobId)
    .eq('tenant_id', auth.tenantId)
    .maybeSingle()
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  const result = await syncApprovedItemsToKanban(jobId)
  return NextResponse.json(result)
}
