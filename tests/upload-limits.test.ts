import { describe, it, expect, beforeAll } from 'vitest'
import { NextRequest } from 'next/server'

describe('POST /api/upload-url limits', () => {
  let POST: typeof import('@/app/api/upload-url/route').POST
  beforeAll(async () => {
    process.env.FILE_LINK_SECRET = 'test-file-secret-0123456789abcdef0123456789'
    POST = (await import('@/app/api/upload-url/route')).POST
  })
  const call = (files: { name: string; type: string; size: number }[]) =>
    POST(new NextRequest('http://x/api/upload-url', { method: 'POST', body: JSON.stringify({ files }) }))
  const MB = 1024 * 1024

  it('accepts a 95 MB file and rejects 96 MB', async () => {
    expect((await call([{ name: 'big.pdf', type: 'application/pdf', size: 95 * MB }])).status).toBe(200)
    const res = await call([{ name: 'huge.pdf', type: 'application/pdf', size: 96 * MB }])
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('95 MB')
  })
  it('accepts DXF with an empty or DXF content type', async () => {
    expect((await call([{ name: 'cut.dxf', type: '', size: 1000 }])).status).toBe(200)
    expect((await call([{ name: 'cut.dxf', type: 'image/vnd.dxf', size: 1000 }])).status).toBe(200)
  })
  it('accepts 10 files per request, rejects 11', async () => {
    const f = { name: 'a.png', type: 'image/png', size: 1000 }
    expect((await call(Array(10).fill(f))).status).toBe(200)
    expect((await call(Array(11).fill(f))).status).toBe(400)
  })
})
