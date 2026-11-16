import { describe, it, expect, beforeAll } from 'vitest'
import { NextRequest } from 'next/server'

process.env.FILE_LINK_SECRET = 'test-file-secret-0123456789abcdef0123456789'

describe('POST /api/upload-url size validation', () => {
  let POST: typeof import('@/app/api/upload-url/route').POST
  beforeAll(async () => { POST = (await import('@/app/api/upload-url/route')).POST })
  const call = (size: unknown) => POST(new NextRequest('http://localhost/api/upload-url', {
    method: 'POST', body: JSON.stringify({ files: [{ name: 'a.pdf', type: 'application/pdf', size }] }),
  }))

  it('rejects missing, non-numeric, negative, fractional and oversize sizes', async () => {
    for (const bad of [undefined, 'abc', '5', null, -1, 1.5, 95 * 1024 * 1024 + 1, Infinity]) {
      expect((await call(bad)).status).toBe(400)
    }
  })

  it('accepts a valid size', async () => {
    expect((await call(1234)).status).toBe(200)
    expect((await call(0)).status).toBe(200)
  })
})
