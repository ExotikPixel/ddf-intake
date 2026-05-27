import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { requireAdmin } from '@/lib/admin-auth'

export async function POST(req: NextRequest) {
  const auth = await requireAdmin()
  if ('unauthorized' in auth) return auth.unauthorized

  let body: { jobId: number }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const { jobId } = body
  if (!jobId || typeof jobId !== 'number') {
    return NextResponse.json({ error: 'jobId is required' }, { status: 400 })
  }

  // Fetch the job from our DB
  const { data: job, error } = await supabaseAdmin
    .from('jobs')
    .select('reference_number, client_name, contact_email, date_required, event_name, notes, items')
    .eq('id', jobId)
    .single()

  if (error || !job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  const webhookUrl = process.env.COMMAND_CENTRE_WEBHOOK_URL
  const secret    = process.env.INTAKE_WEBHOOK_SECRET

  if (!webhookUrl || !secret) {
    return NextResponse.json({ error: 'Webhook not configured on server' }, { status: 500 })
  }

  // Forward to Command Centre
  let ccRes: Response
  try {
    ccRes = await fetch(webhookUrl, {
      method:  'POST',
      headers: {
        'Content-Type':    'application/json',
        'x-intake-secret': secret,
      },
      body: JSON.stringify(job),
    })
  } catch (err) {
    console.error('[send-to-cc] network error reaching Command Centre:', err)
    return NextResponse.json({ error: 'Could not reach Command Centre' }, { status: 502 })
  }

  if (!ccRes.ok) {
    const text = await ccRes.text()
    console.error('[send-to-cc] Command Centre returned', ccRes.status, text)
    return NextResponse.json({ error: 'Command Centre rejected the request' }, { status: 502 })
  }

  const result = await ccRes.json()
  return NextResponse.json(result)
}
