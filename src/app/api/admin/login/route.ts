import { NextRequest, NextResponse } from 'next/server'
import { normalizeEmail } from '@/lib/normalize-email'
import { findAdminByEmail, checkPassword, dummyHash, touchAdminLogin } from '@/lib/admin-users'
import { signSession, ADMIN_COOKIE, SESSION_TTL_SECONDS } from '@/lib/session'

export const dynamic = 'force-dynamic'

const FAILED = { error: 'Wrong email or password.' }

export async function POST(req: NextRequest) {
  if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    return NextResponse.json({ error: 'Content-Type must be application/json' }, { status: 415 })
  }
  let body: { email?: unknown; password?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  const email = normalizeEmail(typeof body.email === 'string' ? body.email : '')
  const password = typeof body.password === 'string' ? body.password : ''
  if (!email || !password) return NextResponse.json({ error: 'Enter your email and password.' }, { status: 400 })
  if (password.length > 1024) return NextResponse.json(FAILED, { status: 401 })  // before bcrypt

  let admin
  try { admin = await findAdminByEmail(email) } catch (e) {
    console.error('[admin/login] lookup failed:', e)
    return NextResponse.json({ error: 'Sign-in is unavailable right now.' }, { status: 503 })
  }
  // Always run bcrypt so unknown emails take as long as wrong passwords.
  const ok = await checkPassword(password, admin?.password_hash ?? (await dummyHash()))
  if (!admin || !ok) return NextResponse.json(FAILED, { status: 401 })

  await touchAdminLogin(admin.id).catch(e => console.error('[admin/login] touch failed:', e))
  const res = NextResponse.json({ ok: true })
  res.cookies.set(ADMIN_COOKIE, await signSession({ id: admin.id, email: admin.email, v: admin.session_version }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  })
  return res
}
