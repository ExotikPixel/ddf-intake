import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { requireAdmin } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest) {
  const auth = await requireAdmin()
  if ('unauthorized' in auth) return auth.unauthorized

  const { data, error } = await supabaseAdmin
    .from('jobs')
    .select('*')
    .eq('tenant_id', auth.tenantId)
    .order('submitted_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: 'Failed to fetch jobs' }, { status: 500 })
  }

  return NextResponse.json({ jobs: data })
}
