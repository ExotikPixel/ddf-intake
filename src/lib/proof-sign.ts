import { supabaseAdmin } from '@/lib/supabase-server'
import { isImagePath, proofPreviewPath, fileTileDataUrl } from '@/lib/job-types'
import type { JobItem } from '@/lib/job-types'

const TTL = 60 * 60

/**
 * Resolve what to SHOW for each proof path across a job's items.
 *
 *   urls[path]     → what goes in <img src>: the signed proof (images), the
 *                    signed preview PNG (PDF/AI/EPS with a preview), or an
 *                    inline labelled tile (no preview available).
 *   fileUrls[path] → signed URL of the actual file, only for non-image proofs,
 *                    so the UI can offer "Open file ↗".
 *
 * `paths` is the full allowlist the caller wants signed (proofs, history,
 * example photos …); previews are looked up in every item's proof_previews.
 */
export async function signProofDisplayUrls(items: JobItem[], paths: string[]) {
  const previewOf = new Map<string, string | null>()
  for (const it of items) {
    for (const p of Object.keys(it.proof_previews ?? {})) previewOf.set(p, proofPreviewPath(it, p))
  }

  const unique = Array.from(new Set(paths))
  // Every storage object we need a signed URL for: images as-is, previews for
  // non-images, plus the raw non-image file for the open link.
  const toSign = new Set<string>()
  for (const p of unique) {
    if (isImagePath(p)) { toSign.add(p); continue }
    const pv = previewOf.get(p) ?? null
    if (pv) toSign.add(pv)
    toSign.add(p)
  }
  const list = Array.from(toSign)
  const results = await Promise.all(list.map(p => supabaseAdmin.storage.from('job-files').createSignedUrl(p, TTL)))
  const signed: Record<string, string> = {}
  results.forEach((r, i) => { if (r.data?.signedUrl) signed[list[i]] = r.data.signedUrl })

  const urls: Record<string, string> = {}
  const fileUrls: Record<string, string> = {}
  for (const p of unique) {
    if (isImagePath(p)) {
      if (signed[p]) urls[p] = signed[p]
      continue
    }
    const pv = previewOf.get(p) ?? null
    urls[p] = (pv && signed[pv]) ? signed[pv] : fileTileDataUrl(p)
    if (signed[p]) fileUrls[p] = signed[p]
  }
  return { urls, fileUrls }
}
