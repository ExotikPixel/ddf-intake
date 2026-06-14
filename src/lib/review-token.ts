import 'server-only'
import { createHmac, timingSafeEqual } from 'crypto'

// Stateless, unguessable public approval links. A token embeds the job id and
// is signed with a server-only secret (HMAC-SHA256) — no DB column needed.
// "Unsharing" a link means rotating REVIEW_LINK_SECRET (invalidates all links).
//
// Falls back to the service-role key so the feature works in any environment
// that already has Supabase configured; set REVIEW_LINK_SECRET for a dedicated,
// independently-rotatable secret.
function secret(): string {
  const s = process.env.REVIEW_LINK_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!s) throw new Error('No signing secret available for review links')
  return s
}

const b64url = (b: Buffer) => b.toString('base64url')

function sign(payload: string): string {
  return b64url(createHmac('sha256', secret()).update(payload).digest())
}

/** Create a token for a job id, e.g. "12.aHsx…". */
export function signReviewToken(jobId: number): string {
  const id = b64url(Buffer.from(`review:${jobId}`))
  return `${id}.${sign(`review:${jobId}`)}`
}

/** Verify a token and return the job id, or null if invalid/tampered. */
export function verifyReviewToken(token: string): number | null {
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
  if (!payload.startsWith('review:')) return null

  const expected = sign(payload)
  const a = Buffer.from(sigPart)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  const jobId = parseInt(payload.slice('review:'.length), 10)
  return Number.isInteger(jobId) ? jobId : null
}
