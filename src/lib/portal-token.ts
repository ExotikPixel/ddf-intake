import 'server-only'
import { createHmac, timingSafeEqual } from 'crypto'

// A no-login portal session. After a client proves ownership of a job by
// entering its reference number + the email on file, we hand them this signed,
// job-scoped token in an httpOnly cookie. It grants view/edit/add/approve on
// that ONE job — nothing else. Stateless (HMAC-SHA256), like the review link;
// rotate the secret to invalidate every outstanding token at once.
//
// Distinct `portal:` prefix so it can never be confused with a review token,
// even though both sign a job id with the same secret.
function secret(): string {
  const s = process.env.REVIEW_LINK_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!s) throw new Error('No signing secret available for portal tokens')
  return s
}

const b64url = (b: Buffer) => b.toString('base64url')

function sign(payload: string): string {
  return b64url(createHmac('sha256', secret()).update(payload).digest())
}

/** Create a portal token for a job id, e.g. "cG9y….aHsx…". */
export function signPortalToken(jobId: number): string {
  const id = b64url(Buffer.from(`portal:${jobId}`))
  return `${id}.${sign(`portal:${jobId}`)}`
}

/** Verify a portal token and return its job id, or null if invalid/tampered. */
export function verifyPortalToken(token: string | undefined | null): number | null {
  if (!token) return null
  const dot = token.lastIndexOf('.')
  if (dot < 1) return null
  const idPart = token.slice(0, dot)
  const sigPart = token.slice(dot + 1)

  let payload: string
  try {
    payload = Buffer.from(idPart, 'base64url').toString('utf8')
  } catch {
    return null
  }
  if (!payload.startsWith('portal:')) return null

  const expected = sign(payload)
  const a = Buffer.from(sigPart)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  const jobId = parseInt(payload.slice('portal:'.length), 10)
  return Number.isInteger(jobId) ? jobId : null
}

/** Name of the httpOnly cookie that carries the portal token. */
export const PORTAL_COOKIE = 'portal_token'
