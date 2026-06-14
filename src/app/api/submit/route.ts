import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { sendNotificationEmail, sendConfirmationEmail } from '@/lib/email'
import { sendNtfy } from '@/lib/ntfy'

export const dynamic = 'force-dynamic'
import { SubmitSchema } from '@/lib/schemas'
import { generateReferenceNumber } from '@/lib/reference'

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const parsed = SubmitSchema.safeParse(body)
  if (!parsed.success) {
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

  // INSERT with status=pending — DB is source of truth before emails send
  const { error: insertError } = await supabaseAdmin.from('jobs').insert({
    reference_number: referenceNumber,
    client_name: data.clientName,
    company_name: data.companyName,
    contact_email: data.contactEmail,
    event_name: data.eventName ?? null,
    date_required: data.dateRequired,
    notes: data.notes ?? null,
    items: data.items,
    file_paths: data.filePaths,
    submission_id: data.submissionId,
    submitted_at: submittedAt,
    status: 'pending',
  })

  if (insertError) {
    console.error('[submit] insert error:', insertError)
    return NextResponse.json({ error: 'Failed to save job. Please try again.' }, { status: 500 })
  }

  // Update status to received
  await supabaseAdmin
    .from('jobs')
    .update({ status: 'received' })
    .eq('reference_number', referenceNumber)

  // Generate signed file URLs for the notification email (valid 30 days)
  const signedFileUrls: string[] = []
  for (const path of data.filePaths) {
    const { data: urlData } = await supabaseAdmin.storage
      .from('job-files')
      .createSignedUrl(path, 60 * 60 * 24 * 30)
    if (urlData?.signedUrl) signedFileUrls.push(urlData.signedUrl)
  }

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
    submittedAt: new Date(submittedAt).toLocaleString('en-ZA', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }),
  }

  // Emails + phone push are best-effort — a failure does not fail the submission
  await Promise.allSettled([
    sendNotificationEmail(emailData).catch((e) => console.error('[email] notification failed:', e)),
    sendConfirmationEmail(emailData).catch((e) => console.error('[email] confirmation failed:', e)),
    sendNtfy({
      title: 'New job submitted',
      message: `${data.companyName} — ${data.clientName}\n${data.items.length} item${data.items.length !== 1 ? 's' : ''}, due ${data.dateRequired}\nRef ${referenceNumber}`,
      tags: 'inbox_tray',
      priority: 4,
    }),
  ])

  return NextResponse.json({ success: true, referenceNumber })
}
