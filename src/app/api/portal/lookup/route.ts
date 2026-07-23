import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { normalizeEmail, emailsMatch } from '@/lib/normalize-email'
import { signPortalToken, PORTAL_COOKIE } from '@/lib/portal-token'

export const dynamic = 'force-dynamic'

const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
}

// No-login sign-in: a client proves they own a job with its reference number +
// the email on file. On a match we mint a job-scoped portal token into an
// httpOnly cookie. The reference's random suffix makes it unguessable, and the
// email must also match, so this is a sound credential for job briefs/proofs.
export async function POST(req: NextRequest) {
  let body: { reference?: string; email?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const reference = String(body.reference ?? '').trim()
  const email = normalizeEmail(body.email)
  if (!reference || !email) {
    return NextResponse.json({ error: 'Enter both your reference number and email.' }, { status: 400 })
  }

  // Case-insensitive on the reference too — clients retype these by hand.
  // Reference numbers are [A-Z0-9-] only, so no ilike wildcard hazard.
  const { data: rows } = await supabaseAdmin
    .from('jobs')
    .select('id, contact_email')
    .ilike('reference_number', reference)
    .limit(5)

  const match = (rows ?? []).find(r => emailsMatch(r.contact_email, email))
  if (!match) {
    // One generic message — never reveal which of the two was wrong.
    return NextResponse.json({ error: 'We couldn’t find a job with that reference number and email. Please check both and try again.' }, { status: 404 })
  }

  const res = NextResponse.json({ ok: true })
  res.cookies.set(PORTAL_COOKIE, signPortalToken(match.id), { ...COOKIE_OPTS, maxAge: 60 * 60 * 24 * 30 })
  return res
}

// "Look up a different job" / sign out — clear the token.
export async function DELETE() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set(PORTAL_COOKIE, '', { ...COOKIE_OPTS, maxAge: 0 })
  return res
}
