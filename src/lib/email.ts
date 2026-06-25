import 'server-only'
import { BrevoClient } from '@getbrevo/brevo'
import type { NotificationStatus } from '@/lib/job-types'

const brevo = new BrevoClient({ apiKey: process.env.BREVO_API_KEY! })

// Branding the email templates need. A subset of TenantBranding, so callers can
// pass a full branding object. Defaults to DDF when a caller doesn't supply one.
export interface EmailBrand {
  businessName: string
  brandColor: string
}

const DDF_BRAND: EmailBrand = {
  businessName: process.env.SENDER_NAME ?? 'DDF x Pixel',
  brandColor: '#b8955a',
}

export interface JobEmailData {
  referenceNumber: string
  clientName: string
  companyName: string
  contactEmail: string
  eventName?: string
  dateRequired: string
  notes?: string
  items: Array<{
    name: string
    quantity: number
    size: string
    material: string
  }>
  signedFileUrls: string[]
  submittedAt: string
}

export async function sendNotificationEmail(job: JobEmailData, brand: EmailBrand = DDF_BRAND) {
  const itemRows = job.items
    .map(
      (item, i) =>
        `<tr style="background:${i % 2 === 0 ? '#f9f9f9' : '#ffffff'}">
          <td style="padding:8px 12px;border:1px solid #e0e0e0">${item.name}</td>
          <td style="padding:8px 12px;border:1px solid #e0e0e0;text-align:center">${item.quantity}</td>
          <td style="padding:8px 12px;border:1px solid #e0e0e0">${item.size}</td>
          <td style="padding:8px 12px;border:1px solid #e0e0e0;text-transform:capitalize">${item.material}</td>
        </tr>`
    )
    .join('')

  const fileLinks = job.signedFileUrls.length
    ? job.signedFileUrls.map((url, i) => `<a href="${url}">File ${i + 1}</a>`).join(' &nbsp;|&nbsp; ')
    : 'No files uploaded'

  const html = `
<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;color:#1a1a1a;max-width:600px;margin:0 auto;padding:24px">
  <div style="background:#1a1a1a;color:#fff;padding:16px 20px;margin-bottom:24px">
    <span style="font-weight:800;font-size:18px;letter-spacing:2px">${brand.businessName}</span>
    <span style="float:right;background:${brand.brandColor};color:#fff;padding:4px 10px;font-size:12px;font-weight:700;border-radius:3px">${job.referenceNumber}</span>
  </div>

  <h2 style="margin:0 0 16px">New Job Brief</h2>

  <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
    <tr><td style="padding:6px 0;color:#666;width:140px">Client</td><td style="padding:6px 0;font-weight:600">${job.clientName}</td></tr>
    <tr><td style="padding:6px 0;color:#666">Company</td><td style="padding:6px 0;font-weight:600">${job.companyName}</td></tr>
    <tr><td style="padding:6px 0;color:#666">Email</td><td style="padding:6px 0"><a href="mailto:${job.contactEmail}">${job.contactEmail}</a></td></tr>
    <tr><td style="padding:6px 0;color:#666">Date Required</td><td style="padding:6px 0;font-weight:600;color:${brand.brandColor}">${job.dateRequired}</td></tr>
    ${job.eventName ? `<tr><td style="padding:6px 0;color:#666">Event/Project</td><td style="padding:6px 0">${job.eventName}</td></tr>` : ''}
    <tr><td style="padding:6px 0;color:#666">Submitted</td><td style="padding:6px 0">${job.submittedAt}</td></tr>
  </table>

  <h3 style="margin:0 0 12px;font-size:14px;text-transform:uppercase;letter-spacing:1px;color:#666">Job Items</h3>
  <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:20px">
    <thead>
      <tr style="background:#1a1a1a;color:#fff">
        <th style="padding:8px 12px;text-align:left">Item</th>
        <th style="padding:8px 12px;text-align:center">Qty</th>
        <th style="padding:8px 12px;text-align:left">Size</th>
        <th style="padding:8px 12px;text-align:left">Material</th>
      </tr>
    </thead>
    <tbody>${itemRows}</tbody>
  </table>

  ${job.notes ? `<div style="background:#f8f6f2;padding:12px 16px;margin-bottom:20px;border-left:3px solid ${brand.brandColor}"><strong>Notes:</strong> ${job.notes}</div>` : ''}

  <div style="margin-bottom:20px">
    <strong>Files:</strong> ${fileLinks}
    ${job.signedFileUrls.length ? '<br><small style="color:#666">Links valid for 30 days</small>' : ''}
  </div>

  <p style="color:#666;font-size:13px">Reply to this email to contact ${job.clientName} directly at ${job.contactEmail}</p>
</body>
</html>`

  await brevo.transactionalEmails.sendTransacEmail({
    to: [{ email: process.env.NOTIFICATION_EMAIL! }],
    replyTo: { email: job.contactEmail, name: job.clientName },
    sender: { email: process.env.SENDER_EMAIL!, name: brand.businessName },
    subject: `New Job Brief: ${job.companyName} — ${job.referenceNumber}`,
    htmlContent: html,
  })
}

