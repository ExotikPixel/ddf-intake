import { describe, it, expect, beforeAll, vi, afterEach } from 'vitest'
import { createHmac } from 'node:crypto'
import { signUploadToken, verifyUploadToken, signUploadPath, signFileLink, verifyFileToken } from '@/lib/file-tokens'

describe('file-tokens', () => {
  beforeAll(() => {
    process.env.FILE_LINK_SECRET = 'test-file-secret-0123456789abcdef0123456789'
    process.env.PUBLIC_BASE_URL = 'https://jobs.example.com/'
  })

  it('round-trips an upload token', () => {
    const t = signUploadToken('uploads/a.pdf', 'application/pdf', 123)
    expect(verifyUploadToken(t)).toMatchObject({ key: 'uploads/a.pdf', type: 'application/pdf', size: 123 })
  })

  it('upload paths are relative (work on any host)', () => {
    expect(signUploadPath('uploads/a.pdf', 'application/pdf', 1)).toMatch(/^\/upload\/[\w-]+\.[\w-]+$/)
  })

  it('file links are absolute on PUBLIC_BASE_URL and verify', () => {
    const url = signFileLink('uploads/a.pdf', 60)
    expect(url.startsWith('https://jobs.example.com/f/')).toBe(true)
    expect(verifyFileToken(url.split('/f/')[1])?.key).toBe('uploads/a.pdf')
  })

  it('rejects expired links', () => {
    const tok = signFileLink('uploads/a.pdf', 60).split('/f/')[1]
    expect(verifyFileToken(tok, Date.now() + 61_000)).toBeNull()
  })

  it('rejects a tampered payload', () => {
    const tok = signFileLink('uploads/a.pdf', 60).split('/f/')[1]
    const sig = tok.split('.')[1]
    const forged = Buffer.from(JSON.stringify({ k: 'get', key: 'uploads/other.pdf', exp: 9_999_999_999 })).toString('base64url')
    expect(verifyFileToken(`${forged}.${sig}`)).toBeNull()
  })

  it('rejects an upload token used as a download link, and garbage', () => {
    expect(verifyFileToken(signUploadToken('uploads/a.pdf', 'x', 1))).toBeNull()
    expect(verifyFileToken('nope')).toBeNull()
    expect(verifyUploadToken('a.b')).toBeNull()
  })

  afterEach(() => { vi.unstubAllEnvs(); process.env.PUBLIC_BASE_URL = 'https://jobs.example.com/' })

  it('rejects a validly-signed upload token whose size is missing or invalid', () => {
    const forge = (claims: object) => {
      const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
      const sig = createHmac('sha256', process.env.FILE_LINK_SECRET!).update(payload).digest('base64url')
      return `${payload}.${sig}`
    }
    const exp = 9_999_999_999
    expect(verifyUploadToken(forge({ k: 'put', key: 'uploads/a.pdf', type: 'x', exp }))).toBeNull()
    expect(verifyUploadToken(forge({ k: 'put', key: 'uploads/a.pdf', type: 'x', size: -1, exp }))).toBeNull()
    expect(verifyUploadToken(forge({ k: 'put', key: 'uploads/a.pdf', type: 'x', size: '5', exp }))).toBeNull()
    expect(verifyUploadToken(forge({ k: 'put', key: 'uploads/a.pdf', type: 'x', size: 5, exp }))).not.toBeNull()
  })

  it('refuses to sign file links in production without PUBLIC_BASE_URL', () => {
    vi.stubEnv('NODE_ENV', 'production')
    delete process.env.PUBLIC_BASE_URL
    expect(() => signFileLink('uploads/a.pdf', 60)).toThrow(/PUBLIC_BASE_URL/)
  })

  it('falls back to localhost outside production', () => {
    vi.stubEnv('NODE_ENV', 'test')
    delete process.env.PUBLIC_BASE_URL
    expect(signFileLink('uploads/a.pdf', 60).startsWith('http://localhost:3000/f/')).toBe(true)
  })
})
