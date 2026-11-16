import { SignJWT, jwtVerify } from 'jose'

// Admin login session: an HS256 JWT in an httpOnly cookie. Edge-safe (used by
// src/proxy.ts) — no server-only, no DB, no bcrypt in this file.

export const ADMIN_COOKIE = 'ddf_admin'
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30

export interface AdminSession { id: number; email: string; v: number }

function key(): Uint8Array {
  const s = process.env.AUTH_SECRET
  if (!s || s.length < 32) throw new Error('AUTH_SECRET must be set (32+ characters)')
  return new TextEncoder().encode(s)
}

export async function signSession(s: AdminSession, ttlSeconds = SESSION_TTL_SECONDS): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({ email: s.email, v: s.v })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(s.id))
    .setIssuedAt(now)
    .setExpirationTime(now + ttlSeconds)
    .sign(key())
}

export async function verifySession(token: string | undefined): Promise<AdminSession | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ['HS256'] })
    const id = Number(payload.sub)
    const v = payload.v
    // Cookies without a session version (pre-revocation) are invalid.
    if (!Number.isInteger(id) || typeof payload.email !== 'string' || typeof v !== 'number' || !Number.isInteger(v)) return null
    return { id, email: payload.email, v }
  } catch {
    return null
  }
}
