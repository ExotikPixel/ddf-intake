import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'

process.env.FILES_DIR = mkdtempSync(path.join(tmpdir(), 'ddf-routes-'))
process.env.FILE_LINK_SECRET = 'test-file-secret-0123456789abcdef0123456789'
process.env.PUBLIC_BASE_URL = 'http://localhost'

const ctx = (token: string) => ({ params: Promise.resolve({ token }) })

describe('/upload/[token] and /f/[token]', () => {
  let PUT: typeof import('@/app/upload/[token]/route').PUT
  let GET: typeof import('@/app/f/[token]/route').GET
  let tokens: typeof import('@/lib/file-tokens')
  beforeAll(async () => {
    PUT = (await import('@/app/upload/[token]/route')).PUT
    GET = (await import('@/app/f/[token]/route')).GET
    tokens = await import('@/lib/file-tokens')
  })

  const put = (token: string, body: Buffer, type: string) =>
    PUT(new NextRequest(`http://localhost/upload/${token}`, {
      method: 'PUT', body: new Uint8Array(body), headers: { 'content-type': type, 'content-length': String(body.length) },
    }), ctx(token))

  it('stores an upload and serves it back', async () => {
    const t = tokens.signUploadToken('uploads/r1.pdf', 'application/pdf', 5)
    expect((await put(t, Buffer.from('hello'), 'application/pdf')).status).toBe(200)
    const ft = tokens.signFileLink('uploads/r1.pdf', 60).split('/f/')[1]
    const res = await GET(new NextRequest(`http://localhost/f/${ft}`), ctx(ft))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(await res.text()).toBe('hello')
  })

  it('413 when the body is bigger than the signed size', async () => {
    const t = tokens.signUploadToken('uploads/r2.pdf', 'application/pdf', 3)
    expect((await put(t, Buffer.from('hello'), 'application/pdf')).status).toBe(413)
  })

  it('400 on content-type mismatch, 403 on a bad token', async () => {
    const t = tokens.signUploadToken('uploads/r3.pdf', 'application/pdf', 5)
    expect((await put(t, Buffer.from('hello'), 'image/png')).status).toBe(400)
    expect((await put('bad.token', Buffer.from('x'), 'application/pdf')).status).toBe(403)
  })

  it('404 for a missing file; 403 for a bad link', async () => {
    const ft = tokens.signFileLink('uploads/missing.pdf', 60).split('/f/')[1]
    expect((await GET(new NextRequest(`http://localhost/f/${ft}`), ctx(ft))).status).toBe(404)
    expect((await GET(new NextRequest('http://localhost/f/x.y'), ctx('x.y'))).status).toBe(403)
  })

  it('serves SVG with a script-blocking CSP (same-origin XSS guard)', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')
    const t = tokens.signUploadToken('uploads/r4.svg', 'image/svg+xml', svg.length)
    expect((await put(t, svg, 'image/svg+xml')).status).toBe(200)
    const ft = tokens.signFileLink('uploads/r4.svg', 60).split('/f/')[1]
    const res = await GET(new NextRequest(`http://localhost/f/${ft}`), ctx(ft))
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'")
  })
})
