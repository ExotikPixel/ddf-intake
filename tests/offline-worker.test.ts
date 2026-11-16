import { describe, it, expect, vi, afterEach } from 'vitest'
import worker from '../cloudflare/offline-worker/src/index'

const req = (p: string) => new Request(`https://jobs.ddfpixel.com${p}`)
afterEach(() => { vi.unstubAllGlobals() })

describe('offline worker', () => {
  it('passes healthy responses through untouched', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 200 })))
    const r = await worker.fetch(req('/'))
    expect(r.status).toBe(200)
    expect(await r.text()).toBe('ok')
  })

  it('does not mask the app’s own 404 or 503', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })))
    expect((await worker.fetch(req('/x'))).status).toBe(404)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })))
    expect(await (await worker.fetch(req('/api/health'))).text()).toBe('{}')
  })

  it.each([502, 521, 522, 523, 524, 530])('serves the offline page on %i', async status => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status })))
    const r = await worker.fetch(req('/portal'))
    expect(r.status).toBe(503)
    expect(r.headers.get('content-type')).toContain('text/html')
    expect(await r.text()).toContain('hello@ddfevents.ca')
  })

  it('returns JSON for API calls and when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down') }))
    const r = await worker.fetch(req('/api/submit'))
    expect(r.status).toBe(503)
    expect(await r.json()).toMatchObject({ error: 'offline' })
  })
})