export async function sendConfirmationEmail(job: JobEmailData, brand: EmailBrand = DDF_BRAND) {
  const itemList = job.items
    .map((item) => `  • ${item.name} — Qty: ${item.quantity}, Size: ${item.size}, Material: ${item.material}`)
    .join('\n')

  const html = `
<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;color:#1a1a1a;max-width:600px;margin:0 auto;padding:24px">
  <div style="background:#1a1a1a;color:#fff;padding:16px 20px;margin-bottom:24px">
    <span style="font-weight:800;font-size:18px;letter-spacing:2px">${brand.businessName}</span>
  </div>

  <h2 style="margin:0 0 8px">Job Brief Received</h2>
  <p style="margin:0 0 24px;color:#666">Your reference number is:</p>
  <div style="background:#fff2ef;border:2px solid ${brand.brandColor};padding:16px;text-align:center;font-size:24px;font-weight:800;letter-spacing:2px;color:${brand.brandColor};margin-bottom:24px">${job.referenceNumber}</div>

  <p>Hi ${job.clientName},</p>
  <p>We've received your job brief. Here's a summary of what you submitted:</p>

  <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
    <tr><td style="padding:6px 0;color:#666;width:140px">Company</td><td style="padding:6px 0">${job.companyName}</td></tr>
    <tr><td style="padding:6px 0;color:#666">Date Required</td><td style="padding:6px 0;font-weight:600">${job.dateRequired}</td></tr>
    ${job.eventName ? `<tr><td style="padding:6px 0;color:#666">Event/Project</td><td style="padding:6px 0">${job.eventName}</td></tr>` : ''}
    <tr><td style="padding:6px 0;color:#666">Submitted</td><td style="padding:6px 0">${job.submittedAt}</td></tr>
  </table>

  <h3 style="font-size:14px;text-transform:uppercase;letter-spacing:1px;color:#666;margin-bottom:8px">Items Ordered</h3>
  <div style="background:#f8f6f2;padding:12px 16px;font-family:monospace;font-size:13px;white-space:pre-wrap;margin-bottom:20px">${itemList}</div>

  ${job.notes ? `<p><strong>Notes:</strong> ${job.notes}</p>` : ''}

  <hr style="border:none;border-top:1px solid #e0deda;margin:24px 0">
  <p>${brand.businessName} will review your brief and be in touch shortly.</p>
  <p style="color:#666;font-size:13px"><strong>Please keep your reference number:</strong> ${job.referenceNumber}<br>Do not re-submit — your job has been saved.</p>
</body>
</html>`

  await brevo.transactionalEmails.sendTransacEmail({
    to: [{ email: job.contactEmail, name: job.clientName }],
    sender: { email: process.env.SENDER_EMAIL!, name: brand.businessName },
    subject: `Job Brief Received — ${job.referenceNumber}`,
    htmlContent: html,
  })
}

export async function sendChangeRequestNotification(
  job: { reference_number: string; client_name: string; contact_email: string },
  item: { name: string; note?: string },
  brand: EmailBrand = DDF_BRAND
): Promise<void> {
  const html = `
<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;color:#1a1a1a;max-width:600px;margin:0 auto;padding:24px">
  <div style="background:#1a1a1a;color:#fff;padding:16px 20px;margin-bottom:24px">
    <span style="font-weight:800;font-size:18px;letter-spacing:2px">${brand.businessName}</span>
    <span style="float:right;background:${brand.brandColor};color:#fff;padding:4px 10px;font-size:12px;font-weight:700;border-radius:3px">${job.reference_number}</span>
  </div>

  <h2 style="margin:0 0 16px">Changes Requested on a Proof</h2>
  <p><strong>${job.client_name}</strong> (${job.contact_email}) requested changes on:</p>
  <div style="background:#fff2ef;border-left:3px solid ${brand.brandColor};padding:12px 16px;margin-bottom:16px">
    <strong>${job.reference_number}</strong> — ${item.name}
  </div>
  ${item.note ? `<div style="background:#f8f6f2;padding:12px 16px;margin-bottom:20px"><strong>Client note:</strong><br>${item.note}</div>` : '<p style="color:#666">No note was provided.</p>'}
  <hr style="border:none;border-top:1px solid #e0deda;margin:24px 0">
  <p style="color:#666;font-size:13px">Reply to this email to contact ${job.client_name} directly.</p>
</body>
</html>`

  // Best-effort — a transient email failure must not block the approval write.
  try {
    await brevo.transactionalEmails.sendTransacEmail({
      to: [{ email: process.env.NOTIFICATION_EMAIL! }],
      replyTo: { email: job.contact_email, name: job.client_name },
      sender: { email: process.env.SENDER_EMAIL!, name: brand.businessName },
      subject: `Changes requested: ${job.reference_number} — ${item.name}`,
      htmlContent: html,
    })
  } catch (err) {
    console.error('[sendChangeRequestNotification] Brevo send failed:', err)
  }
}

