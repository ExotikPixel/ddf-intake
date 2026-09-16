/** One message in an item's review conversation. */
export interface ItemMessage {
  from: 'client' | 'shop'
  text: string
  at: string                                          // ISO timestamp
}

export interface JobItem {
  name: string
  quantity: number
  size: string
  material: string
  description?: string                                // richer client brief for this item (intake)
  ref_photos?: string[]                              // job-files paths to client reference/inspo images
  admin_note?: string                                 // shop-authored note shown to the client at review (how it'll be made, finish, etc.)
  example_photos?: string[]                          // job-files paths to shop example/inspiration images shown to the client
  // ── Client design-approval fields (optional; items is JSONB, no migration) ──
  proof_urls?: string[]                               // job-files paths to design proofs (one item can have several)
  proof_url?: string                                  // LEGACY single proof — read via itemProofs(); kept for old rows
  proof_history?: string[]                            // superseded proof versions (view-only history), oldest→newest
  approval_status?: 'pending' | 'approved' | 'changes_requested'
  approved_proof_url?: string                         // PICK mode: the ONE design chosen out of several
  designs_mode?: 'all' | 'pick' | 'latest'            // multiple designs: all-needed (default), pick-one, or latest-only
  proof_previews?: Record<string, string>             // proof path → job-files path of a PNG/JPG preview (for PDF/AI/EPS proofs that browsers can't render)
  proof_source?: 'shop' | 'client'                    // who supplied the current proof(s): shop-designed (default) or client's own print-ready file
  proof_uploaded_at?: string                          // ISO timestamp when the client uploaded their own final file
  messages?: ItemMessage[]                            // per-item conversation between client and shop
  client_note?: string                                // LEGACY latest change-request text — read the thread via itemThread()
  approved_at?: string                                // ISO timestamp when approved
  completed?: boolean                                 // admin marked this item done (printed/produced)
  completed_at?: string                               // ISO timestamp when marked completed
  added_at?: string                                   // ISO timestamp — set when a client appended this item AFTER submitting (Add to Job)
  // ── Admin-only quote (NEVER sent to clients — see publicItems()) ──
  quote_price?: number | null                         // price quoted to the client for this item (job currency), as remembered by the shop
  quote_note?: string                                 // internal note about the quote (options, assumptions, what was said)
  quoted_at?: string                                  // ISO timestamp when the quote was last edited
}

/**
 * How multiple designs on an item behave. 'all' (default) = every design is
 * needed and prints; 'pick' = they're alternatives and one is chosen by the
 * client; 'latest' = only the newest design is shown big / printed and the
 * earlier ones are kept as small reference thumbnails. Only meaningful when an
 * item has more than one proof.
 */
export function designsMode(item: JobItem): 'all' | 'pick' | 'latest' {
  if (item.designs_mode === 'pick') return 'pick'
  if (item.designs_mode === 'latest') return 'latest'
  return 'all'
}

/**
 * The review conversation for an item, newest-last. Falls back to synthesising
 * a single client message from the legacy client_note for rows saved before
 * threaded messages existed.
 */
export function itemThread(item: JobItem): ItemMessage[] {
  if (item.messages && item.messages.length) return item.messages
  if (item.client_note) return [{ from: 'client', text: item.client_note, at: '' }]
  return []
}

/** Client reference/inspo photos attached to an item at intake (empty if none). */
export function itemRefPhotos(item: JobItem): string[] {
  return item.ref_photos ?? []
}

/** Shop-uploaded example/inspiration photos shown to the client at review (empty if none). */
export function itemExamplePhotos(item: JobItem): string[] {
  return item.example_photos ?? []
}

/** All proof paths for an item, preferring the multi-proof array, falling back to the legacy single field. */
export function itemProofs(item: JobItem): string[] {
  if (item.proof_urls && item.proof_urls.length) return item.proof_urls
  if (item.proof_url) return [item.proof_url]
  return []
}

/**
 * The proof(s) that should actually go to print for an item. When the client
 * picked one design out of several (approved_proof_url), that's the only one.
 * Falls back to all proofs for single-proof items and older approved rows.
 */
export function approvedProofs(item: JobItem): string[] {
  const all = itemProofs(item)
  // Latest-only: just the newest design (kept on top by addProofs) goes to print.
  if (designsMode(item) === 'latest' && all.length > 1) return [all[0]]
  if (item.approved_proof_url && all.includes(item.approved_proof_url)) return [item.approved_proof_url]
  return all
}

/**
 * Merge a brief-edit's incoming items onto the current DB items so a full-array
 * brief save can NEVER clobber a concurrent client/admin approval. The server
 * owns approval state: approval fields are always taken from the DB, never from
 * the (possibly stale) edit-form payload. The ONE exception is an item whose
 * proof set actually changed — a new/replaced design must be re-approved, so it
 * resets to pending. Approval / completion / status changes flow through the
 * atomic update_job_item RPC instead, never through here.
 *
 * Items are matched by index (consistent with the rest of the system); a brand
 * new item past the end of the DB array keeps its incoming state.
 */
