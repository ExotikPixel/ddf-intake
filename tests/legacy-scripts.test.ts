import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { listBucket, destFor, downloadAll, collectKeys, reviewToken, servableKey } from '../scripts/lib/legacy'
import { isSafeKey } from '@/lib/file-store'
import { signReviewToken } from '@/lib/review-token'

const BASE = 'https://proj.supabase.co'

// A fake Supabase Storage API over an in-memory bucket.
function fakeStorage(files: Record<string, string>, opts: { failKey?: string; status?: number } = {}) {
  const calls: string[] = []
  const impl = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url)
    calls.push(u)
    if (opts.status) return new Response('restricted', { status: opts.status })
    if (u.startsWith(`${BASE}/storage/v1/object/list/job-files`)) {
      const { prefix, limit, offset } = JSON.parse(String(init?.body))
      const pre = prefix ? `${prefix}/` : ''
      const names = new Map<string, { id: string | null; size?: number }>()
      for (const [k, v] of Object.entries(files)) {
        if (!k.startsWith(pre)) continue
        const rest = k.slice(pre.length)
        const slash = rest.indexOf('/')
        if (slash === -1) names.set(rest, { id: 'x', size: Buffer.byteLength(v) })
        else names.set(rest.slice(0, slash), { id: null })
      }
      const page = [...names].sort().slice(offset, offset + limit)
        .map(([name, e]) => ({ name, id: e.id, metadata: e.id ? { size: e.size } : null }))
      return Response.json(page)
    }
    const key = decodeURIComponent(u.slice(`${BASE}/storage/v1/object/job-files/`.length))
    if (key === opts.failKey) return new Response('nope', { status: 500 })
    return new Response(files[key])
  }) as typeof fetch
  return { impl, calls }
}

describe('legacy export', () => {
  it('lists nested folders and pages past 1000 entries', async () => {
    const files: Record<string, string> = { 'top.txt': 'a', 'uploads/sub/deep.pdf': 'bbb' }
    for (let i = 0; i < 1001; i++) files[`uploads/f${String(i).padStart(4, '0')}.png`] = 'x'
    const { impl } = fakeStorage(files)
    const objs = await listBucket(BASE, 'k', impl)
    expect(objs).toHaveLength(1003)
    expect(objs).toContainEqual({ key: 'uploads/sub/deep.pdf', size: 3 })
    expect(objs).toContainEqual({ key: 'top.txt', size: 1 })
  })

  it('explains a restricted project', async () => {
    await expect(listBucket(BASE, 'k', fakeStorage({}, { status: 402 }).impl)).rejects.toThrow(/restricted/)
  })

  it('refuses keys that would escape the output folder', () => {
    expect(destFor('/out', 'uploads/a.png')).toBe(path.resolve('/out/uploads/a.png'))
    for (const bad of ['../x', 'uploads/../../x', '/etc/passwd', '']) expect(() => destFor('/out', bad)).toThrow()
  })

  it('downloads, skips files already there, and reports failures without stopping', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'legacy-export-'))
    const files = { 'uploads/a.png': 'aaaa', 'uploads/b c.pdf': 'bb', 'uploads/bad.png': 'zz' }
    mkdirSync(path.join(dir, 'uploads'))
    writeFileSync(path.join(dir, 'uploads/a.png'), 'AAAA')            // same size → skipped
    const { impl, calls } = fakeStorage(files, { failKey: 'uploads/bad.png' })
    const objs = await listBucket(BASE, 'k', impl)
    const r = await downloadAll(BASE, 'k', dir, objs, { fetchImpl: impl, log: () => {} })
    expect(r).toEqual({ downloaded: 1, skipped: 1, failed: ['uploads/bad.png'] })
    expect(readFileSync(path.join(dir, 'uploads/b c.pdf'), 'utf8')).toBe('bb')
    expect(calls).toContain(`${BASE}/storage/v1/object/job-files/uploads/b%20c.pdf`)
    expect(existsSync(path.join(dir, 'uploads/bad.png'))).toBe(false)
    expect(existsSync(path.join(dir, 'uploads/bad.png.part'))).toBe(false)
  })
})

describe('legacy verify helpers', () => {
  it('collects every uploads/ key from file_paths and nested item JSON', () => {
    const items = [{
      proof_urls: ['uploads/p1.pdf'], proof_url: 'uploads/p0.png', approved_proof_url: 'uploads/p1.pdf',
      proof_previews: { 'uploads/p1.pdf': 'uploads/p1-preview.png' },
      messages: [{ text: 'see uploads/ folder', files: ['uploads/m.jpg'] }], note: 'hello',
    }]
    expect([...collectKeys(items, collectKeys(['uploads/f.ai']))].sort()).toEqual(
      ['uploads/f.ai', 'uploads/m.jpg', 'uploads/p0.png', 'uploads/p1-preview.png', 'uploads/p1.pdf'])
  })

  it('servableKey matches the app’s isSafeKey', () => {
    for (const k of ['uploads/1763241122000-k3j2h1.pdf', 'uploads/b c.pdf', 'uploads/../x', 'uploads//x', '', 'x'.repeat(301), 'uploads/é.png']) {
      expect(servableKey(k)).toBe(isSafeKey(k))
    }
  })

  it('reviewToken matches the app’s signReviewToken', () => {
    process.env.REVIEW_LINK_SECRET = 'test-secret'
    for (const id of [1, 42, 999999]) expect(reviewToken(id, 'test-secret')).toBe(signReviewToken(id))
  })
})
