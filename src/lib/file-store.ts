import 'server-only'
import path from 'node:path'
import { promises as fsp, createReadStream, createWriteStream } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { MAX_FILE_BYTES } from '@/lib/limits'

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
  const root = path.resolve(/*turbopackIgnore: true*/ filesRoot())
  const full = path.resolve(/*turbopackIgnore: true*/ root, key)
  if (!full.startsWith(root + path.sep)) throw new Error(`unsafe file key: ${key}`)
  return full
}

// Hard cap on any single stored upload (same as the form/upload-url limit).
export const MAX_UPLOAD_BYTES = MAX_FILE_BYTES

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
  if (typeof maxBytes !== 'number' || !Number.isFinite(maxBytes) || maxBytes < 0) throw new TooLargeError()
  let total = 0
  const limiter = new Transform({
    transform(chunk, _enc, cb) {
      total += chunk.length
      if (total > maxBytes) cb(new TooLargeError())
      else cb(null, chunk)
    },
  })
  try {
    await pipeline(
      Readable.fromWeb(body as import('node:stream/web').ReadableStream<Uint8Array>),
      limiter,
      createWriteStream(tmp, { flags: 'wx' }),
    )
    await fsp.rename(tmp, dest)
    return total
  } catch (e) {
    await fsp.rm(tmp, { force: true })
    throw e
  }
}