export function mergeItemsPreservingApproval(incoming: JobItem[], current: JobItem[]): JobItem[] {
  const sameProofs = (a: JobItem, b: JobItem) =>
    JSON.stringify(itemProofs(a)) === JSON.stringify(itemProofs(b))
  return incoming.map((inc, i) => {
    const cur = current[i]
    if (!cur) return inc // new item — nothing to preserve
    // Carry approval-owned fields from the DB, ignoring whatever the form sent.
    const merged: JobItem = {
      ...inc,
      approval_status: cur.approval_status,
      approved_at: cur.approved_at,
      approved_proof_url: cur.approved_proof_url,
      client_note: cur.client_note,
      // Admin quote lives on the item but is edited inline via the RPC, so a
      // brief save (admin or client) must never overwrite or wipe it.
      quote_price: cur.quote_price,
      quote_note: cur.quote_note,
      quoted_at: cur.quoted_at,
      messages: cur.messages,
      completed: cur.completed,
      completed_at: cur.completed_at,
    }
    if (cur.proof_source === 'client' && inc.proof_source !== 'shop') {
      // The client uploaded their own print-ready file (and approved it) after
      // this form was loaded. A brief save must not silently replace it with
      // the stale proofs the form still holds — only an explicit shop upload
      // (which stamps proof_source: 'shop') may supersede a client file.
      return {
        ...merged,
        proof_urls: cur.proof_urls,
        proof_url: cur.proof_url,
        proof_history: cur.proof_history,
        proof_previews: cur.proof_previews,
        proof_source: cur.proof_source,
        proof_uploaded_at: cur.proof_uploaded_at,
        designs_mode: cur.designs_mode,
      }
    }
    if (!sameProofs(inc, cur)) {
      // Design changed → the client must re-approve the new proof(s).
      merged.approval_status = 'pending'
      merged.approved_at = undefined
      merged.approved_proof_url = undefined
    }
    return merged
  })
}

export const APPROVAL_STATUSES = ['pending', 'approved', 'changes_requested'] as const
export type ApprovalStatus = typeof APPROVAL_STATUSES[number]

/** Pill styling for per-item approval state (mirrors STATUS_CONFIG shape) */
export const APPROVAL_CONFIG: Record<ApprovalStatus, { label: string; color: string; bg: string }> = {
  pending:            { label: 'Awaiting Review', color: '#888888', bg: '#f0f0f0' },
  approved:           { label: 'Approved',        color: '#1B7F4F', bg: '#eef7f3' },
  changes_requested:  { label: 'Changes Requested', color: '#C62828', bg: '#fff0f0' },
}

export const STATUSES = ['pending', 'received', 'in_progress', 'completed', 'cancelled'] as const
export type Status = typeof STATUSES[number]

export const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  received: 'Received',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

// Superset of admin STATUS_COLORS — includes bg shades used by the portal pill
export const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  pending:     { label: 'Pending',     color: '#888888', bg: '#f0f0f0' },
  received:    { label: 'Received',    color: '#1B7F4F', bg: '#eef7f3' },
  in_progress: { label: 'In Progress', color: '#b06a00', bg: '#fff7ed' },
  completed:   { label: 'Completed',   color: '#131313', bg: '#f0f0f0' },
  cancelled:   { label: 'Cancelled',   color: '#C62828', bg: '#fff0f0' },
}

/** DB status values that trigger a client notification email */
export const NOTIFICATION_STATUSES = ['in_progress', 'completed'] as const
export type NotificationStatus = typeof NOTIFICATION_STATUSES[number]

// ── Non-image proofs (PDF / AI / EPS) ─────────────────────────────────────────
// Browsers render JPG/PNG/SVG/WebP/GIF natively. Anything else needs a preview
// image (rendered from PDF/AI at upload, or supplied by the client for EPS).
// Where neither exists, a labelled tile stands in so nothing shows as broken.

const IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp|svg|avif|heic)$/i

export function isImagePath(path: string): boolean {
  return IMAGE_EXT_RE.test(path.split('?')[0])
}

/** Short uppercase label for a file's type: PDF, AI, EPS, … */
export function fileKindLabel(path: string): string {
  const ext = path.split('?')[0].split('.').pop()?.toUpperCase() ?? 'FILE'
  return ext.length > 4 ? 'FILE' : ext
}

/**
 * What to actually SHOW for a proof: the proof itself when it's an image, its
 * preview image when one exists, otherwise null (caller renders a tile).
 */
export function proofPreviewPath(item: Pick<JobItem, 'proof_previews'>, proofPath: string): string | null {
  if (isImagePath(proofPath)) return proofPath
  const preview = item.proof_previews?.[proofPath]
  return preview && isImagePath(preview) ? preview : null
}

/** Inline SVG tile (data URL) used as the <img> source for a proof with no preview. */
export function fileTileDataUrl(path: string): string {
  const label = fileKindLabel(path)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
  <rect width="400" height="300" fill="#F3F1EA"/>
  <rect x="140" y="60" width="120" height="150" rx="6" fill="#fff" stroke="#C9C4B6" stroke-width="3"/>
  <path d="M225 60 v40 h35" fill="none" stroke="#C9C4B6" stroke-width="3"/>
  <text x="200" y="150" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="34" font-weight="700" fill="#6E6A5E">${label}</text>
  <text x="200" y="250" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="15" fill="#6E6A5E">No preview — open the file to view</text>
</svg>`
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
}

// ── Client-facing view of items ───────────────────────────────────────────────
// Some item fields are for the shop only (quotes, internal notes). Every API
// response that reaches a client — portal, review link — must pass items
// through this so those fields never leave the server.
export const ADMIN_PRIVATE_ITEM_KEYS = ['quote_price', 'quote_note', 'quoted_at'] as const

export function publicItems<T extends JobItem>(items: T[]): T[] {
  return items.map(it => {
    const copy = { ...it }
    for (const k of ADMIN_PRIVATE_ITEM_KEYS) delete (copy as Record<string, unknown>)[k]
    return copy
  })
}

/** Sum of quoted prices across items (ignores items without a quote). */
export function jobQuoteTotal(items: JobItem[]): { total: number; quoted: number } {
  let total = 0, quoted = 0
  for (const it of items) {
    if (typeof it.quote_price === 'number' && !Number.isNaN(it.quote_price)) { total += it.quote_price; quoted++ }
  }
  return { total, quoted }
}
