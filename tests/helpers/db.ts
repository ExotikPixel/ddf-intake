import postgres from 'postgres'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

// Loads TEST_DATABASE_URL from .env when not already in the environment.
function loadDotEnv(): void {
  if (process.env.TEST_DATABASE_URL) return
  try {
    for (const line of readFileSync('.env', 'utf8').split('\n')) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
    }
  } catch { /* no .env — DB suites will skip */ }
}
loadDotEnv()

export const TEST_URL = process.env.TEST_DATABASE_URL ?? ''
export const hasDb = TEST_URL !== ''

/** Apply db/schema.sql to ddf_test via psql inside the container ($$ bodies need psql). */
export function applySchema(): void {
  execFileSync(
    'docker',
    ['compose', 'exec', '-T', 'db', 'psql', '-U', 'ddf', '-d', 'ddf_test', '-v', 'ON_ERROR_STOP=1', '-q'],
    { input: readFileSync('db/schema.sql') },
  )
}

/** Empty every app table (tenants stay seeded) and restart identities at their START values. */
export async function resetTables(): Promise<void> {
  const sql = postgres(TEST_URL, { max: 1, onnotice: () => {} })
  await sql`truncate jobs, design_library, kanban_sync_queue, admin_users restart identity cascade`
  await sql.end()
}

/** A throwaway client for assertions that bypass the app code. */
export function rawSql() {
  return postgres(TEST_URL, { max: 1, onnotice: () => {} })
}
