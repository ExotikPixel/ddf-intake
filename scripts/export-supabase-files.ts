// Download every object in the old Supabase `job-files` bucket to <outDir>, keeping keys.
// Re-runnable: skips files already present with the same size.
//   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npx tsx scripts/export-supabase-files.ts ~/DDF-Data/legacy-supabase/files
import { listBucket, downloadAll } from './lib/legacy'

async function main() {
  const base = process.env.SUPABASE_URL ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  const outDir = process.argv[2]
  if (!base || !key || !outDir) throw new Error('need SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and <outDir>')

  const objects = await listBucket(base, key)
  const total = objects.reduce((s, o) => s + Math.max(o.size, 0), 0)
  console.log(`${objects.length} files in Supabase, ${(total / 1073741824).toFixed(2)} GB`)

  const r = await downloadAll(base, key, outDir, objects)
  console.log(`✅ downloaded ${r.downloaded}, already had ${r.skipped}, failed ${r.failed.length}`)
  if (r.failed.length) {
    console.log('Some files failed. Run the same command again — it picks up where it left off.')
    process.exitCode = 1
  }
}

main().catch(e => { console.error(`❌ ${(e as Error).message}`); process.exitCode = 1 })
