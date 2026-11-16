// End-to-end smoke test against a running instance. Creates one job and cleans
// up exactly what it created (job id, library id, uploaded file keys).
//
//   SMOKE_ADMIN_EMAIL=… SMOKE_ADMIN_PASSWORD=… SMOKE_CLIENT_EMAIL=… \
//   SMOKE_DATABASE_URL=postgres://… SMOKE_FILES_DIR=/path/to/files \
//   npx tsx scripts/smoke.ts <baseUrl> [--approve]
//
// --approve also approves via the review link, which pushes a Kanban ticket to
// Command Centre. Use it on staging only (Command Centre URLs empty), not production.
import postgres from 'postgres'
import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import path from 'node:path'

const base = (process.argv[2] ?? '').replace(/\/+$/, '')
const approve = process.argv.includes('--approve')
const createdKeys: string[] = []
let createdJobId: number | null = null
let createdLibraryId: number | null = null

function env(k: string): string {
  const v = process.env[k]
  if (!v) throw new Error(`${k} is required`)
  return v
}
const step = (s: string) => console.log(`→ ${s}`)

async function call(method: string, p: string, body?: unknown, cookie = ''): Promise<Response> {
  return fetch(base + p, {
    method,
    redirect: 'manual',
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}
async function ok(res: Response, what: string): Promise<Response> {
  if (!res.ok) throw new Error(`${what} failed: HTTP ${res.status} ${await res.text()}`)
  return res
}
function cookie(res: Response, name: string): string {
  const c = res.headers.getSetCookie().find(h => h.startsWith(`${name}=`))
  if (!c) throw new Error(`no ${name} cookie`)
  return c.split(';')[0]
}

async function main() {
  if (!base) throw new Error('usage: smoke.ts <baseUrl> [--approve]')
  const pdf = Buffer.from('%PDF-1.4\n% ddf smoke test\n%%EOF\n')

  step('health')
  await ok(await call('GET', '/api/health'), 'health')

  step('upload a file')
  const up = await (await ok(await call('POST', '/api/upload-url', { files: [{ name: 'smoke.pdf', type: 'application/pdf', size: pdf.length }] }), 'upload-url')).json() as { uploads: { path: string; signedUrl: string }[] }
  const key = up.uploads[0].path
  createdKeys.push(key)
  await ok(await fetch(new URL(up.uploads[0].signedUrl, base), { method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, body: pdf }), 'PUT upload')

  step('submit a brief')
  const clientEmail = env('SMOKE_CLIENT_EMAIL').toLowerCase()
  const sub = await (await ok(await call('POST', '/api/submit', {
    clientName: 'Smoke Test', companyName: 'Smoke Test Co', contactEmail: clientEmail, dateRequired: '2030-01-01',
    items: [{ name: 'Smoke item', quantity: 1, size: '1x1 ft', material: 'vinyl' }],
    filePaths: [key], submissionId: randomUUID(),
  }), 'submit')).json() as { referenceNumber: string }
  const ref = sub.referenceNumber

  step('admin login')
  const adminCookie = cookie(await ok(await call('POST', '/api/admin/login', { email: env('SMOKE_ADMIN_EMAIL'), password: env('SMOKE_ADMIN_PASSWORD') }), 'admin login'), 'ddf_admin')

  step('admin sees the job')
  const { jobs } = await (await ok(await call('GET', '/api/admin/jobs', undefined, adminCookie), 'admin jobs')).json() as { jobs: { id: number; reference_number: string }[] }
  const job = jobs.find(j => j.reference_number === ref)
  if (!job) throw new Error(`job ${ref} not in admin list`)
  createdJobId = job.id

  step('admin attaches a proof')
  await ok(await call('PATCH', `/api/admin/jobs/${job.id}`, { itemPatch: { index: 0, patch: { proof_urls: [key], approval_status: 'pending' } } }, adminCookie), 'attach proof')

  step('review link opens')
  const { url } = await (await ok(await call('GET', `/api/admin/jobs/${job.id}/review-link`, undefined, adminCookie), 'review-link')).json() as { url: string }
  const token = url.split('/review/')[1]
  await ok(await call('GET', `/api/review/${token}`), 'review data')
  if (approve) {
    step('client approves via review link')
    await ok(await call('POST', `/api/review/${token}/approve`, { itemIndex: 0, action: 'approve' }), 'approve')
  }

  step('portal lookup (case-insensitive reference)')
  const portalCookie = cookie(await ok(await call('POST', '/api/portal/lookup', { reference: ref.toLowerCase(), email: clientEmail }), 'portal lookup'), 'portal_token')
  const me = await (await ok(await call('GET', '/api/portal/me', undefined, portalCookie), 'portal me')).json() as { jobs: { reference_number: string }[] }
  if (me.jobs[0]?.reference_number !== ref) throw new Error('portal returned the wrong job')

  step('design library add → file link → delete')
  const lib = await (await ok(await call('POST', '/api/admin/library', { name: 'Smoke design', path: key }, adminCookie), 'library add')).json() as { item: { id: number; url: string | null } }
  createdLibraryId = lib.item.id
  if (!lib.item.url) throw new Error('library item has no file link')
  const file = await ok(await fetch(lib.item.url.replace(/^https?:\/\/[^/]+/, base)), 'file link')
  if ((await file.arrayBuffer()).byteLength !== pdf.length) throw new Error('downloaded bytes differ')
  await ok(await call('DELETE', '/api/admin/library', { id: createdLibraryId }, adminCookie), 'library delete')
  createdLibraryId = null

  console.log(`✅ smoke passed (${ref}, job ${createdJobId})`)
}

async function cleanup() {
  const dbUrl = process.env.SMOKE_DATABASE_URL
  const filesDir = process.env.SMOKE_FILES_DIR
  if (dbUrl && (createdJobId !== null || createdLibraryId !== null)) {
    const sql = postgres(dbUrl, { max: 1, onnotice: () => {} })
    if (createdLibraryId !== null) await sql`delete from design_library where id = ${createdLibraryId}`
    if (createdJobId !== null) await sql`delete from jobs where id = ${createdJobId}`   // queue row cascades
    await sql.end()
  }
  if (filesDir) for (const k of createdKeys) await rm(path.join(filesDir, k), { force: true })
  console.log(`🧹 removed job ${createdJobId ?? '—'} and ${createdKeys.length} file(s)`)
}

main()
  .catch(e => { console.error(`❌ ${(e as Error).message}`); process.exitCode = 1 })
  .finally(() => cleanup().catch(e => console.error('cleanup failed:', e)))
