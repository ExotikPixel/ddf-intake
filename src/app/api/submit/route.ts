import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { sendNotificationEmail, sendConfirmationEmail } from '@/lib/email'
import { sendNtfy } from '@/lib/ntfy'

export const dynamic = 'force-dynamic'
import { SubmitSchema } from '@/lib/schemas'
import { generateReferenceNumber } from '@/lib/reference'
import { getDefaultTenantId, getTenantIdBySlug } from '@/lib/tenant'
import { getTenantBranding } from '@/lib/tenant-settings'
import { syncApprovedItemsToKanban } from '@/lib/kanban-sync'
import type { JobItem } from '@/lib/job-types'

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const parsed = SubmitSchema.safeParse(body)
  if (!parsed.success) {
    console.error('[submit] validation failed:', JSON.stringify(parsed.error.issues))
    return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 400 })
  }

  const data = parsed.data

  // Honeypot — silent reject
  if (data._hp) {
    return NextResponse.json({ success: true, referenceNumber: 'DDF-00000000-000000' })
  }

  // Idempotency: if this submissionId was already processed, return the saved ref
  const { data: existing } = await supabaseAdmin
    .from('jobs')
    .select('reference_number')
    .eq('submission_id', data.submissionId)
    .maybeSingle()

  if (existing) {
    return NextResponse.json({ success: true, referenceNumber: existing.reference_number })
  }

  const referenceNumber = generateReferenceNumber()
  const submittedAt = new Date().toISOString()

  // The server owns approval state. An item the client flagged as "I have the
  // final file" (proof_source: 'client' + at least one file) becomes a proof
  // that is approved for print right away — no shop re-upload, no approval
  // link. Anything else has every proof/approval field stripped so a crafted
  // payload can't pre-approve a shop-designed item.
  const items: JobItem[] = (data.items as JobItem[]).map(raw => {
    const { proof_urls, proof_url, proof_history, proof_previews, proof_source, proof_uploaded_at, approval_status,
      approved_at, approved_proof_url, designs_mode, messages, client_note, completed, completed_at, ...clean } = raw
    void proof_url; void proof_history; void proof_uploaded_at; void approval_status; void approved_at
    void approved_proof_url; void designs_mode; void messages; void client_note; void completed; void completed_at
    const finals = proof_source === 'client' ? (proof_urls ?? []).filter(p => /^uploads\/[A-Za-z0-9._-]+$/.test(p)) : []
    if (finals.length === 0) return clean
    // Preview images (PNG/JPG) for PDF/AI/EPS finals — only for files we're keeping.
    const previews: Record<string, string> = {}
    for (const [proof, pv] of Object.entries(proof_previews ?? {})) {
      if (finals.includes(proof) && /^uploads\/[A-Za-z0-9._-]+\.(png|jpe?g)$/i.test(pv)) previews[proof] = pv
    }
    return {
      ...clean,
      proof_urls: finals,
      ...(Object.keys(previews).length ? { proof_previews: previews } : {}),
      proof_source: 'client',
      proof_uploaded_at: submittedAt,
      designs_mode: 'all',
      approval_status: 'approved',
      approved_at: submittedAt,
      messages: [{ from: 'client', text: `Supplied ${finals.length === 1 ? 'the final print-ready file' : `${finals.length} final print-ready files`} with the brief — approved for print.`, at: submittedAt }],
    }
  })
  const clientFinalCount = items.filter(it => it.proof_source === 'client').length

  // Which workspace this intake belongs to: resolved from the /s/{slug} URL,
  // falling back to the default (DDF) workspace for the root form or a bad slug.
  const tenantId =
    (data.tenantSlug ? await getTenantIdBySlug(data.tenantSlug) : null)
    ?? await getDefaultTenantId()

  // INSERT with status=pending — DB is source of truth before emails send
  const { data: inserted, error: insertError } = await supabaseAdmin.from('jobs').insert({
    tenant_id: tenantId,
    reference_number: referenceNumber,
    client_name: data.clientName,
    company_name: data.companyName,
    contact_email: data.contactEmail,
    event_name: data.eventName ?? null,
    date_required: data.dateRequired,
    notes: data.notes ?? null,
    setup_location: data.setupLocation ?? null,
    setup_time: data.setupTime ?? null,
    removal_location: data.removalLocation ?? null,
    removal_time: data.removalTime ?? null,
    items,
    file_paths: data.filePaths,
    submission_id: data.submissionId,
    submitted_at: submittedAt,
    status: 'pending',
  }).select('id').single()

  if (insertError) {
    console.error('[submit] insert error:', insertError)
    return NextResponse.json({ error: 'Failed to save job. Please try again.' }, { status: 500 })
  }

  // Update status to received
  await supabaseAdmin
    .from('jobs')
    .update({ status: 'received' })
    .eq('reference_number', referenceNumber)

  // Client-supplied finals are already approved → put them on the Kanban now,
  // exactly as a portal approval would. Best-effort (self-healing retries inside).
  if (clientFinalCount > 0 && inserted?.id) {
    await syncApprovedItemsToKanban(inserted.id).catch(e => console.error('[submit] kanban sync failed:', e))
  }

  // Generate signed file URLs for the notification email (valid 30 days)
  const signedFileUrls: string[] = []
  for (const path of data.filePaths) {
    const { data: urlData } = await supabaseAdmin.storage
      .from('job-files')
      .createSignedUrl(path, 60 * 60 * 24 * 30)
    if (urlData?.signedUrl) signedFileUrls.push(urlData.signedUrl)
  }

  // Absolute portal link for the confirmation email, from the incoming request
  // (same convention as the review-link route) so it's correct in any env.
  const proto = req.headers.get('x-forwarded-proto') ?? 'https'
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? ''
  const portalUrl = host ? `${proto}://${host}/portal` : undefined

  const emailData = {
    referenceNumber,
    clientName: data.clientName,
    companyName: data.companyName,
    contactEmail: data.contactEmail,
    eventName: data.eventName,
    dateRequired: data.dateRequired,
    notes: data.notes,
    items: data.items,
    signedFileUrls,
    portalUrl,
    submittedAt: new Date(submittedAt).toLocaleString('en-ZA', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }),
  }

  // Emails + phone push are best-effort — a failure does not fail the submission
  const brand = await getTenantBranding(tenantId)
  await Promise.allSettled([
    sendNotificationEmail(emailData, brand).catch((e) => console.error('[email] notification failed:', e)),
    sendConfirmationEmail(emailData, brand).catch((e) => console.error('[email] confirmation failed:', e)),
    sendNtfy({
      title: 'New job submitted',
      message: `${data.companyName} — ${data.clientName}\n${data.items.length} item${data.items.length !== 1 ? 's' : ''}, due ${data.dateRequired}${clientFinalCount > 0 ? `\n📥 ${clientFinalCount} with client's own final file — approved, check before production` : ''}\nRef ${referenceNumber}`,
      tags: 'inbox_tray',
      priority: 4,
    }),
  ])

  return NextResponse.json({ success: true, referenceNumber })
}
