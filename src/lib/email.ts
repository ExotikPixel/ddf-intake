import 'server-only'
import { BrevoClient } from '@getbrevo/brevo'
import type { NotificationStatus } from '@/lib/job-types'
import { renderEmail, esc } from '@/lib/email-layout'

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
  items: Array<{ name: string; quantity: number; size: string; material: string }>
  signedFileUrls: string[]
  submittedAt: string
  portalUrl?: string   // absolute link to the client portal (/portal), if known
}

const FONT = "Helvetica,Arial,sans-serif"
const firstName = (full: string) => (full || '').trim().split(/\s+/)[0] || 'there'
const sender = (brand: EmailBrand) => ({ email: process.env.SENDER_EMAIL!, name: brand.businessName })

/** Label/value rows as one email block. Values are escaped here. */
function detailRows(rows: [string, string | null | undefined][]): string {
  const body = rows.filter(([, v]) => v).map(([k, v]) =>
    `<tr><td style="padding:5px 0;width:130px;font:400 13px ${FONT};color:#756e68;vertical-align:top">${esc(k)}</td><td style="padding:5px 0;font:500 14px ${FONT};color:#121212">${esc(v)}</td></tr>`).join('')
  return `<tr><td style="padding:18px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${body}</table></td></tr>`
}

function itemsBlock(items: JobEmailData['items']): string {
  const rows = items.map(it =>
    `<tr><td style="padding:10px 0;border-bottom:1px solid #e6dfd8;font:500 14px ${FONT};color:#121212">${esc(it.quantity)} × ${esc(it.name)}</td><td style="padding:10px 0;border-bottom:1px solid #e6dfd8;font:400 13px ${FONT};color:#756e68;text-align:right">${esc([it.size, it.material].filter(Boolean).join(' · '))}</td></tr>`).join('')
  return `<tr><td style="padding:18px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table></td></tr>`
}

function noteBlock(label: string, text: string): string {
  return `<tr><td style="padding:16px 28px 0"><div style="background:#f3eaf0;border-radius:16px;padding:14px 16px;font:400 14px/1.5 ${FONT};color:#2c2a29"><b style="font-weight:600">${esc(label)}</b><br>${esc(text)}</div></td></tr>`
}

function refBlock(ref: string): string {
  return `<tr><td style="padding:18px 28px 0"><div style="background:#1a1418;border-radius:20px;padding:18px 20px"><div style="font:500 11px ${FONT};color:#b9adb4">Your reference</div><div style="font:500 18px ${FONT};letter-spacing:2px;color:#e4c9da;margin-top:6px">${esc(ref)}</div></div></td></tr>`
}

// ── New brief (to the shop) ──────────────────────────────────────────
export async function sendNotificationEmail(job: JobEmailData, brand: EmailBrand = DDF_BRAND) {
  const files = job.signedFileUrls.length
    ? job.signedFileUrls.map((u, i) => `<a href="${esc(u)}" style="color:#7a4c69">File ${i + 1}</a>`).join(' · ') + ' <span style="color:#756e68">(links valid for 30 days)</span>'
    : 'No files uploaded'
  const html = renderEmail({
    businessName: brand.businessName,
    preheader: `${job.companyName} · ${job.items.length} piece${job.items.length === 1 ? '' : 's'} · needed ${job.dateRequired}`,
    heading: 'New', accent: 'brief.',
    paragraphs: [`<b>${esc(job.clientName)}</b> from <b>${esc(job.companyName)}</b> sent a brief.`],
    blocks: [
      detailRows([['Email', job.contactEmail], ['Date required', job.dateRequired], ['Event / project', job.eventName], ['Submitted', job.submittedAt]]),
      itemsBlock(job.items),
      ...(job.notes ? [noteBlock('Notes', job.notes)] : []),
      `<tr><td style="padding:16px 28px 0;font:400 14px ${FONT};color:#2c2a29"><b style="font-weight:600">Files:</b> ${files}</td></tr>`,
    ],
    footnote: `Reply to this email to reach ${job.clientName} at ${job.contactEmail}.`,
    reference: job.referenceNumber,
  })
  await brevo.transactionalEmails.sendTransacEmail({
    to: [{ email: process.env.NOTIFICATION_EMAIL! }],
    replyTo: { email: job.contactEmail, name: job.clientName },
    sender: sender(brand),
    subject: `New Job Brief: ${job.companyName} — ${job.referenceNumber}`,
    htmlContent: html,
  })
}

