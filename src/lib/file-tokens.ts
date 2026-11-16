import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'

// Stateless HMAC tokens for uploads (PUT /upload/<token>) and downloads
// (GET /f/<token>). Rotate FILE_LINK_SECRET to invalidate every outstanding link.

type UploadClaims = { k: 'put'; key: string; type: string; size: number; exp: number }
type FileClaims = { k: 'get'; key: string; exp: number }

function secret(): string {
  const s = process.env.FILE_LINK_SECRET
  if (!s) throw new Error('FILE_LINK_SECRET is not set')
  return s
}

const mac = (payload: string) => createHmac('sha256', secret()).update(payload).digest('base64url')
const nowSeconds = () => Math.floor(Date.now() / 1000)

function sign(claims: UploadClaims | FileClaims): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  return `${payload}.${mac(payload)}`
}

function verify<T extends UploadClaims | FileClaims>(token: string, kind: T['k'], now = Date.now()): T | null {
  const dot = token.lastIndexOf('.')
  if (dot < 1) return null
  const payload = token.slice(0, dot)
  const expected = Buffer.from(mac(payload))
  const got = Buffer.from(token.slice(dot + 1))
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null
  let claims: T
  try { claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as T } catch { return null }
  if (claims.k !== kind || typeof claims.exp !== 'number' || claims.exp * 1000 < now) return null
  return claims
}

export function baseUrl(): string {
  return (process.env.PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '')
}

export function signUploadToken(key: string, type: string, size: number, ttlSeconds = 600): string {
  return sign({ k: 'put', key, type, size, exp: nowSeconds() + ttlSeconds })
}

/** Relative URL the browser PUTs the file to (same contract as Supabase's signedUrl). */
export function signUploadPath(key: string, type: string, size: number): string {
  return `/upload/${signUploadToken(key, type, size)}`
}

export function verifyUploadToken(token: string, now?: number): UploadClaims | null {
  return verify<UploadClaims>(token, 'put', now)
}

/** Absolute download link, safe to put in emails and Command Centre tickets. */
export function signFileLink(key: string, ttlSeconds: number): string {
  return `${baseUrl()}/f/${sign({ k: 'get', key, exp: nowSeconds() + ttlSeconds })}`
}

export function verifyFileToken(token: string, now?: number): FileClaims | null {
  return verify<FileClaims>(token, 'get', now)
}
