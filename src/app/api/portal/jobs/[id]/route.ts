import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const jobId = parseInt(id, 10)
  if (isNaN(jobId)) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })

  // Verify ownership and status
  const { data: job } = await supabaseAdmin
    .from('jobs')
    .select('contact_email, status, file_paths')
    .eq('id', jobId)
    .single()

  if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (job.contact_email !== user.email) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!['pending', 'received'].includes(job.status)) {
    return NextResponse.json({ error: 'Brief cannot be edited at this stage' }, { status: 409 })
  }

  let body: Record<string, unknown>
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const patch: Record<string, unknown> = {}
  if ('date_required' in body) patch.date_required = body.date_required
  if ('event_name' in body)   patch.event_name   = body.event_name ?? null
  if ('notes' in body)        patch.notes        = body.notes ?? null
  if ('items' in body)        patch.items        = body.items
  if ('file_paths' in body) {
    const newPaths = body.file_paths as string[]
    const removed = (job.file_paths as string[] ?? []).filter((p: string) => !newPaths.includes(p))
    if (removed.length > 0) {
      await supabaseAdmin.storage.from('job-files').remove(removed)
    }
    patch.file_paths = newPaths
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const { error } = await supabaseAdmin.from('jobs').update(patch).eq('id', jobId)
  if (error) return NextResponse.json({ error: 'Update failed' }, { status: 500 })

  return NextResponse.json({ success: true })
}
