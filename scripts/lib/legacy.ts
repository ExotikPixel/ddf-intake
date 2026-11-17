// Shared helpers for the Phase 2 legacy-Supabase export / verify scripts.
// Deliberately free of src/lib imports: those pull in 'server-only', which
// throws outside Next. tests/legacy-scripts.test.ts keeps the copies below
// (key check, review token) in step with the app's own versions.
import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createHmac } from 'node:crypto'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'

export const BUCKET = 'job-files'

export type BucketObject = { key: string; size: number }
type Entry = { name: string; id: string | null; metadata: { size?: number } | null }
type Fetch = typeof fetch

function hint(status: number): string {
  return status === 402 || status === 403 || status === 503
    ? ' (the Supabase project still looks restricted — see Task 1)'
    : ''
}

/** Every object in the bucket, walking folders (entries with id === null). */
export async function listBucket(base: string, key: string, fetchImpl: Fetch = fetch): Promise<BucketObject[]> {
  const headers = { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': 'application/json' }
  const root = base.replace(/\/+$/, '')

  async function list(prefix: string): Promise<Entry[]> {
    const all: Entry[] = []
    for (let offset = 0; ; offset += 1000) {
      const res = await fetchImpl(`${root}/storage/v1/object/list/${BUCKET}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }),
      })
      if (!res.ok) throw new Error(`list "${prefix}": HTTP ${res.status}${hint(res.status)} ${await res.text()}`)
      const page = (await res.json()) as Entry[]
      all.push(...page)
      if (page.length < 1000) return all
    }
  }

  const out: BucketObject[] = []
  async function walk(prefix: string): Promise<void> {
    for (const e of await list(prefix)) {
      const k = prefix ? `${prefix}/${e.name}` : e.name
      if (e.id === null) await walk(k)
      else out.push({ key: k, size: e.metadata?.size ?? -1 })
    }
  }
  await walk('')
  return out
}

/** Where a bucket key lands under outDir. Refuses keys that would escape it. */
export function destFor(outDir: string, key: string): string {
  const root = path.resolve(outDir)
  const full = path.resolve(root, key)
  if (!key || path.isAbsolute(key) || !full.startsWith(root + path.sep)) throw new Error(`unsafe key: ${key}`)
  return full
}

/**
 * Download one object. Skips it when a file of the same size is already there,
 * and writes to a temp file first so an interrupted run never leaves a
 * half-written file under the real name.
 */
export async function downloadObject(
  base: string, key: string, outDir: string, obj: BucketObject, fetchImpl: Fetch = fetch,
): Promise<'skip' | 'ok'> {
  const dest = destFor(outDir, obj.key)
  try { if ((await stat(dest)).size === obj.size) return 'skip' } catch { /* not there yet */ }
  const url = `${base.replace(/\/+$/, '')}/storage/v1/object/${BUCKET}/${obj.key.split('/').map(encodeURIComponent).join('/')}`
  const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${key}`, apikey: key } })
  if (!res.ok || !res.body) throw new Error(`download ${obj.key}: HTTP ${res.status}${hint(res.status)}`)
  await mkdir(path.dirname(dest), { recursive: true })
  const tmp = `${dest}.part`
  try {
    await pipeline(Readable.fromWeb(res.body as WebReadableStream<Uint8Array>), createWriteStream(tmp))
    const got = (await stat(tmp)).size
    if (obj.size >= 0 && got !== obj.size) throw new Error(`download ${obj.key}: got ${got} bytes, expected ${obj.size}`)
    await rename(tmp, dest)
  } catch (e) {
    await rm(tmp, { force: true })
    throw e
  }
  return 'ok'
}

/** Download everything with a few parallel workers. Never throws for one bad file. */
export async function downloadAll(
  base: string, key: string, outDir: string, objects: BucketObject[],
  opts: { workers?: number; fetchImpl?: Fetch; log?: (m: string) => void } = {},
): Promise<{ downloaded: number; skipped: number; failed: string[] }> {
  const log = opts.log ?? console.log
  const queue = [...objects]
  let downloaded = 0, skipped = 0, seen = 0
  const failed: string[] = []
  await Promise.all(Array.from({ length: opts.workers ?? 4 }, async () => {
    for (let o = queue.shift(); o; o = queue.shift()) {
      try { (await downloadObject(base, key, outDir, o, opts.fetchImpl)) === 'skip' ? skipped++ : downloaded++ }
      catch (e) { failed.push(o.key); log(`❌ ${(e as Error).message}`) }
      if (++seen % 50 === 0) log(`… ${seen}/${objects.length}`)
    }
  }))
  return { downloaded, skipped, failed }
}

// ── verification helpers ─────────────────────────────────────────────

/** Same rule as isSafeKey() in src/lib/file-store.ts: keys the app can serve. */
const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/
export function servableKey(key: string): boolean {
  return key.length > 0 && key.length <= 300 && KEY_RE.test(key) && !key.includes('..') && !key.includes('//')
}

/** Every `uploads/...` file key referenced anywhere in a job's file_paths / items JSON. */
export function collectKeys(v: unknown, out: Set<string> = new Set()): Set<string> {
  if (typeof v === 'string') { if (v.startsWith('uploads/')) out.add(v); return out }
  if (Array.isArray(v)) { for (const x of v) collectKeys(x, out); return out }
  if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) { if (k.startsWith('uploads/')) out.add(k); collectKeys(x, out) }
  }
  return out
}

/** Same token as signReviewToken() in src/lib/review-token.ts. */
export function reviewToken(jobId: number, secret: string): string {
  const p = `review:${jobId}`
  return `${Buffer.from(p).toString('base64url')}.${createHmac('sha256', secret).update(p).digest('base64url')}`
}
