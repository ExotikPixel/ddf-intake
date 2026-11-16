import { describe, it, expect, beforeAll } from 'vitest'
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
})
