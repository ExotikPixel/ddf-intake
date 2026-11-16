import 'server-only'
import { db } from '@/lib/db'
import type { Result } from '@/lib/jobs-repo'

export interface LibraryRow { id: number; name: string; path: string; created_at: string }

async function attempt<T>(label: string, fn: () => Promise<T>): Promise<Result<T>> {
  try { return { data: await fn(), error: null } }
  catch (e) {
    console.error(`[library-repo] ${label} failed:`, e)
    return { data: null, error: e instanceof Error ? e : new Error(String(e)) }
  }
}

export function listLibrary(tenantId: string): Promise<Result<LibraryRow[]>> {
  return attempt('list', async () =>
    db()<LibraryRow[]>`select id, name, path, created_at from design_library
      where tenant_id = ${tenantId} order by created_at desc, id desc`)
}

export function insertLibraryEntry(tenantId: string, name: string, path: string): Promise<Result<LibraryRow>> {
  return attempt('insert', async () => {
    const [row] = await db()<LibraryRow[]>`insert into design_library (tenant_id, name, path)
      values (${tenantId}, ${name}, ${path}) returning id, name, path, created_at`
    return row
  })
}

/** Returns rows deleted (0 when the id isn't in this tenant). Never deletes the file itself. */
export function deleteLibraryEntry(id: number, tenantId: string): Promise<Result<number>> {
  return attempt('delete', async () =>
    (await db()`delete from design_library where id = ${id} and tenant_id = ${tenantId} returning id`).length)
}
