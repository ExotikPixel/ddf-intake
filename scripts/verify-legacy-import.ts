// Phase 2 check: every old job and design is in the live DB, every file they
// point at is on disk (and servable), and a sample of old review links opens.
// Run from ~/ddf-intake with .env loaded (import-legacy.sh does this for you):
//   set -a; source .env; set +a; npx tsx scripts/verify-legacy-import.ts https://jobs.ddfpixel.com
import postgres from 'postgres'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { collectKeys, reviewToken, servableKey } from './lib/legacy'

const site = (process.argv[2] ?? 'https://jobs.ddfpixel.com').replace(/\/+$/, '')
const need = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`${k} is required (load .env first)`); return v }
const dbUrl = (db: string) =>
  `postgres://ddf:${encodeURIComponent(need('POSTGRES_PASSWORD'))}@127.0.0.1:${process.env.DB_PORT ?? '5433'}/${db}`

async function main() {
  const live = postgres(dbUrl('ddf'), { max: 1, onnotice: () => {} })
  const legacy = postgres(dbUrl('legacy'), { max: 1, onnotice: () => {} })
  const filesDir = path.join(need('DDF_DATA_DIR'), 'files')
  const secret = need('REVIEW_LINK_SECRET')
  let problems = 0
  const problem = (msg: string, list: (string | number)[] = []) => {
    problems++
    console.log(`⚠️  ${msg}`)
    if (list.length) console.log(list.slice(0, 30).map(x => `     ${x}`).join('\n') + (list.length > 30 ? `\n     … and ${list.length - 30} more` : ''))
  }
  try {
    const legacyJobs = await legacy<{ id: string; reference_number: string }[]>`select id, reference_number from jobs order by id`
    const liveRows = await live<{ id: string; file_paths: string[]; items: unknown }[]>`
      select id, file_paths, items from jobs where id < 1000000 order by id`
    const liveIds = new Set(liveRows.map(r => Number(r.id)))
    const missingJobs = legacyJobs.filter(r => !liveIds.has(Number(r.id)))
    console.log(`jobs: ${legacyJobs.length} old, ${liveIds.size} in the live system, ${missingJobs.length} missing`)
    if (missingJobs.length) problem('old jobs not in the live system:', missingJobs.map(r => `${r.reference_number} (job ${r.id})`))

    const [{ n: legacyDesigns }] = await legacy<{ n: number }[]>`select count(*)::int as n from design_library`.catch(() => [{ n: 0 }])
    const [{ n: liveDesigns }] = await live<{ n: number }[]>`select count(*)::int as n from design_library where id < 1000000`
    console.log(`design library: ${legacyDesigns} old, ${liveDesigns} imported`)
    if (liveDesigns < legacyDesigns) problem('some old design-library entries are missing')

    const keys = new Set<string>()
    for (const r of liveRows) { collectKeys(r.file_paths, keys); collectKeys(r.items, keys) }
    for (const r of await live<{ path: string }[]>`select path from design_library`) keys.add(r.path)
    const missing: string[] = []
    const unservable: string[] = []
    for (const k of keys) {
      if (!servableKey(k)) { unservable.push(k); continue }
      try { await stat(path.join(filesDir, k)) } catch { missing.push(k) }
    }
    console.log(`files referenced: ${keys.size}, missing on disk: ${missing.length}, unusable names: ${unservable.length}`)
    if (missing.length) problem('files the jobs point at but which are not on disk:', missing)
    if (unservable.length) problem('files with names the new system refuses to serve (spaces/odd characters):', unservable)

    const sample = [...liveIds].sort(() => Math.random() - 0.5).slice(0, 5)
    for (const id of sample) {
      const res = await fetch(`${site}/api/review/${reviewToken(id, secret)}`)
      console.log(`old review link, job ${id}: HTTP ${res.status}`)
      if (res.status !== 200) problem(`review link for job ${id} did not open (HTTP ${res.status})`)
    }
  } finally {
    await live.end(); await legacy.end()
  }
  console.log(problems ? `\n⚠️  ${problems} problem(s) above — send this output to Claude.` : '\n✅ Import verified: old jobs, files and review links all check out.')
  if (problems) process.exitCode = 1
}

main().catch(e => { console.error(`❌ ${(e as Error).message}`); process.exitCode = 1 })