export async function sendStatusNotification(
  job: { reference_number: string; client_name: string; contact_email: string },
  status: NotificationStatus,
  brand: EmailBrand = DDF_BRAND
): Promise<void> {
  const isInProgress = status === 'in_progress'

  const subject = isInProgress
    ? `Your job is in production — ${job.reference_number}`
    : `Your job is ready — ${job.reference_number}`

  const bodyText = isInProgress
    ? `Good news — your job is now in production. We'll be in touch when it's ready for pickup.`
    : `Great news — your job is ready! Come collect at your convenience during business hours.`

  const html = `
<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;color:#1a1a1a;max-width:600px;margin:0 auto;padding:24px">
  <div style="background:#1a1a1a;color:#fff;padding:16px 20px;margin-bottom:24px">
    <span style="font-weight:800;font-size:18px;letter-spacing:2px">${brand.businessName}</span>
    <span style="float:right;background:${brand.brandColor};color:#fff;padding:4px 10px;font-size:12px;font-weight:700;border-radius:3px">${job.reference_number}</span>
  </div>

  <p>Hi ${job.client_name},</p>
  <p>${bodyText}</p>
  <p><strong>Job Reference:</strong> ${job.reference_number}</p>
  <hr style="border:none;border-top:1px solid #e0deda;margin:24px 0">
  <p style="color:#666;font-size:13px">If you have any questions, feel free to contact us.</p>
  <p style="color:#666;font-size:13px">— The ${brand.businessName} team</p>
</body>
</html>`

  // Best-effort delivery — swallow errors so a transient email failure
  // never prevents the status update from being persisted.
  try {
    await brevo.transactionalEmails.sendTransacEmail({
      to: [{ email: job.contact_email, name: job.client_name }],
      sender: { email: process.env.SENDER_EMAIL!, name: brand.businessName },
      subject,
      htmlContent: html,
    })
  } catch (err) {
    console.error('[sendStatusNotification] Brevo send failed:', err)
  }
}

// Alerts the team when a client appends items/files to a job already in
// production (the append-only "Add to Job" flow). Mirrors the change-request
// notification: best-effort, replies route back to the client.
export async function sendAddedToJobNotification(
  job: { reference_number: string; client_name: string; contact_email: string },
  added: { items: Array<{ name: string; quantity: number; size: string }>; fileCount: number },
  brand: EmailBrand = DDF_BRAND
): Promise<void> {
  const itemRows = added.items.map(it =>
    `<tr><td style="padding:6px 12px;border-bottom:1px solid #eee;font-weight:600">${it.quantity}× ${it.name}</td><td style="padding:6px 12px;border-bottom:1px solid #eee;color:#555">${it.size || '—'}</td></tr>`
  ).join('')

  const html = `
<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;color:#1a1a1a;max-width:600px;margin:0 auto;padding:24px">
  <div style="background:#1a1a1a;color:#fff;padding:16px 20px;margin-bottom:24px">
    <span style="font-weight:800;font-size:18px;letter-spacing:2px">${brand.businessName}</span>
    <span style="float:right;background:${brand.brandColor};color:#fff;padding:4px 10px;font-size:12px;font-weight:700;border-radius:3px">${job.reference_number}</span>
  </div>

  <h2 style="margin:0 0 16px">Client Added to a Job In Progress</h2>
  <p><strong>${job.client_name}</strong> (${job.contact_email}) added to <strong>${job.reference_number}</strong>:</p>
  ${added.items.length > 0 ? `<table style="width:100%;border-collapse:collapse;margin-bottom:16px"><thead><tr><th style="text-align:left;padding:6px 12px;background:#f8f6f2;font-size:12px;color:#666">New Item</th><th style="text-align:left;padding:6px 12px;background:#f8f6f2;font-size:12px;color:#666">Size</th></tr></thead><tbody>${itemRows}</tbody></table>` : ''}
  ${added.fileCount > 0 ? `<div style="background:#fff2ef;border-left:3px solid ${brand.brandColor};padding:12px 16px;margin-bottom:16px">📎 ${added.fileCount} new document${added.fileCount !== 1 ? 's' : ''} attached — view in the admin job card.</div>` : ''}
  <p style="color:#666;font-size:13px">These additions are awaiting your quote and proof — existing items on the job are unchanged.</p>
  <hr style="border:none;border-top:1px solid #e0deda;margin:24px 0">
  <p style="color:#666;font-size:13px">Reply to this email to contact ${job.client_name} directly.</p>
</body>
</html>`

  try {
    await brevo.transactionalEmails.sendTransacEmail({
      to: [{ email: process.env.NOTIFICATION_EMAIL! }],
      replyTo: { email: job.contact_email, name: job.client_name },
      sender: { email: process.env.SENDER_EMAIL!, name: brand.businessName },
      subject: `Client added to ${job.reference_number}`,
      htmlContent: html,
    })
  } catch (err) {
    console.error('[sendAddedToJobNotification] Brevo send failed:', err)
  }
}
