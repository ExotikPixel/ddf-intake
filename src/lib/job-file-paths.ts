import 'server-only'
import { exists } from '@/lib/file-store'
import { pathsReferencedElsewhere } from '@/lib/jobs-repo'

/**
 * Validate a client/admin-supplied file_paths array for a job. Every entry must
 * be a string that is either already on the job, or a freshly uploaded file
 * under uploads/ that exists on disk. Returns null when anything is invalid, so
 * a caller can never attach (and later delete) another job's files.
 */
export async function validateJobFilePaths(input: unknown, current: string[]): Promise<string[] | null> {
  if (!Array.isArray(input)) return null
  for (const p of input) {
    if (typeof p !== 'string') return null
    if (current.includes(p)) continue
    if (!p.startsWith('uploads/') || !(await exists(p))) return null
  }
  return input as string[]
}

/** Files safe to delete after removal from a job: not referenced by any other job. On lookup error, deletes nothing. */
export async function deletablePaths(jobId: number, removed: string[]): Promise<string[]> {
  if (removed.length === 0) return []
  const { data, error } = await pathsReferencedElsewhere(jobId, removed)
  if (error || !data) return []
  const keep = new Set(data)
  return removed.filter(p => !keep.has(p))
}