// ── Brief received (to the client) ────────────────────────────────────
export async function sendConfirmationEmail(job: JobEmailData, brand: EmailBrand = DDF_BRAND) {
  const html = renderEmail({
    businessName: brand.businessName,
    preheader: `We’ve got your brief. Reference ${job.referenceNumber}.`,
    heading: 'Brief', accent: 'received.',
    paragraphs: [
      `Hi ${esc(firstName(job.clientName))}, thanks — we’ve got your brief${job.eventName ? ` for <b>${esc(job.eventName)}</b>` : ''}. We’ll review it and come back with a quote or your first proofs.`,
    ],
    blocks: [
      refBlock(job.referenceNumber),
      itemsBlock(job.items),
      detailRows([['Company', job.companyName], ['Date required', job.dateRequired], ['Submitted', job.submittedAt]]),
      ...(job.notes ? [noteBlock('Your notes', job.notes)] : []),
    ],
    cta: job.portalUrl ? { label: 'View my job', url: job.portalUrl } : undefined,
    footnote: 'Track progress, approve designs and add pieces any time with your reference and this email. No need to send the brief again.',
    reference: job.referenceNumber,
  })
  await brevo.transactionalEmails.sendTransacEmail({
    to: [{ email: job.contactEmail, name: job.clientName }],
    sender: sender(brand),
    subject: `Job Brief Received — ${job.referenceNumber}`,
    htmlContent: html,
  })
}

// ── Change request (to the shop) ──────────────────────────────────────
export async function sendChangeRequestNotification(
  job: { reference_number: string; client_name: string; contact_email: string },
  item: { name: string; note?: string },
  brand: EmailBrand = DDF_BRAND,
): Promise<void> {
  const html = renderEmail({
    businessName: brand.businessName,
    preheader: `${job.client_name} asked for changes on ${item.name}`,
    heading: 'Changes', accent: 'requested.',
    paragraphs: [`<b>${esc(job.client_name)}</b> (${esc(job.contact_email)}) asked for changes on <b>${esc(item.name)}</b>.`],
    blocks: [item.note ? noteBlock('Client note', item.note) : `<tr><td style="padding:12px 28px 0;font:400 14px ${FONT};color:#756e68">No note was provided.</td></tr>`],
    footnote: `Reply to this email to reach ${job.client_name} directly.`,
    reference: job.reference_number,
  })
  // Best-effort — a transient email failure must not block the approval write.
  try {
    await brevo.transactionalEmails.sendTransacEmail({
      to: [{ email: process.env.NOTIFICATION_EMAIL! }],
      replyTo: { email: job.contact_email, name: job.client_name },
      sender: sender(brand),
      subject: `Changes requested: ${job.reference_number} — ${item.name}`,
      htmlContent: html,
    })
  } catch (err) {
    console.error('[sendChangeRequestNotification] Brevo send failed:', err)
  }
}

// ── Status (to the client) ────────────────────────────────────────────
export async function sendStatusNotification(
  job: { reference_number: string; client_name: string; contact_email: string },
  status: NotificationStatus,
  brand: EmailBrand = DDF_BRAND,
): Promise<void> {
  const inProduction = status === 'in_progress'
  const html = renderEmail({
    businessName: brand.businessName,
    preheader: inProduction ? 'Your job is in production.' : 'Your job is ready.',
    heading: inProduction ? 'Your job is in' : 'Your job is', accent: inProduction ? 'production.' : 'ready.',
    paragraphs: [
      `Hi ${esc(firstName(job.client_name))}, ${inProduction
        ? 'good news: your job is now in production. We’ll be in touch when it’s ready.'
        : 'great news: your job is ready. We’ll confirm the hand-over with you.'}`,
    ],
    footnote: 'Questions? Just reply to this email.',
    reference: job.reference_number,
  })
  // Best-effort delivery — never block the status update.
  try {
    await brevo.transactionalEmails.sendTransacEmail({
      to: [{ email: job.contact_email, name: job.client_name }],
      sender: sender(brand),
      subject: inProduction ? `Your job is in production — ${job.reference_number}` : `Your job is ready — ${job.reference_number}`,
      htmlContent: html,
    })
  } catch (err) {
    console.error('[sendStatusNotification] Brevo send failed:', err)
  }
}

// ── Client added to a job in progress (to the shop) ───────────────────
export async function sendAddedToJobNotification(
  job: { reference_number: string; client_name: string; contact_email: string },
  added: { items: Array<{ name: string; quantity: number; size: string }>; fileCount: number },
  brand: EmailBrand = DDF_BRAND,
): Promise<void> {
  const html = renderEmail({
    businessName: brand.businessName,
    preheader: `${job.client_name} added to ${job.reference_number}`,
    heading: 'Added to a job in', accent: 'progress.',
    paragraphs: [`<b>${esc(job.client_name)}</b> (${esc(job.contact_email)}) added to <b>${esc(job.reference_number)}</b>. Existing pieces are unchanged; the new ones need a quote and a proof.`],
    blocks: [
      ...(added.items.length ? [itemsBlock(added.items.map(it => ({ ...it, material: '' })))] : []),
      ...(added.fileCount > 0 ? [noteBlock('Files', `${added.fileCount} new document${added.fileCount === 1 ? '' : 's'} attached. View them in the admin job drawer.`)] : []),
    ],
    footnote: `Reply to this email to reach ${job.client_name} directly.`,
    reference: job.reference_number,
  })
  try {
    await brevo.transactionalEmails.sendTransacEmail({
      to: [{ email: process.env.NOTIFICATION_EMAIL! }],
      replyTo: { email: job.contact_email, name: job.client_name },
      sender: sender(brand),
      subject: `Client added to ${job.reference_number}`,
      htmlContent: html,
    })
  } catch (err) {
    console.error('[sendAddedToJobNotification] Brevo send failed:', err)
  }
}
