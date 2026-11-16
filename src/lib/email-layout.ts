// One branded, table-based email layout. Inline styles only: email clients
// ignore <style>, and web fonts are not guaranteed, so fonts fall back to
// Helvetica/Georgia. Matches the "soft glass" look: stone background, white
// rounded card, black pill button.

const SANS = "Geist,'Helvetica Neue',Helvetica,Arial,sans-serif"
// The site sets the accent word in the licensed script font BP-JulietteEx2, but
// email clients can't load web fonts, so email uses Georgia italic in the same
// wine red (#772121) as the closest safe approximation.
const SERIF = "Georgia,'Times New Roman',serif"

export const esc = (s: unknown): string =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

/** "$1,150.00" from cents (CAD, shown with a plain $). */
export const money = (cents: number): string => {
  const neg = cents < 0 ? '-' : ''
  const abs = Math.abs(Math.round(cents))
  const dollars = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${neg}$${dollars}.${String(abs % 100).padStart(2, '0')}`
}

export interface EmailParts {
  preheader: string            // inbox preview line (plain text)
  heading: string              // plain text
  accent?: string              // plain text, set in serif italic after the heading
  paragraphs: string[]         // trusted HTML: build with esc()
  blocks?: string[]            // extra trusted <tr> rows, e.g. a schedule table
  cta?: { label: string; url: string }
  footnote?: string            // plain text
  reference?: string           // job reference shown top-right
  businessName?: string
}

export function renderEmail(p: EmailParts): string {
  const name = p.businessName ?? process.env.SENDER_NAME ?? 'DDF x Pixel'
  const row = (inner: string, pad = '12px 28px 0') =>
    `<tr><td style="padding:${pad};font:400 15px/1.6 ${SANS};color:#2c2a29">${inner}</td></tr>`
  const base = (process.env.PUBLIC_BASE_URL ?? '').replace(/\/+$/, '')
  const brand = base
    ? `<img src="${esc(base)}/logo-ddfpixel.png" alt="${esc(name)}" height="30" style="display:block;height:30px;width:auto;border:0">`
    : `<span style="font:500 15px ${SANS};color:#121212">${esc(name)}</span>`
  const headerRow = `<tr><td style="padding:22px 28px;border-bottom:1px solid #e6dfd8"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="vertical-align:middle">${brand}</td>${p.reference ? `<td align="right" style="vertical-align:middle;font:400 12px ${SANS};color:#756e68">${esc(p.reference)}</td>` : ''}</tr></table></td></tr>`
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(p.heading)}</title></head>
<body style="margin:0;padding:0;background:#ebe6e1">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;color:#ebe6e1">${esc(p.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ebe6e1;padding:28px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:24px;overflow:hidden">
${headerRow}
<tr><td style="padding:30px 28px 6px"><h1 style="margin:0;font:300 30px/1.12 ${SANS};letter-spacing:-0.6px;color:#121212">${esc(p.heading)}${p.accent ? ` <span style="font-family:${SERIF};color:#772121;font-style:italic;font-weight:400">${esc(p.accent)}</span>` : ''}</h1></td></tr>
${p.paragraphs.map(t => row(t)).join('\n')}
${(p.blocks ?? []).join('\n')}
${p.cta ? `<tr><td style="padding:24px 28px 0"><a href="${esc(p.cta.url)}" style="display:inline-block;background:#121212;color:#ffffff;text-decoration:none;font:500 14px ${SANS};padding:14px 24px;border-radius:999px">${esc(p.cta.label)}</a></td></tr>` : ''}
${p.footnote ? row(`<span style="font-size:13px;color:#756e68">${esc(p.footnote)}</span>`, '18px 28px 0') : ''}
<tr><td style="padding:28px 0 0"></td></tr>
<tr><td style="padding:18px 28px;background:#f3eff0;font:400 12px/1.5 ${SANS};color:#756e68">Pixel Production × Designer Dance Floors · Events, signage &amp; fabrication · GTA</td></tr>
</table>
</td></tr>
</table>
</body></html>`
}
