import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { hasDb, TEST_URL } from './helpers/db'

describe.skipIf(!hasDb)('GET /api/health', () => {
  let GET: typeof import('@/app/api/health/route').GET
  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_URL
    GET = (await import('@/app/api/health/route')).GET
  })

  it('200 when DB and files dir are OK', async () => {
    process.env.FILES_DIR = mkdtempSync(path.join(tmpdir(), 'ddf-health-'))
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ db: 'ok', files: 'ok' })
  })

  it('503 when the files dir is missing', async () => {
    process.env.FILES_DIR = '/nonexistent/ddf-files'
    const res = await GET()
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ db: 'ok', files: 'down' })
  })
})
