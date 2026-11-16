import 'server-only'
import path from 'node:path'
import { promises as fsp, createReadStream, createWriteStream } from 'node:fs'
import { randomBytes } from 'node:crypto'

// Client files on local disk, under the exact keys Supabase Storage used
// (e.g. "uploads/1763241122000-k3j2h1.pdf"), so DB paths never need rewriting.

export function filesRoot(): string {
  return process.env.FILES_DIR || '/data/files'
}

const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/

export function isSafeKey(key: string): boolean {
  return key.length > 0 && key.length <= 300 && KEY_RE.test(key) && !key.includes('..') && !key.includes('//')
}

export function filePath(key: string): string {
  if (!isSafeKey(key)) throw new Error(`unsafe file key: ${key}`)
  const root = path.resolve(filesRoot())
  const full = path.resolve(root, key)
  if (!full.startsWith(root + path.sep)) throw new Error(`unsafe file key: ${key}`)
  return full
}

export class TooLargeError extends Error {
  constructor() { super('file too large') }
}

export async function exists(key: string): Promise<boolean> {
  try { return (await fsp.stat(filePath(key))).isFile() } catch { return false }
}

export async function stat(key: string) {
  return fsp.stat(filePath(key))
}

export function readStream(key: string) {
  return createReadStream(filePath(key))
}

/** Delete files; unsafe keys and missing files are ignored (mirrors storage.remove). */
export async function remove(keys: string[]): Promise<void> {
  await Promise.all(keys.filter(isSafeKey).map(k => fsp.rm(filePath(k), { force: true })))
}

/**
 * Stream a request body to `key`. Written to a temp file and renamed into place,
 * so a failed or oversize upload never leaves a partial file under the real key.
 */
export async function writeStream(key: string, body: ReadableStream<Uint8Array>, maxBytes: number): Promise<number> {
  const dest = filePath(key)
  await fsp.mkdir(path.dirname(dest), { recursive: true })
  const tmp = `${dest}.part-${randomBytes(6).toString('hex')}`
  const out = createWriteStream(tmp, { flags: 'wx' })
  const reader = body.getReader()
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) throw new TooLargeError()
      if (!out.write(value)) await new Promise<void>(resolve => out.once('drain', () => resolve()))
    }
    await new Promise<void>((resolve, reject) => { out.once('error', reject); out.end(() => resolve()) })
    await fsp.rename(tmp, dest)
    return total
  } catch (e) {
    out.destroy()
    await reader.cancel().catch(() => {})
    await fsp.rm(tmp, { force: true })
    throw e
  }
}
