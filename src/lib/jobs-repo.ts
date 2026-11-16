import 'server-only'
import type postgres from 'postgres'
import { db } from '@/lib/db'

// All `jobs` queries. Results mirror supabase-js ({ data, error }) so routes keep
// their existing control flow. Functions never throw.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>
export type Result<T> = { data: T | null; error: Error | null }

export type JobColumn =
  | 'id' | 'tenant_id' | 'reference_number' | 'submission_id' | 'client_name' | 'company_name'
  | 'contact_email' | 'event_name' | 'date_required' | 'notes' | 'setup_location' | 'setup_time'
  | 'removal_location' | 'removal_time' | 'items' | 'file_paths' | 'production' | 'notify_client'
  | 'status' | 'submitted_at' | 'updated_at'

export interface NewJob {
  tenant_id: string
  reference_number: string
  client_name: string
  company_name: string
  contact_email: string
  event_name: string | null
  date_required: string
  notes: string | null
  setup_location: string | null
  setup_time: string | null
  removal_location: string | null
  removal_time: string | null
  items: unknown[]
  file_paths: string[]
  submission_id: string
  submitted_at: string
  status: string
}

const UPDATABLE = new Set<string>([
  'status', 'notify_client', 'date_required', 'event_name', 'notes', 'setup_location', 'setup_time',
  'removal_location', 'removal_time', 'items', 'file_paths', 'production',
])
const JSON_COLUMNS = new Set<string>(['items', 'production'])
const ARRAY_COLUMNS = new Set<string>(['file_paths'])

async function attempt<T>(label: string, fn: () => Promise<T | null>): Promise<Result<T>> {
  try {
    return { data: await fn(), error: null }
  } catch (e) {
    console.error(`[jobs-repo] ${label} failed:`, e)
    return { data: null, error: e instanceof Error ? e : new Error(String(e)) }
  }
}

const json = (v: unknown) => db().json(v as postgres.JSONValue)

export function getJob(id: number, columns: JobColumn[], tenantId?: string): Promise<Result<Row>> {
  return attempt('getJob', async () => {
    const sql = db()
    const rows = tenantId
      ? await sql`select ${sql(columns)} from jobs where id = ${id} and tenant_id = ${tenantId}`
      : await sql`select ${sql(columns)} from jobs where id = ${id}`
    return (rows[0] as Row | undefined) ?? null
  })
}

export function getJobByReference(reference: string, columns: JobColumn[]): Promise<Result<Row>> {
  return attempt('getJobByReference', async () => {
    const sql = db()
    const rows = await sql`select ${sql(columns)} from jobs where reference_number = ${reference}`
    return (rows[0] as Row | undefined) ?? null
  })
}

export function findJobBySubmissionId(submissionId: string): Promise<Result<Row>> {
  return attempt('findJobBySubmissionId', async () => {
    const rows = await db()`select reference_number from jobs where submission_id = ${submissionId}`
    return (rows[0] as Row | undefined) ?? null
  })
}

/** Case-insensitive reference match (clients retype these by hand). Equality, not LIKE. */
export function findJobsByReferenceCI(reference: string): Promise<Result<Row[]>> {
  return attempt('findJobsByReferenceCI', async () => {
    const rows = await db()`
      select id, contact_email from jobs where lower(reference_number) = lower(${reference}) limit 5`
    return rows as unknown as Row[]
  })
}

export function listJobs(tenantId: string): Promise<Result<Row[]>> {
  return attempt('listJobs', async () => {
    const rows = await db()`select * from jobs where tenant_id = ${tenantId} order by submitted_at desc`
    return rows as unknown as Row[]
  })
}

export function listJobFiles(tenantId: string): Promise<Result<Row[]>> {
  return attempt('listJobFiles', async () => {
    const rows = await db()`select file_paths, items from jobs where tenant_id = ${tenantId}`
    return rows as unknown as Row[]
  })
}

export function insertJob(j: NewJob): Promise<Result<{ id: number }>> {
  return attempt('insertJob', async () => {
    const sql = db()
    const [row] = await sql`
      insert into jobs (
        tenant_id, reference_number, client_name, company_name, contact_email, event_name,
        date_required, notes, setup_location, setup_time, removal_location, removal_time,
        items, file_paths, submission_id, submitted_at, status
      ) values (
        ${j.tenant_id}, ${j.reference_number}, ${j.client_name}, ${j.company_name}, ${j.contact_email}, ${j.event_name},
        ${j.date_required}, ${j.notes}, ${j.setup_location}, ${j.setup_time}, ${j.removal_location}, ${j.removal_time},
        ${json(j.items)}, ${sql.array(j.file_paths)}::text[], ${j.submission_id}, ${j.submitted_at}, ${j.status}
      ) returning id`
    return { id: row.id as number }
  })
}

/**
 * Update whitelisted columns. Returns the number of rows changed (0 when the
 * job doesn't exist or belongs to another tenant — same as supabase-js).
 */
export function updateJob(id: number, patch: Record<string, unknown>, tenantId?: string): Promise<Result<number>> {
  return attempt('updateJob', async () => {
    const sql = db()
    const keys = Object.keys(patch)
    if (keys.length === 0) return 0
    const values: Row = {}
    for (const k of keys) {
      if (!UPDATABLE.has(k)) throw new Error(`updateJob: column not allowed: ${k}`)
      const v = patch[k]
      values[k] = JSON_COLUMNS.has(k) ? json(v) : ARRAY_COLUMNS.has(k) ? sql.array((v ?? []) as string[]) : v
    }
    const rows = tenantId
      ? await sql`update jobs set ${sql(values, ...keys)} where id = ${id} and tenant_id = ${tenantId} returning id`
      : await sql`update jobs set ${sql(values, ...keys)} where id = ${id} returning id`
    return rows.length
  })
}

/** Row-locked single-item update (replaces rpc('update_job_item')). Returns the full items array. */
export function updateJobItem(jobId: number, index: number, patch: unknown, appendMessage: unknown): Promise<Result<unknown[]>> {
  return attempt('updateJobItem', async () => {
    const msg = appendMessage === null || appendMessage === undefined ? null : json(appendMessage)
    const [row] = await db()`select update_job_item(${jobId}, ${index}, ${json(patch)}, ${msg}) as items`
    return row.items as unknown[]
  })
}

/** Row-locked append (replaces rpc('append_to_job')). */
export function appendToJob(jobId: number, items: unknown[], files: string[]): Promise<Result<{ items: unknown[]; file_paths: string[] }>> {
  return attempt('appendToJob', async () => {
    const sql = db()
    const [row] = await sql`select append_to_job(${jobId}, ${json(items)}, ${sql.array(files)}::text[]) as result`
    return row.result as { items: unknown[]; file_paths: string[] }
  })
}
