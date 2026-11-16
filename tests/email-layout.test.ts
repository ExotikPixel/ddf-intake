import { describe, it, expect } from 'vitest'
import { renderEmail, esc, money } from '@/lib/email-layout'

describe('renderEmail', () => {
  it('renders heading, accent, paragraphs, CTA, reference and preheader', () => {
    const html = renderEmail({
      preheader: 'Two designs are waiting', heading: 'Two designs need your', accent: 'OK.',
      paragraphs: ['Your event is in <b>27 days</b>.'], cta: { label: 'Review now', url: 'https://jobs.ddfpixel.com/review/abc' },
      footnote: 'Reply to pause reminders.', reference: 'DDF-20261102-A41F7C',
    })
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true)
    expect(html).toContain('Two designs need your')
    expect(html).toContain('font-style:italic')
    expect(html).toContain('href="https://jobs.ddfpixel.com/review/abc"')
    expect(html).toContain('DDF-20261102-A41F7C')
    expect(html).toContain('Two designs are waiting')
    expect(html).toContain('<b>27 days</b>')
  })
  it('escapes plain-text fields', () => {
    const html = renderEmail({ preheader: '<x>', heading: '<script>alert(1)</script>', paragraphs: [] })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
    expect(esc(`"a" & 'b'`)).toBe('&quot;a&quot; &amp; &#39;b&#39;')
  })
  it('formats CAD money from cents', () => {
    expect(money(115000)).toBe('$1,150.00')
    expect(money(4999)).toBe('$49.99')
  })
})
