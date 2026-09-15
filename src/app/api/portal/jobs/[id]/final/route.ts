import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { FinalDesignSchema } from '@/lib/schemas'
import { sendNtfy } from '@/lib/ntfy'
import { itemProofs } from '@/lib/job-types'
import type { JobItem } from '@/lib/job-types'
import { syncApprovedItemsToKanban } from '@/lib/kanban-sync'
import { portalCanAccess } from '@/lib/portal-auth'

export const dynamic = 'force-dynamic'

// Client uploads their OWN print-ready artwork for one item. The file(s) become
// the item's proof — replacing whatever the shop had attached (old proofs move
// to proof_history) — and, by default, the item is approved for print in the
// same step so the shop never has to re-upload and send an approval link.
// Files are uploaded first via /api/upload-url; this only records the paths.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const jobId = parseInt(id, 10)
  if (isNaN(jobId)) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })

  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const parsed = FinalDesignSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid final-design payload' }, { status: 400 })
  }
  const { itemIndex, paths, previews, approve } = parsed.data

  const { data: job } = await supabaseAdmin
    .from('jobs')
    .select('contact_email, reference_number, client_name, company_name, items, status')
    .eq('id', jobId)
    .single()

  if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!(await portalCanAccess(jobId, job.contact_email))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (job.status === 'completed' || job.status === 'cancelled') {
    return NextResponse.json({ error: 'This job is closed' }, { status: 409 })
  }

  const existingItems = (job.items ?? []) as JobItem[]
  const item = existingItems[itemIndex]
  if (!item) return NextResponse.json({ error: 'Item not found' }, { status: 404 })
  if (item.completed) {
    return NextResponse.json({ error: 'This item has already been produced' }, { status: 409 })
  }

  // Make sure every path is a real object the client just uploaded — never
  // trust a path string blindly (it could point at another job's file).
  const previewMap: Record<string, string> = {}
  for (const [proof, pv] of Object.entries(previews ?? {})) if (paths.includes(proof)) previewMap[proof] = pv
  for (const p of [...paths, ...Object.values(previewMap)]) {
    const { data, error } = await supabaseAdmin.storage.from('job-files').list('uploads', { search: p.slice('uploads/'.length), limit: 1 })
    if (error || !data?.length) {
      return NextResponse.json({ error: 'One of the uploaded files could not be found' }, { status: 400 })
    }
  }

  const now = new Date().toISOString()
  const previous = itemProofs(item)
  const patch: Record<string, unknown> = {
    proof_urls: paths,
    proof_url: null,
    proof_history: [...(item.proof_history ?? []), ...previous.filter(p => !paths.includes(p))],
    proof_previews: Object.keys(previewMap).length ? previewMap : null,
    proof_source: 'client',
    proof_uploaded_at: now,
    designs_mode: 'all',
    approved_proof_url: null,
    client_note: null,
    approval_status: approve ? 'approved' : 'pending',
    approved_at: approve ? now : null,
  }
  const n = paths.length
  const appendMessage = {
    from: 'client',
    text: approve
      ? `Uploaded ${n === 1 ? 'my final print-ready file' : `${n} final print-ready files`} and approved for print.`
      : `Uploaded ${n === 1 ? 'my final print-ready file' : `${n} final print-ready files`} for review.`,
    at: now,
  }

  const { data: updatedItems, error } = await supabaseAdmin.rpc('update_job_item', {
    p_job_id: jobId, p_index: itemIndex, p_patch: patch, p_append_message: appendMessage,
  })
  if (error) return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  const items = (updatedItems ?? []) as JobItem[]

  const who = job.company_name || job.client_name
  if (approve) {
    await syncApprovedItemsToKanban(jobId)
    const proofed = items.filter(it => itemProofs(it).length > 0)
    const full = proofed.length > 0 && proofed.every(it => it.approval_status === 'approved')
    await sendNtfy({
      title: 'Client uploaded their final design',
      message: `${who} (${job.reference_number})\n${item.name}: ${n} file${n !== 1 ? 's' : ''} uploaded and approved for print — check the file before production.`,
      tags: 'inbox_tray,white_check_mark',
      priority: 4,
    })
    if (full) {
      await sendNtfy({
        title: 'Job fully approved',
        message: `${job.reference_number} — all designs approved, ready for production`,
        tags: 'checkered_flag',
        priority: 4,
      })
    }
  } else {
    await sendNtfy({
      title: 'Client uploaded a final design',
      message: `${who} (${job.reference_number})\n${item.name}: ${n} file${n !== 1 ? 's' : ''} uploaded, awaiting their approval.`,
      tags: 'inbox_tray',
      priority: 3,
    })
  }

  return NextResponse.json({ success: true, items })
}
