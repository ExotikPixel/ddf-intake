import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { isSafeKey, filePath, writeStream, exists, remove, TooLargeError } from '@/lib/file-store'

const dir = mkdtempSync(path.join(tmpdir(), 'ddf-files-'))
const streamOf = (buf: Buffer) => new Blob([new Uint8Array(buf)]).stream()

describe('file-store', () => {
  beforeAll(() => { process.env.FILES_DIR = dir })

  it('accepts real upload keys and rejects traversal / odd keys', () => {
    expect(isSafeKey('uploads/1763241122000-k3j2h1.pdf')).toBe(true)
    for (const bad of ['../etc/passwd', '/abs.pdf', 'uploads/../x', 'uploads//x', '', 'a b.pdf', 'x'.repeat(301)]) {
      expect(isSafeKey(bad)).toBe(false)
    }
    expect(() => filePath('../x')).toThrow(/unsafe/)
  })

  it('writes atomically and reports existence', async () => {
    const n = await writeStream('uploads/a.pdf', streamOf(Buffer.from('hello')), 100)
    expect(n).toBe(5)
    expect(readFileSync(path.join(dir, 'uploads/a.pdf'), 'utf8')).toBe('hello')
    expect(await exists('uploads/a.pdf')).toBe(true)
    expect(await exists('uploads/nope.pdf')).toBe(false)
  })

  it('rejects oversize bodies and leaves no partial file', async () => {
    await expect(writeStream('uploads/big.pdf', streamOf(Buffer.alloc(200)), 100)).rejects.toBeInstanceOf(TooLargeError)
    expect(existsSync(path.join(dir, 'uploads/big.pdf'))).toBe(false)
    expect(readdirSync(path.join(dir, 'uploads')).some(f => f.includes('.part-'))).toBe(false)
  })

  it('remove deletes safe keys and ignores unsafe or missing ones', async () => {
    await remove(['uploads/a.pdf', '../x', 'uploads/missing.pdf'])
    expect(await exists('uploads/a.pdf')).toBe(false)
  })
})
