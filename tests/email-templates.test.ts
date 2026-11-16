import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'

const sends: { to: { email: string }[]; subject: string; htmlContent: string }[] = []
vi.mock('@getbrevo/brevo', () => ({
  BrevoClient: class { transactionalEmails = { sendTransacEmail: vi.fn(async (m: never) => { sends.push(m) }) } },
}))

describe('email templates', () => {
  let email: typeof import('@/lib/email')
  beforeAll(async () => {
    process.env.BREVO_API_KEY = 'k'
    process.env.SENDER_EMAIL = 'jobs@ddfpixel.com'
    process.env.NOTIFICATION_EMAIL = 'owner@example.com'
    email = await import('@/lib/email')
  })
  beforeEach(() => { sends.length = 0 })

  const job = {
    referenceNumber: 'DDF-20261115-ABC123', clientName: 'Aanya <b>Mehta</b>', companyName: 'Co', contactEmail: 'a@b.co',
    eventName: 'Wedding', dateRequired: '2026-12-12', notes: 'Gold & ivory',
    items: [{ name: 'Floor wrap', quantity: 1, size: '16x16', material: 'vinyl' }],
    signedFileUrls: ['https://jobs.ddfpixel.com/f/abc'], submittedAt: 'Nov 15', portalUrl: 'https://jobs.ddfpixel.com/portal',
  }

  it('confirmation: branded, escaped, portal button, same subject', async () => {
    await email.sendConfirmationEmail(job)
    const m = sends[0]
    expect(m.subject).toBe('Job Brief Received — DDF-20261115-ABC123')
    expect(m.to[0].email).toBe('a@b.co')
    expect(m.htmlContent).toContain('border-radius:24px')
    expect(m.htmlContent).toContain('href="https://jobs.ddfpixel.com/portal"')
    expect(m.htmlContent).toContain('Aanya')
    expect(m.htmlContent).not.toContain('<b>Mehta</b>')
    expect(m.htmlContent).toContain('Gold &amp; ivory')
  })

  it('new-brief notification goes to the owner with files and pieces', async () => {
    await email.sendNotificationEmail(job)
    const m = sends[0]
    expect(m.to[0].email).toBe('owner@example.com')
    expect(m.subject).toBe('New Job Brief: Co — DDF-20261115-ABC123')
    expect(m.htmlContent).toContain('Floor wrap')
    expect(m.htmlContent).toContain('href="https://jobs.ddfpixel.com/f/abc"')
  })

  it('status, change request and added-to-job render', async () => {
    const j = { reference_number: 'DDF-1', client_name: 'Aanya Mehta', contact_email: 'a@b.co' }
    await email.sendStatusNotification(j, 'in_progress')
    await email.sendChangeRequestNotification(j, { name: 'Bar sign', note: 'Bigger <date>' })
    await email.sendAddedToJobNotification(j, { items: [{ name: 'Menu', quantity: 2, size: 'A4' }], fileCount: 1 })
    expect(sends.map(s => s.subject)).toEqual([
      'Your job is in production — DDF-1',
      'Changes requested: DDF-1 — Bar sign',
      'Client added to DDF-1',
    ])
    expect(sends[1].htmlContent).toContain('Bigger &lt;date&gt;')
    expect(sends.every(s => s.htmlContent.startsWith('<!DOCTYPE html>'))).toBe(true)
  })
})
