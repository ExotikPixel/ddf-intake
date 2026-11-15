# Client Experience v2 — Plan B: Feature Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ] `) syntax for tracking.

**Goal:** Add the server side of the four new features — progress tracker, morning print digest, approval reminders, Square deposits — plus the shared schema columns (`reminders`, `deposit`, `job_type`, `fulfillment`) and a branded email layout.

**Architecture:** Pure, unit-tested logic modules (`progress.ts`, `schedule.ts`, `reminders.ts`, `deposits.ts`, `email-layout.ts`, `local-time.ts`) with thin route handlers on top. Scheduled work runs through Bearer-protected `/api/cron/*` routes that the existing `ops` loop calls (age/hour based, so it catches up after the shop PC was off). Square is called with raw `fetch` (no SDK); payment status arrives by signed webhook and is reconciled daily.

**Tech Stack:** Next.js 16 route handlers, `postgres` repos from Phase 1, Brevo (`@getbrevo/brevo`), ntfy, Square Checkout + Orders APIs, vitest.

**Spec:** `docs/superpowers/specs/2026-11-15-client-experience-v2-design.md` (Part B, sections 4–5).
**Prerequisite:** Supabase Exit Phase 1 merged (this plan uses `jobs-repo.ts`, `file-tokens.ts`, `admin-auth.ts`, `ops/loop.sh`, `tests/helpers/db.ts`).
**Runs in parallel with:** Plan A. **Plan C** needs this plan.

---

## Ground rules

- Read `AGENTS.md` (Next.js 16 docs live in `node_modules/next/dist/docs/`).
- Branch: `git checkout main && git pull && git checkout -b cx2-features`.
- TDD: write the failing test, watch it fail, implement, watch it pass, commit.
- DB tests need the local container: `docker compose up -d db` (they skip without `TEST_DATABASE_URL`).
- Never delete rows by broad query; tests clean up with `resetTables()` on `ddf_test` only.

## File map

| File | Status | Responsibility |
|---|---|---|
| `db/schema.sql` | modify | `reminders`, `deposit`, `job_type`, `fulfillment` columns |
| `src/lib/jobs-repo.ts` | modify | new columns; `listOpenJobs`; `findJobByDepositOrder` |
| `src/lib/job-types.ts` | modify | `proof_sent_at`, `preview` on items; `withProofStamp`; merge stamps |
| `src/lib/local-time.ts` | create | Toronto local date/hour helpers |
| `src/lib/progress.ts` | create | `deriveStages()` for the client tracker |
| `src/lib/schedule.ts` | create | `buildSchedule()` for the 7-day print schedule |
| `src/lib/reminders.ts` | create | waiting items + reminder decision |
| `src/lib/deposits.ts` | create | deposit types, amount, `markDepositPaid` |
| `src/lib/square.ts` | create | Square payment links, orders, webhook signature |
| `src/lib/email-layout.ts` | create | branded table-based email HTML |
| `src/lib/mailer.ts` | create | Brevo send wrapper (never throws) |
| `src/lib/notify-v2.ts` | create | reminder, deposit, deposit-paid, digest emails |
| `src/app/api/cron/morning-digest/route.ts` | create | daily digest |
| `src/app/api/cron/approval-reminders/route.ts` | create | reminder run |
| `src/app/api/cron/deposit-reconcile/route.ts` | create | Square order check |
| `src/app/api/admin/schedule/route.ts` | create | live schedule for admin |
| `src/app/api/admin/jobs/[id]/reminders/route.ts` | create | send now / pause |
| `src/app/api/admin/jobs/[id]/deposit/route.ts` | create | request / cancel deposit |
| `src/app/api/square/webhook/route.ts` | create | payment webhook |
| `src/app/api/admin/jobs/[id]/route.ts` | modify | stamp `proof_sent_at` on proof changes |
| `src/app/api/portal/me/route.ts`, `src/app/api/review/[token]/route.ts` | modify | add `stages` (portal) and `deposit` (both) to responses |
| `src/lib/cron-auth.ts` | create | shared Bearer check |
| `src/lib/deposit-settle.ts` | create | shared "mark paid + notify" for webhook and reconcile |
| `ops/loop.sh`, `.env.example`, `SYSTEM_STATE.md` | modify | schedule + env + docs |
| `tests/*.test.ts` | create | one suite per module/route |

---

### Task 1: Schema columns and repo support

**Files:** Modify `db/schema.sql`, `src/lib/jobs-repo.ts`; Test `tests/jobs-repo-v2.test.ts`

- [ ] **Step 1: Write the failing test — `tests/jobs-repo-v2.test.ts`**

```ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { hasDb, TEST_URL, applySchema, resetTables } from './helpers/db'

describe.skipIf(!hasDb)('jobs-repo v2 columns', () => {
  let repo: typeof import('@/lib/jobs-repo')
  let tenantId: string
  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_URL
    applySchema()
    repo = await import('@/lib/jobs-repo')
    tenantId = await (await import('@/lib/tenant')).getDefaultTenantId()
  })
  beforeEach(async () => { await resetTables() })

  const job = (over: Partial<import('@/lib/jobs-repo').NewJob> = {}) => ({
    tenant_id: tenantId, reference_number: `DDF-T-${randomUUID().slice(0, 6)}`, client_name: 'A', company_name: 'B',
    contact_email: 'a@b.co', event_name: null, date_required: '2030-01-02', notes: null, setup_location: null,
    setup_time: null, removal_location: null, removal_time: null, items: [], file_paths: [],
    submission_id: randomUUID(), submitted_at: new Date().toISOString(), status: 'pending', ...over,
  })

  it('defaults job_type to event and stores product + fulfillment', async () => {
    const a = (await repo.insertJob(job())).data!
    const b = (await repo.insertJob(job({ job_type: 'product', fulfillment: 'pickup' }))).data!
    expect((await repo.getJob(a.id, ['job_type', 'fulfillment', 'reminders', 'deposit'])).data)
      .toEqual({ job_type: 'event', fulfillment: null, reminders: {}, deposit: null })
    expect((await repo.getJob(b.id, ['job_type', 'fulfillment'])).data).toEqual({ job_type: 'product', fulfillment: 'pickup' })
  })

  it('updates reminders and deposit jsonb, and finds a job by deposit order id', async () => {
    const { id } = (await repo.insertJob(job())).data!
    await repo.updateJob(id, { reminders: { count: 1, last_sent_at: '2030-01-01T10:00:00.000Z' }, deposit: { order_id: 'ORD1', status: 'sent', amount_cents: 1000 } })
    expect((await repo.getJob(id, ['reminders'])).data!.reminders).toEqual({ count: 1, last_sent_at: '2030-01-01T10:00:00.000Z' })
    expect((await repo.findJobByDepositOrder('ORD1')).data).toMatchObject({ id })
    expect((await repo.findJobByDepositOrder('NOPE')).data).toBeNull()
  })

  it('listOpenJobs skips completed and cancelled jobs', async () => {
    await repo.insertJob(job({ status: 'received' }))
    await repo.insertJob(job({ status: 'completed' }))
    await repo.insertJob(job({ status: 'cancelled' }))
    const { data } = await repo.listOpenJobs(['id', 'status'])
    expect(data!.map(r => r.status)).toEqual(['received'])
  })

  it('rejects an invalid job_type', async () => {
    const res = await repo.insertJob(job({ job_type: 'party' as 'event' }))
    expect(res.error).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/jobs-repo-v2.test.ts`
Expected: FAIL (unknown columns / `job_type` not in `NewJob` / `listOpenJobs` missing).

- [ ] **Step 3: Append to `db/schema.sql`** (right after the `jobs` indexes block)

```sql
-- ── Client experience v2 ────────────────────────────────────────────
alter table public.jobs add column if not exists job_type text not null default 'event';
alter table public.jobs add column if not exists fulfillment text;
alter table public.jobs add column if not exists reminders jsonb not null default '{}'::jsonb;
alter table public.jobs add column if not exists deposit jsonb;

do $$ begin
  alter table public.jobs add constraint jobs_job_type_chk check (job_type in ('event','product'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.jobs add constraint jobs_fulfillment_chk check (fulfillment is null or fulfillment in ('pickup','delivery','install'));
exception when duplicate_object then null; end $$;

create index if not exists jobs_deposit_order_idx on public.jobs ((deposit->>'order_id'));
```

- [ ] **Step 4: Update `src/lib/jobs-repo.ts`**

Add to the `JobColumn` union: `| 'job_type' | 'fulfillment' | 'reminders' | 'deposit'`.

Add to `NewJob`:
```ts
  job_type?: 'event' | 'product'
  fulfillment?: 'pickup' | 'delivery' | 'install' | null
```
Extend the sets:
```ts
const UPDATABLE = new Set<string>([
  'status', 'notify_client', 'date_required', 'event_name', 'notes', 'setup_location', 'setup_time',
  'removal_location', 'removal_time', 'items', 'file_paths', 'production',
  'job_type', 'fulfillment', 'reminders', 'deposit',
])
const JSON_COLUMNS = new Set<string>(['items', 'production', 'reminders', 'deposit'])
```
In `insertJob`, add the two columns to the column list and values:
```ts
        items, file_paths, submission_id, submitted_at, status, job_type, fulfillment
      ) values (
        …existing values…, ${j.status}, ${j.job_type ?? 'event'}, ${j.fulfillment ?? null}
```
In `updateJob`, `deposit` may be `null` — make the JSON branch pass nulls through:
```ts
      values[k] = JSON_COLUMNS.has(k) ? (v === null ? null : json(v)) : ARRAY_COLUMNS.has(k) ? sql.array((v ?? []) as string[]) : v
```
Add two functions:
```ts
/** Every job that isn't completed or cancelled (small set; callers filter further). */
export function listOpenJobs(columns: JobColumn[]): Promise<Result<Row[]>> {
  return attempt('listOpenJobs', async () => {
    const sql = db()
    const rows = await sql`select ${sql(columns)} from jobs where status not in ('completed', 'cancelled') order by date_required asc, id asc`
    return rows as unknown as Row[]
  })
}

export function findJobByDepositOrder(orderId: string): Promise<Result<Row>> {
  return attempt('findJobByDepositOrder', async () => {
    const rows = await db()`select id, reference_number, event_name, company_name, client_name, contact_email, deposit from jobs where deposit->>'order_id' = ${orderId}`
    return (rows[0] as Row | undefined) ?? null
  })
}
```

- [ ] **Step 5: Apply schema locally and run the tests**

```bash
docker compose exec -T db psql -U ddf -d ddf_dev -v ON_ERROR_STOP=1 -q < db/schema.sql
npx vitest run tests/jobs-repo-v2.test.ts tests/jobs-repo.test.ts
```
Expected: all pass (the suite re-applies the schema to `ddf_test` itself).

- [ ] **Step 6: Commit**

```bash
git add db/schema.sql src/lib/jobs-repo.ts tests/jobs-repo-v2.test.ts
git commit -m "feat(db): job_type, fulfillment, reminders, deposit columns"
```

---

### Task 2: Stamp `proof_sent_at` whenever the shop sends proofs

Reminders count from when proofs were sent. The admin UI clears `proof_uploaded_at` (that field means "client uploaded their own file"), so add a dedicated server-side stamp.

**Files:** Modify `src/lib/job-types.ts`, `src/app/api/admin/jobs/[id]/route.ts`; Test `tests/proof-stamp.test.ts`

- [ ] **Step 1: Write the failing test — `tests/proof-stamp.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { withProofStamp, mergeItemsPreservingApproval } from '@/lib/job-types'
import type { JobItem } from '@/lib/job-types'

const base: JobItem = { name: 'Sign', quantity: 1, size: '24x36', material: 'foam-board' }
const NOW = '2030-01-05T12:00:00.000Z'

describe('withProofStamp', () => {
  it('stamps when proof_urls change', () => {
    expect(withProofStamp({ ...base, proof_urls: ['uploads/a.png'] }, { proof_urls: ['uploads/b.png'] }, NOW)).toMatchObject({ proof_urls: ['uploads/b.png'], proof_sent_at: NOW })
  })
  it('stamps the first proof', () => {
    expect(withProofStamp(base, { proof_urls: ['uploads/a.png'] }, NOW).proof_sent_at).toBe(NOW)
  })
  it('does not stamp when proofs are unchanged or the patch has no proofs', () => {
    expect(withProofStamp({ ...base, proof_urls: ['uploads/a.png'] }, { proof_urls: ['uploads/a.png'] }, NOW).proof_sent_at).toBeUndefined()
    expect(withProofStamp(base, { quote_price: 10 }, NOW).proof_sent_at).toBeUndefined()
  })
  it('does not stamp when proofs are cleared', () => {
    expect(withProofStamp({ ...base, proof_urls: ['uploads/a.png'] }, { proof_urls: [] }, NOW).proof_sent_at).toBeUndefined()
  })
})

describe('mergeItemsPreservingApproval stamps changed proofs', () => {
  it('stamps a changed design and keeps the old stamp otherwise', () => {
    const current: JobItem[] = [
      { ...base, proof_urls: ['uploads/a.png'], proof_sent_at: '2030-01-01T00:00:00.000Z' },
      { ...base, proof_urls: ['uploads/c.png'], proof_sent_at: '2030-01-02T00:00:00.000Z' },
    ]
    const incoming: JobItem[] = [
      { ...base, proof_urls: ['uploads/b.png'] },
      { ...base, proof_urls: ['uploads/c.png'] },
    ]
    const out = mergeItemsPreservingApproval(incoming, current, NOW)
    expect(out[0].proof_sent_at).toBe(NOW)
    expect(out[0].approval_status).toBe('pending')
    expect(out[1].proof_sent_at).toBe('2030-01-02T00:00:00.000Z')
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/proof-stamp.test.ts`
Expected: FAIL — `withProofStamp` is not exported.

- [ ] **Step 3: Update `src/lib/job-types.ts`.** Add to `JobItem` (after `proof_uploaded_at`):

```ts
  proof_sent_at?: string                              // ISO timestamp when the shop last sent/changed proofs (reminders count from here)
  preview?: 'floor' | 'flat'                          // approval page: show the "On the floor" perspective preview
```
Add the helper (below `approvedProofs`):
```ts
/** Patch helper: when a shop patch changes an item's proofs to a non-empty set, stamp proof_sent_at. */
export function withProofStamp(current: JobItem | undefined, patch: Record<string, unknown>, now = new Date().toISOString()): Record<string, unknown> {
  const next = Array.isArray(patch.proof_urls) ? (patch.proof_urls as string[])
    : typeof patch.proof_url === 'string' ? [patch.proof_url] : null
  if (!next || next.length === 0) return patch
  const before = current ? itemProofs(current) : []
  if (JSON.stringify(before) === JSON.stringify(next)) return patch
  return { ...patch, proof_sent_at: now }
}
```
Change `mergeItemsPreservingApproval`'s signature and the two places it builds items:
```ts
export function mergeItemsPreservingApproval(incoming: JobItem[], current: JobItem[], now = new Date().toISOString()): JobItem[] {
```
- New item (`if (!cur)`): `return itemProofs(inc).length ? { ...inc, proof_sent_at: inc.proof_sent_at ?? now } : inc`
- In `merged`, add `proof_sent_at: cur.proof_sent_at,`
- In the client-file branch, add `proof_sent_at: cur.proof_sent_at,`
- In the `!sameProofs` branch, add `if (itemProofs(inc).length) merged.proof_sent_at = now`

- [ ] **Step 4: Use it in the admin item patch.** In `src/app/api/admin/jobs/[id]/route.ts`, import `withProofStamp` from `@/lib/job-types`, and replace the `updateJobItem(jobId, index, itemPatch, appendMessage)` call with:

```ts
    const stamped = withProofStamp(oldItems[index], itemPatch as Record<string, unknown>)
    const { data: updatedItems, error } = await updateJobItem(jobId, index, stamped, appendMessage)
```
(`oldItems` is already defined just above from `cur.items`.)

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/proof-stamp.test.ts && npx tsc --noEmit`
Expected: 5 passed; no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/job-types.ts src/app/api/admin/jobs/[id]/route.ts tests/proof-stamp.test.ts
git commit -m "feat(items): stamp proof_sent_at when the shop sends or changes proofs"
```

---

### Task 3: Toronto local time helpers

**Files:** Create `src/lib/local-time.ts`; Test `tests/local-time.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { torontoDate, torontoHour, addDays, daysBetween } from '@/lib/local-time'

describe('local-time', () => {
  it('uses Toronto wall-clock time (EST, UTC-5 in November)', () => {
    const d = new Date('2026-11-16T03:30:00.000Z') // 22:30 on Nov 15 in Toronto
    expect(torontoDate(d)).toBe('2026-11-15')
    expect(torontoHour(d)).toBe(22)
  })
  it('handles EDT (UTC-4) in summer', () => {
    expect(torontoHour(new Date('2026-07-01T13:00:00.000Z'))).toBe(9)
  })
  it('adds days and counts whole days between ISO dates', () => {
    expect(addDays('2026-11-28', 3)).toBe('2026-12-01')
    expect(daysBetween('2026-11-15', '2026-12-12')).toBe(27)
    expect(daysBetween('2026-11-15', '2026-11-14')).toBe(-1)
  })
})
```

- [ ] **Step 2: Run it to see it fail** — `npx vitest run tests/local-time.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `src/lib/local-time.ts`**

```ts
// The shop runs on Toronto time. Server clocks (Docker) are UTC, so every
// "today", "this morning" and quiet-hours check goes through these helpers.
const TZ = 'America/Toronto'

/** YYYY-MM-DD for the given instant in Toronto. */
export function torontoDate(now: Date = new Date()): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(now).map(x => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}`
}

/** 0–23 hour for the given instant in Toronto. */
export function torontoHour(now: Date = new Date()): number {
  const h = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' })
    .formatToParts(now).find(x => x.type === 'hour')!.value
  return Number(h) % 24
}

/** Add whole days to an ISO date (calendar math, no time zones involved). */
export function addDays(isoDate: string, n: number): string {
  const d = new Date(`${isoDate}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Whole days from `a` to `b` (both YYYY-MM-DD). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00.000Z`) - Date.parse(`${a}T00:00:00.000Z`)) / 86_400_000)
}

/** "Tue Nov 17" for an ISO date. */
export function shortDay(isoDate: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' })
    .format(new Date(`${isoDate}T00:00:00.000Z`)).replace(/,/g, '')
}
```

- [ ] **Step 4: Run it** — `npx vitest run tests/local-time.test.ts` → 3 passed.

- [ ] **Step 5: Commit** — `git add src/lib/local-time.ts tests/local-time.test.ts && git commit -m "feat: Toronto local-time helpers"`

---

### Task 4: Progress tracker logic + portal response

**Files:** Create `src/lib/progress.ts`; Modify `src/app/api/portal/me/route.ts`; Test `tests/progress.test.ts`

- [ ] **Step 1: Write the failing test — `tests/progress.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { deriveStages, finalStageLabel } from '@/lib/progress'
import type { JobItem } from '@/lib/job-types'

const it0: JobItem = { name: 'Floor', quantity: 1, size: '16x16', material: 'vinyl' }
const job = (over: Partial<Parameters<typeof deriveStages>[0]> = {}) => ({
  status: 'received', submitted_at: '2026-11-02T14:00:00.000+00:00', date_required: '2026-12-12',
  items: [it0], production: {}, job_type: 'event', fulfillment: null, ...over,
})
const states = (s: ReturnType<typeof deriveStages>) => s.map(x => `${x.key}:${x.state}`).join(' ')

describe('deriveStages', () => {
  it('new brief → designing is current', () => {
    expect(states(deriveStages(job()))).toBe('received:done designing:current proofs:next approved:next production:next done:next')
  })
  it('proofs sent → approval is current, with x of y', () => {
    const s = deriveStages(job({ items: [
      { ...it0, proof_urls: ['uploads/a.png'], proof_sent_at: '2026-11-12T10:00:00.000Z', approval_status: 'approved', approved_at: '2026-11-13T10:00:00.000Z' },
      { ...it0, proof_urls: ['uploads/b.png'], proof_sent_at: '2026-11-12T10:00:00.000Z' },
    ] }))
    expect(states(s)).toBe('received:done designing:done proofs:done approved:current production:next done:next')
    expect(s.find(x => x.key === 'approved')!.detail).toBe('1 of 2')
    expect(s.find(x => x.key === 'proofs')!.date).toBe('2026-11-12')
  })
  it('all approved → in production is current', () => {
    const s = deriveStages(job({ items: [{ ...it0, proof_urls: ['uploads/a.png'], approval_status: 'approved', approved_at: '2026-11-14T10:00:00.000Z' }] }))
    expect(states(s)).toBe('received:done designing:done proofs:done approved:done production:current done:next')
    expect(s.find(x => x.key === 'approved')!.date).toBe('2026-11-14')
  })
  it('production started (Command Centre) counts even before approvals are recorded', () => {
    expect(states(deriveStages(job({ production: { '2026-12-12': 'in_progress' } })))).toBe('received:done designing:done proofs:done approved:done production:current done:next')
  })
  it('completed → everything done', () => {
    expect(states(deriveStages(job({ status: 'completed' })))).toBe('received:done designing:done proofs:done approved:done production:done done:done')
  })
  it('names the last stage by job type and fulfillment', () => {
    expect(finalStageLabel('event', null)).toBe('Installed')
    expect(finalStageLabel('product', 'pickup')).toBe('Ready for pickup')
    expect(finalStageLabel('product', 'delivery')).toBe('Delivered')
    expect(finalStageLabel('product', 'install')).toBe('Installed')
    expect(finalStageLabel(null, null)).toBe('Installed')
  })
})
```

- [ ] **Step 2: Run it to see it fail** — `npx vitest run tests/progress.test.ts` → FAIL.

- [ ] **Step 3: Implement `src/lib/progress.ts`**

```ts
import { itemProofs } from '@/lib/job-types'
import type { JobItem } from '@/lib/job-types'

// The client's progress tracker, derived only from data the app already has.
// Later stages imply earlier ones (e.g. Command Centre marks production
// started while an approval was handled offline), so states are monotonic.

export type StageKey = 'received' | 'designing' | 'proofs' | 'approved' | 'production' | 'done'
export interface Stage { key: StageKey; label: string; state: 'done' | 'current' | 'next'; date: string | null; detail?: string }

export interface ProgressJob {
  status: string
  submitted_at: string
  date_required: string
  items: JobItem[]
  production?: Record<string, string> | null
  job_type?: string | null
  fulfillment?: string | null
}

export function finalStageLabel(jobType: string | null | undefined, fulfillment: string | null | undefined): string {
  if (jobType === 'product') {
    if (fulfillment === 'pickup') return 'Ready for pickup'
    if (fulfillment === 'delivery') return 'Delivered'
  }
  return 'Installed'
}

const day = (iso: string | undefined | null) => (iso ? iso.slice(0, 10) : null)

export function deriveStages(job: ProgressJob): Stage[] {
  const items = job.items ?? []
  const proofed = items.filter(it => itemProofs(it).length > 0)
  const approved = items.filter(it => it.approval_status === 'approved')
  const prod = Object.values(job.production ?? {})

  const doneFlags: Record<StageKey, boolean> = {
    received: true,
    designing: proofed.length > 0,
    proofs: proofed.length > 0,
    approved: items.length > 0 && approved.length === items.length,
    production: job.status === 'completed',
    done: job.status === 'completed',
  }
  const productionStarted = job.status === 'in_progress' || job.status === 'completed' || prod.some(v => v === 'in_progress' || v === 'done')

  const order: StageKey[] = ['received', 'designing', 'proofs', 'approved', 'production', 'done']
  // Production started ⇒ everything before it is done.
  let lastDone = -1
  order.forEach((k, i) => { if (doneFlags[k]) lastDone = i })
  if (productionStarted) lastDone = Math.max(lastDone, order.indexOf('approved'))

  const firstProof = proofed.map(it => it.proof_sent_at ?? it.proof_uploaded_at).filter(Boolean).sort()[0]
  const lastApproval = approved.map(it => it.approved_at).filter(Boolean).sort().at(-1)

  const meta: Record<StageKey, { label: string; date: string | null }> = {
    received: { label: 'Brief received', date: day(job.submitted_at) },
    designing: { label: 'Designing', date: day(firstProof) },
    proofs: { label: 'Proofs ready', date: day(firstProof) },
    approved: { label: 'Approved', date: day(lastApproval) },
    production: { label: 'In production', date: null },
    done: { label: finalStageLabel(job.job_type, job.fulfillment), date: job.date_required },
  }

  return order.map((k, i): Stage => {
    const state = i <= lastDone ? 'done' : i === lastDone + 1 ? 'current' : 'next'
    const s: Stage = { key: k, label: meta[k].label, state, date: meta[k].date }
    if (k === 'approved' && state === 'current' && items.length) s.detail = `${approved.length} of ${items.length}`
    return s
  })
}
```

- [ ] **Step 4: Run it** — `npx vitest run tests/progress.test.ts` → 6 passed.

- [ ] **Step 5: Return stages from `/api/portal/me`.** In `src/app/api/portal/me/route.ts`, import `deriveStages` from `@/lib/progress`. Change the `getJob` columns to:

```ts
['id', 'reference_number', 'event_name', 'date_required', 'notes', 'status', 'submitted_at', 'items', 'file_paths', 'contact_email', 'production', 'job_type', 'fulfillment']
```
and the response to:
```ts
  const { contact_email, production, ...rest } = job
  const stages = deriveStages({ ...rest, production } as Parameters<typeof deriveStages>[0])
  return NextResponse.json({ jobs: [{ ...rest, stages, items: publicItems((rest.items ?? []) as JobItem[]) }], email: contact_email })
```
Run `npx tsc --noEmit` → no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/progress.ts src/app/api/portal/me/route.ts tests/progress.test.ts
git commit -m "feat(portal): progress tracker stages"
```

---

### Task 5: Branded email layout, mailer, cron auth

**Files:** Create `src/lib/email-layout.ts`, `src/lib/mailer.ts`, `src/lib/cron-auth.ts`; Test `tests/email-layout.test.ts`

- [ ] **Step 1: Write the failing test — `tests/email-layout.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { renderEmail, esc, money } from '@/lib/email-layout'

describe('renderEmail', () => {
  it('renders heading, accent, paragraphs, CTA, reference and preheader', () => {
    const html = renderEmail({
      preheader: 'Two designs are waiting', heading: 'Two designs need your', accent: 'OK.',
      paragraphs: ['Your event is in <b>27 days</b>.'], cta: { label: 'Review now', url: 'https://jobs.ddfpixel.com/review/abc' },
      footnote: 'Reply to pause reminders.', reference: 'DDF-20261102-A41F7C',
    })
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true)
    expect(html).toContain('Two designs need your')
    expect(html).toContain('font-style:italic')
    expect(html).toContain('href="https://jobs.ddfpixel.com/review/abc"')
    expect(html).toContain('DDF-20261102-A41F7C')
    expect(html).toContain('Two designs are waiting')
    expect(html).toContain('<b>27 days</b>')
  })
  it('escapes plain-text fields', () => {
    const html = renderEmail({ preheader: '<x>', heading: '<script>alert(1)</script>', paragraphs: [] })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
    expect(esc(`"a" & 'b'`)).toBe('&quot;a&quot; &amp; &#39;b&#39;')
  })
  it('formats CAD money from cents', () => {
    expect(money(115000)).toBe('$1,150.00')
    expect(money(4999)).toBe('$49.99')
  })
})
```

- [ ] **Step 2: Run it to see it fail** — `npx vitest run tests/email-layout.test.ts` → FAIL (module missing).

- [ ] **Step 3: Create `src/lib/email-layout.ts`**

```ts
// One branded, table-based email layout. Inline styles only: email clients
// ignore <style>, and web fonts are not guaranteed, so fonts fall back to
// Helvetica/Georgia. Matches the "soft glass" look: stone background, white
// rounded card, black pill button.

const SANS = "Geist,'Helvetica Neue',Helvetica,Arial,sans-serif"
const SERIF = "'Instrument Serif',Georgia,'Times New Roman',serif"

export const esc = (s: unknown): string =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

/** "$1,150.00" from cents (CAD, shown with a plain $). */
export const money = (cents: number): string => {
  const neg = cents < 0 ? '-' : ''
  const abs = Math.abs(Math.round(cents))
  const dollars = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${neg}$${dollars}.${String(abs % 100).padStart(2, '0')}`
}

export interface EmailParts {
  preheader: string            // inbox preview line (plain text)
  heading: string              // plain text
  accent?: string              // plain text, set in serif italic after the heading
  paragraphs: string[]         // trusted HTML: build with esc()
  blocks?: string[]            // extra trusted <tr> rows, e.g. a schedule table
  cta?: { label: string; url: string }
  footnote?: string            // plain text
  reference?: string           // job reference shown top-right
  businessName?: string
}

export function renderEmail(p: EmailParts): string {
  const name = p.businessName ?? process.env.SENDER_NAME ?? 'DDF x Pixel'
  const row = (inner: string, pad = '12px 28px 0') =>
    `<tr><td style="padding:${pad};font:400 15px/1.6 ${SANS};color:#2c2a29">${inner}</td></tr>`
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(p.heading)}</title></head>
<body style="margin:0;padding:0;background:#ebe6e1">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;color:#ebe6e1">${esc(p.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ebe6e1;padding:28px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:24px;overflow:hidden">
<tr><td style="padding:22px 28px;border-bottom:1px solid #e6dfd8;font:500 15px ${SANS};color:#121212">${esc(name)}${p.reference ? `<span style="float:right;font:400 12px ${SANS};color:#756e68">${esc(p.reference)}</span>` : ''}</td></tr>
<tr><td style="padding:30px 28px 6px"><h1 style="margin:0;font:300 30px/1.12 ${SANS};letter-spacing:-0.6px;color:#121212">${esc(p.heading)}${p.accent ? ` <span style="font-family:${SERIF};font-style:italic;font-weight:400">${esc(p.accent)}</span>` : ''}</h1></td></tr>
${p.paragraphs.map(t => row(t)).join('\n')}
${(p.blocks ?? []).join('\n')}
${p.cta ? `<tr><td style="padding:24px 28px 0"><a href="${esc(p.cta.url)}" style="display:inline-block;background:#121212;color:#ffffff;text-decoration:none;font:500 14px ${SANS};padding:14px 24px;border-radius:999px">${esc(p.cta.label)}</a></td></tr>` : ''}
${p.footnote ? row(`<span style="font-size:13px;color:#756e68">${esc(p.footnote)}</span>`, '18px 28px 0') : ''}
<tr><td style="padding:28px 0 0"></td></tr>
<tr><td style="padding:18px 28px;background:#f3eff0;font:400 12px/1.5 ${SANS};color:#756e68">Pixel Production × Designer Dance Floors · Events, signage &amp; fabrication · GTA</td></tr>
</table>
</td></tr>
</table>
</body></html>`
}
```

- [ ] **Step 4: Create `src/lib/mailer.ts`**

```ts
import 'server-only'
import { BrevoClient } from '@getbrevo/brevo'

// Brevo send wrapper for the v2 emails. Never throws: email is best-effort
// and must not break the request or cron run that triggered it.
let client: BrevoClient | null = null
const brevo = () => (client ??= new BrevoClient({ apiKey: process.env.BREVO_API_KEY ?? '' }))

export interface Mail {
  to: { email: string; name?: string }[]
  subject: string
  html: string
  replyTo?: { email: string; name?: string }
}

export async function sendMail(m: Mail): Promise<boolean> {
  if (!process.env.BREVO_API_KEY || !process.env.SENDER_EMAIL) {
    console.warn('[mailer] Brevo not configured, email skipped:', m.subject)
    return false
  }
  try {
    await brevo().transactionalEmails.sendTransacEmail({
      to: m.to,
      sender: { email: process.env.SENDER_EMAIL, name: process.env.SENDER_NAME ?? 'DDF x Pixel' },
      subject: m.subject,
      htmlContent: m.html,
      ...(m.replyTo ? { replyTo: m.replyTo } : {}),
    })
    return true
  } catch (e) {
    console.error('[mailer] send failed:', m.subject, e)
    return false
  }
}
```

- [ ] **Step 5: Create `src/lib/cron-auth.ts`**

```ts
// Cron endpoints are called by the ops container with `Authorization: Bearer $CRON_SECRET`.
export function cronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET
  return !!secret && req.headers.get('authorization') === `Bearer ${secret}`
}
```

- [ ] **Step 6: Run** — `npx vitest run tests/email-layout.test.ts` → 3 passed.

- [ ] **Step 7: Commit**

```bash
git add src/lib/email-layout.ts src/lib/mailer.ts src/lib/cron-auth.ts tests/email-layout.test.ts
git commit -m "feat(email): branded v2 email layout, mailer, cron auth"
```

---

### Task 6: Print schedule + morning digest

**Files:** Create `src/lib/schedule.ts`, `src/lib/notify-v2.ts`, `src/app/api/admin/schedule/route.ts`, `src/app/api/cron/morning-digest/route.ts`; Test `tests/schedule.test.ts`, `tests/morning-digest.test.ts`

- [ ] **Step 1: Write the failing test — `tests/schedule.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { buildSchedule, digestText, digestPriority } from '@/lib/schedule'
import type { ScheduleJob } from '@/lib/schedule'
import type { JobItem } from '@/lib/job-types'

const ok: JobItem = { name: 'Sign', quantity: 1, size: '1', material: 'pvc', proof_urls: ['uploads/a.png'], approval_status: 'approved' }
const j = (over: Partial<ScheduleJob>): ScheduleJob => ({
  id: 1, reference_number: 'DDF-1', company_name: 'Co', client_name: 'C', event_name: null,
  date_required: '2026-11-17', status: 'received', job_type: 'event', fulfillment: null, items: [ok], deposit: null, ...over,
})
const TODAY = '2026-11-15'

describe('buildSchedule', () => {
  it('includes the next 7 days only, sorted, skipping closed jobs', () => {
    const s = buildSchedule([
      j({ id: 1, event_name: 'Gala', date_required: '2026-11-17' }),
      j({ id: 2, event_name: 'Later', date_required: '2026-11-21' }),
      j({ id: 3, event_name: 'Too far', date_required: '2026-11-30' }),
      j({ id: 4, event_name: 'Done', date_required: '2026-11-16', status: 'completed' }),
      j({ id: 5, event_name: 'Past', date_required: '2026-11-14' }),
    ], TODAY)
    expect(s.map(d => d.date)).toEqual(['2026-11-17', '2026-11-21'])
    expect(s[0].rows.map(r => r.title)).toEqual(['Gala'])
  })
  it('uses per-item date prefixes ("Nov 19 - …")', () => {
    const s = buildSchedule([j({ event_name: 'Sangeet', date_required: '2026-11-25', items: [{ ...ok, name: 'Nov 19 - Floor wrap' }] })], TODAY)
    expect(s.map(d => d.date)).toEqual(['2026-11-19'])
  })
  it('flags missing proofs, unapproved designs and deposits', () => {
    const s = buildSchedule([
      j({ event_name: 'A', items: [{ ...ok, quote_price: 500 }, { name: 'X', quantity: 1, size: '', material: 'pvc' }, { ...ok, approval_status: 'pending' }] }),
      j({ id: 2, event_name: 'B', items: [{ ...ok, quote_price: 100 }], deposit: { status: 'sent' } }),
      j({ id: 3, event_name: 'C', items: [{ ...ok, quote_price: 100 }], deposit: { status: 'paid' } }),
    ], TODAY)
    const rows = s[0].rows
    expect(rows.find(r => r.title === 'A')!.flags).toEqual(['1 without a proof', '1 not approved', 'Deposit not requested'])
    expect(rows.find(r => r.title === 'B')!.flags).toEqual(['Deposit unpaid'])
    expect(rows.find(r => r.title === 'C')!.flags).toEqual([])
    expect(rows.find(r => r.title === 'A')).toMatchObject({ pieces: 3, approved: 1, type: 'event' })
  })
  it('digestText lists days and flags, or says nothing is due', () => {
    const s = buildSchedule([j({ event_name: 'Gala', items: [{ ...ok, approval_status: 'pending' }] })], TODAY)
    expect(digestText(s)).toContain('Tue Nov 17')
    expect(digestText(s)).toContain('Gala')
    expect(digestText(s)).toContain('1 not approved')
    expect(digestText([])).toBe('Nothing due in the next 7 days.')
  })
  it('digestPriority is 4 when something flagged is due within 3 days', () => {
    const soon = buildSchedule([j({ items: [{ ...ok, approval_status: 'pending' }] })], TODAY)
    const later = buildSchedule([j({ date_required: '2026-11-21', items: [{ ...ok, approval_status: 'pending' }] })], TODAY)
    expect(digestPriority(soon, TODAY)).toBe(4)
    expect(digestPriority(later, TODAY)).toBe(3)
    expect(digestPriority([], TODAY)).toBe(2)
  })
})
```

- [ ] **Step 2: Run it to see it fail** — `npx vitest run tests/schedule.test.ts` → FAIL (module missing).

- [ ] **Step 3: Create `src/lib/schedule.ts`**

```ts
import { dayKeyForItem } from '@/lib/kanban-days'
import { itemProofs, jobQuoteTotal } from '@/lib/job-types'
import type { JobItem } from '@/lib/job-types'
import { addDays, shortDay } from '@/lib/local-time'

// The 7-day print schedule: every open job (event or product) with a piece due
// in [today, today+6], grouped by day, with what still needs attention.

export interface ScheduleJob {
  id: number
  reference_number: string
  company_name: string
  client_name: string
  event_name: string | null
  date_required: string
  status: string
  job_type?: string | null
  fulfillment?: string | null
  items: JobItem[]
  deposit?: { status?: string } | null
}
export interface ScheduleRow { id: number; ref: string; title: string; type: 'event' | 'product'; fulfillment: string | null; pieces: number; units: number; approved: number; flags: string[] }
export interface ScheduleDay { date: string; rows: ScheduleRow[] }

export function buildSchedule(jobs: ScheduleJob[], today: string, days = 7): ScheduleDay[] {
  const end = addDays(today, days - 1)
  const byDay = new Map<string, ScheduleRow[]>()
  for (const job of jobs) {
    if (job.status === 'completed' || job.status === 'cancelled') continue
    const items = job.items ?? []
    const groups = new Map<string, JobItem[]>()
    for (const it of items) {
      const d = dayKeyForItem(it, job.date_required)
      if (d === 'no-date' || d < today || d > end) continue
      groups.set(d, [...(groups.get(d) ?? []), it])
    }
    const quoted = jobQuoteTotal(items).total > 0
    for (const [date, its] of groups) {
      const noProof = its.filter(it => itemProofs(it).length === 0).length
      const unapproved = its.filter(it => itemProofs(it).length > 0 && it.approval_status !== 'approved').length
      const flags: string[] = []
      if (noProof) flags.push(`${noProof} without a proof`)
      if (unapproved) flags.push(`${unapproved} not approved`)
      if (quoted && (!job.deposit || job.deposit.status === 'cancelled')) flags.push('Deposit not requested')
      else if (job.deposit?.status === 'sent') flags.push('Deposit unpaid')
      byDay.set(date, [...(byDay.get(date) ?? []), {
        id: job.id, ref: job.reference_number, title: job.event_name || job.company_name,
        type: job.job_type === 'product' ? 'product' : 'event', fulfillment: job.fulfillment ?? null,
        pieces: its.length, units: its.reduce((s, it) => s + (Number(it.quantity) || 1), 0),
        approved: its.filter(it => it.approval_status === 'approved').length, flags,
      }])
    }
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, rows]) => ({ date, rows: rows.sort((a, b) => a.title.localeCompare(b.title)) }))
}

/** Plain-text body for the ntfy push. */
export function digestText(days: ScheduleDay[]): string {
  if (!days.length) return 'Nothing due in the next 7 days.'
  return days.map(d => [
    shortDay(d.date),
    ...d.rows.map(r => `  ${r.title} · ${r.approved}/${r.pieces} approved${r.flags.length ? ` · ⚠ ${r.flags.join(', ')}` : ''}`),
  ].join('\n')).join('\n')
}

/** Push priority: 4 if anything flagged is due within 3 days (today + 2), 3 otherwise, 2 when empty. */
export function digestPriority(days: ScheduleDay[], today: string): 2 | 3 | 4 {
  if (!days.length) return 2
  const soon = addDays(today, 2)
  return days.some(d => d.date <= soon && d.rows.some(r => r.flags.length)) ? 4 : 3
}
```

- [ ] **Step 4: Run it** — `npx vitest run tests/schedule.test.ts` → 5 passed.

- [ ] **Step 5: Create `src/lib/notify-v2.ts`** (all v2 email builders and senders; Tasks 7 and 9 add to this file)

```ts
import 'server-only'
import { renderEmail, esc } from '@/lib/email-layout'
import { sendMail } from '@/lib/mailer'
import { baseUrl } from '@/lib/file-tokens'
import { signReviewToken } from '@/lib/review-token'
import { shortDay, daysBetween, torontoDate } from '@/lib/local-time'
import type { ScheduleDay } from '@/lib/schedule'

export const reviewUrl = (jobId: number) => `${baseUrl()}/review/${signReviewToken(jobId)}`
const firstName = (full: string) => (full || '').trim().split(/\s+/)[0] || 'there'
const ownerReplyTo = () => (process.env.NOTIFICATION_EMAIL ? { email: process.env.NOTIFICATION_EMAIL } : undefined)

// ── Morning print schedule (internal) ─────────────────────────────────
export function buildDigestEmail(days: ScheduleDay[]): { subject: string; html: string } {
  const jobs = days.reduce((n, d) => n + d.rows.length, 0)
  const flagged = days.reduce((n, d) => n + d.rows.filter(r => r.flags.length).length, 0)
  const rows = days.flatMap(d => d.rows.map(r => `<tr><td style="padding:12px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-bottom:1px solid #e6dfd8"><tr>
<td width="92" valign="top" style="padding:0 0 12px;font:500 13px Helvetica,Arial,sans-serif;color:#121212">${esc(shortDay(d.date))}</td>
<td valign="top" style="padding:0 0 12px;font:400 13px/1.5 Helvetica,Arial,sans-serif;color:#2c2a29"><b style="font-weight:600">${esc(r.title)}</b> <span style="color:#756e68">· ${r.type === 'product' ? 'Product' : 'Event'} · ${r.approved}/${r.pieces} approved · ${r.units} units</span>${r.flags.length ? `<br><span style="color:#8b2252">⚠ ${esc(r.flags.join(' · '))}</span>` : ''}</td>
</tr></table></td></tr>`))
  return {
    subject: jobs
      ? `Print schedule: ${jobs} job${jobs === 1 ? '' : 's'} this week${flagged ? ` · ${flagged} need attention` : ''}`
      : 'Print schedule: nothing due this week',
    html: renderEmail({
      preheader: jobs ? `${jobs} due in the next 7 days` : 'Nothing due in the next 7 days',
      heading: 'Good', accent: 'morning.',
      paragraphs: [jobs ? `${jobs} job${jobs === 1 ? '' : 's'} due in the next 7 days.` : 'Nothing is due in the next 7 days.'],
      blocks: rows,
      cta: { label: 'Open admin', url: `${baseUrl()}/admin` },
    }),
  }
}

export async function sendMorningDigest(days: ScheduleDay[]): Promise<boolean> {
  const to = process.env.NOTIFICATION_EMAIL
  if (!to) return false
  const { subject, html } = buildDigestEmail(days)
  return sendMail({ to: [{ email: to }], subject, html })
}

// ── Approval reminder (client) ────────────────────────────────────────
export interface ReminderEmailJob {
  id: number; reference_number: string; client_name: string; contact_email: string
  event_name: string | null; company_name: string; date_required: string; job_type?: string | null
}

export function buildReminderEmail(job: ReminderEmailJob, waitingNames: string[], now = new Date()): { subject: string; html: string } {
  const n = waitingNames.length
  const days = daysBetween(torontoDate(now), job.date_required)
  const when = job.job_type === 'product'
    ? `Your order is needed by <b>${esc(shortDay(job.date_required))}</b>.`
    : `Your event is in <b>${days} day${days === 1 ? '' : 's'}</b>.`
  return {
    subject: `Reminder: ${n} design${n === 1 ? ' is' : 's are'} waiting for your approval`,
    html: renderEmail({
      preheader: `${n} design${n === 1 ? '' : 's'} waiting, about a minute to review`,
      heading: `${n === 1 ? 'One design needs' : `${n} designs need`} your`, accent: 'OK.',
      paragraphs: [
        `Hi ${esc(firstName(job.client_name))}, ${when} To keep things on schedule, please review: <b>${waitingNames.map(esc).join('</b>, <b>')}</b>.`,
      ],
      cta: { label: 'Review now', url: reviewUrl(job.id) },
      footnote: 'Already talked to us about these? Reply to this email and we’ll pause reminders.',
      reference: job.reference_number,
    }),
  }
}

export async function sendApprovalReminder(job: ReminderEmailJob, waitingNames: string[]): Promise<boolean> {
  const { subject, html } = buildReminderEmail(job, waitingNames)
  return sendMail({ to: [{ email: job.contact_email, name: job.client_name }], subject, html, replyTo: ownerReplyTo() })
}
```

- [ ] **Step 6: Create `src/app/api/admin/schedule/route.ts`** (live data for the admin "Print schedule" panel in Plan C)

```ts
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { listOpenJobs } from '@/lib/jobs-repo'
import { buildSchedule } from '@/lib/schedule'
import type { ScheduleJob } from '@/lib/schedule'
import { torontoDate } from '@/lib/local-time'

export const dynamic = 'force-dynamic'

export async function GET() {
  const auth = await requireAdmin()
  if ('unauthorized' in auth) return auth.unauthorized
  const { data, error } = await listOpenJobs(['id', 'reference_number', 'company_name', 'client_name', 'event_name', 'date_required', 'status', 'job_type', 'fulfillment', 'items', 'deposit'])
  if (error) return NextResponse.json({ error: 'Failed to load schedule' }, { status: 500 })
  const today = torontoDate()
  return NextResponse.json({ today, days: buildSchedule((data ?? []) as ScheduleJob[], today) })
}
```

- [ ] **Step 7: Write the failing route test — `tests/morning-digest.test.ts`**

```ts
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { hasDb, TEST_URL, applySchema, resetTables } from './helpers/db'

const sent: { subject: string }[] = []
const pushes: { priority?: number; message: string }[] = []
vi.mock('@/lib/mailer', () => ({ sendMail: vi.fn(async (m: { subject: string }) => { sent.push(m); return true }) }))
vi.mock('@/lib/ntfy', () => ({ sendNtfy: vi.fn(async (o: { priority?: number; message: string }) => { pushes.push(o) }) }))

describe.skipIf(!hasDb)('GET /api/cron/morning-digest', () => {
  let GET: typeof import('@/app/api/cron/morning-digest/route').GET
  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_URL
    process.env.CRON_SECRET = 'cron-test'
    process.env.NOTIFICATION_EMAIL = 'jobs@example.com'
    process.env.REVIEW_LINK_SECRET = 'r'.repeat(40)
    applySchema()
    GET = (await import('@/app/api/cron/morning-digest/route')).GET
  })
  beforeEach(async () => { await resetTables(); sent.length = 0; pushes.length = 0 })

  it('401 without the cron secret', async () => {
    expect((await GET(new Request('http://x/api/cron/morning-digest'))).status).toBe(401)
  })

  it('pushes and emails the schedule', async () => {
    const repo = await import('@/lib/jobs-repo')
    const tenantId = await (await import('@/lib/tenant')).getDefaultTenantId()
    const { torontoDate, addDays } = await import('@/lib/local-time')
    await repo.insertJob({
      tenant_id: tenantId, reference_number: 'DDF-DIGEST-1', client_name: 'A', company_name: 'Gala Co', contact_email: 'a@b.co',
      event_name: 'Winter Gala', date_required: addDays(torontoDate(), 1), notes: null, setup_location: null, setup_time: null,
      removal_location: null, removal_time: null, items: [{ name: 'Sign', quantity: 1, size: '1', material: 'pvc' }],
      file_paths: [], submission_id: randomUUID(), submitted_at: new Date().toISOString(), status: 'received',
    })
    const res = await GET(new Request('http://x/api/cron/morning-digest', { headers: { authorization: 'Bearer cron-test' } }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ jobs: 1 })
    expect(pushes[0].message).toContain('Winter Gala')
    expect(pushes[0].priority).toBe(4)
    expect(sent[0].subject).toContain('1 job this week')
  })
})
```

- [ ] **Step 8: Run it to see it fail** — `npx vitest run tests/morning-digest.test.ts` → FAIL (route missing).

- [ ] **Step 9: Create `src/app/api/cron/morning-digest/route.ts`**

```ts
import { NextResponse } from 'next/server'
import { cronAuthorized } from '@/lib/cron-auth'
import { listOpenJobs } from '@/lib/jobs-repo'
import { buildSchedule, digestText, digestPriority } from '@/lib/schedule'
import type { ScheduleJob } from '@/lib/schedule'
import { torontoDate } from '@/lib/local-time'
import { sendNtfy } from '@/lib/ntfy'
import { sendMorningDigest } from '@/lib/notify-v2'
import { baseUrl } from '@/lib/file-tokens'

export const dynamic = 'force-dynamic'

// Called by the ops loop once per Toronto day, at or after 07:00.
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data, error } = await listOpenJobs(['id', 'reference_number', 'company_name', 'client_name', 'event_name', 'date_required', 'status', 'job_type', 'fulfillment', 'items', 'deposit'])
  if (error) return NextResponse.json({ error: 'Failed to load jobs' }, { status: 500 })

  const today = torontoDate()
  const days = buildSchedule((data ?? []) as ScheduleJob[], today)
  const jobs = days.reduce((n, d) => n + d.rows.length, 0)

  await sendNtfy({
    title: jobs ? `Print schedule - ${jobs} due this week` : 'Print schedule - nothing due',
    message: digestText(days),
    priority: digestPriority(days, today),
    tags: 'calendar',
    clickUrl: `${baseUrl()}/admin`,
  })
  await sendMorningDigest(days)
  return NextResponse.json({ today, days: days.length, jobs })
}
```

- [ ] **Step 10: Run** — `npx vitest run tests/schedule.test.ts tests/morning-digest.test.ts` → all pass.

- [ ] **Step 11: Commit**

```bash
git add src/lib/schedule.ts src/lib/notify-v2.ts src/app/api/admin/schedule src/app/api/cron/morning-digest tests/schedule.test.ts tests/morning-digest.test.ts
git commit -m "feat: 7-day print schedule + morning digest (push + email)"
```

---

### Task 7: Approval reminders

**Files:** Create `src/lib/reminders.ts`, `src/app/api/cron/approval-reminders/route.ts`, `src/app/api/admin/jobs/[id]/reminders/route.ts`; Test `tests/reminders.test.ts`, `tests/approval-reminders.test.ts`

- [ ] **Step 1: Write the failing test — `tests/reminders.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { decideReminder, waitingItems } from '@/lib/reminders'
import type { JobItem } from '@/lib/job-types'

const NOW = new Date('2026-11-15T15:00:00.000Z') // 10:00 Toronto
const waiting = (sent: string): JobItem => ({ name: 'Floor', quantity: 1, size: '1', material: 'vinyl', proof_urls: ['uploads/a.png'], approval_status: 'pending', proof_sent_at: sent })
const job = (over: Partial<Parameters<typeof decideReminder>[0]> = {}) => ({
  status: 'received', date_required: '2026-12-12', updated_at: '2026-11-01T00:00:00.000Z',
  items: [waiting('2026-11-13T15:00:00.000Z')], reminders: {}, ...over,
})

describe('waitingItems', () => {
  it('only counts proofed, pending, shop-made designs', () => {
    expect(waitingItems([
      waiting('x'),
      { ...waiting('x'), approval_status: 'approved' },
      { ...waiting('x'), approval_status: 'changes_requested' },
      { ...waiting('x'), proof_source: 'client' },
      { name: 'No proof', quantity: 1, size: '', material: 'pvc' },
    ])).toHaveLength(1)
  })
})

describe('decideReminder', () => {
  it('first reminder after 2 days', () => {
    expect(decideReminder(job(), NOW)).toMatchObject({ sendClient: true, daysWaiting: 2 })
    expect(decideReminder(job({ items: [waiting('2026-11-14T15:00:00.000Z')] }), NOW).sendClient).toBe(false)
  })
  it('then every 3 days, max 3', () => {
    expect(decideReminder(job({ reminders: { count: 1, last_sent_at: '2026-11-13T15:00:00.000Z' } }), NOW).sendClient).toBe(false)
    expect(decideReminder(job({ reminders: { count: 1, last_sent_at: '2026-11-12T15:00:00.000Z' } }), NOW).sendClient).toBe(true)
    expect(decideReminder(job({ reminders: { count: 3, last_sent_at: '2026-11-01T00:00:00.000Z' } }), NOW).sendClient).toBe(false)
  })
  it('never when paused, closed, past the date, or nothing waiting', () => {
    expect(decideReminder(job({ reminders: { paused: true } }), NOW).sendClient).toBe(false)
    expect(decideReminder(job({ status: 'completed' }), NOW).sendClient).toBe(false)
    expect(decideReminder(job({ date_required: '2026-11-14' }), NOW).sendClient).toBe(false)
    expect(decideReminder(job({ items: [] }), NOW).sendClient).toBe(false)
  })
  it('alerts the owner once per day at 5+ days, even if paused', () => {
    const old = job({ items: [waiting('2026-11-10T15:00:00.000Z')], reminders: { paused: true } })
    expect(decideReminder(old, NOW).alertOwner).toBe(true)
    expect(decideReminder({ ...old, reminders: { paused: true, owner_alerted_on: '2026-11-15' } }, NOW).alertOwner).toBe(false)
  })
  it('falls back to updated_at when proof_sent_at is missing', () => {
    const it0 = { ...waiting('x') }
    delete it0.proof_sent_at
    expect(decideReminder(job({ items: [it0], updated_at: '2026-11-12T00:00:00.000Z' }), NOW).daysWaiting).toBe(3)
  })
})
```

- [ ] **Step 2: Run it to see it fail** — `npx vitest run tests/reminders.test.ts` → FAIL (module missing).

- [ ] **Step 3: Create `src/lib/reminders.ts`**

```ts
import { itemProofs } from '@/lib/job-types'
import type { JobItem } from '@/lib/job-types'
import { torontoDate } from '@/lib/local-time'

// Approval reminders (spec B1). Owner-confirmed defaults:
// first after 2 days, then every 3 days, max 3; owner alert at 5 days.
export const REMINDER_RULES = { firstAfterDays: 2, everyDays: 3, max: 3, ownerAlertDays: 5 } as const

export interface ReminderState { count?: number; last_sent_at?: string; paused?: boolean; owner_alerted_on?: string }
export interface ReminderJob { status: string; date_required: string; updated_at: string; items: JobItem[]; reminders?: ReminderState | null }
export interface ReminderDecision { sendClient: boolean; alertOwner: boolean; waiting: JobItem[]; daysWaiting: number }

const DAY = 86_400_000

/** Designs the client still has to look at: shop proofs that are pending. */
export function waitingItems(items: JobItem[]): JobItem[] {
  return (items ?? []).filter(it =>
    itemProofs(it).length > 0 && (it.approval_status ?? 'pending') === 'pending' && it.proof_source !== 'client')
}

export function decideReminder(job: ReminderJob, now: Date): ReminderDecision {
  const waiting = waitingItems(job.items)
  const today = torontoDate(now)
  if (!waiting.length || job.status === 'completed' || job.status === 'cancelled' || job.date_required < today) {
    return { sendClient: false, alertOwner: false, waiting, daysWaiting: 0 }
  }
  const st = job.reminders ?? {}
  const since = waiting.map(it => it.proof_sent_at ?? job.updated_at).sort()[0]
  const daysWaiting = Math.floor((now.getTime() - Date.parse(since)) / DAY)
  const count = st.count ?? 0
  const sinceLast = st.last_sent_at ? Math.floor((now.getTime() - Date.parse(st.last_sent_at)) / DAY) : Infinity
  const due = count === 0 ? daysWaiting >= REMINDER_RULES.firstAfterDays : sinceLast >= REMINDER_RULES.everyDays
  return {
    sendClient: !st.paused && count < REMINDER_RULES.max && due,
    alertOwner: daysWaiting >= REMINDER_RULES.ownerAlertDays && st.owner_alerted_on !== today,
    waiting,
    daysWaiting,
  }
}
```

- [ ] **Step 4: Run it** — `npx vitest run tests/reminders.test.ts` → 6 passed.

- [ ] **Step 5: Create `src/app/api/cron/approval-reminders/route.ts`**

```ts
import { NextResponse } from 'next/server'
import { cronAuthorized } from '@/lib/cron-auth'
import { listOpenJobs, updateJob } from '@/lib/jobs-repo'
import { decideReminder } from '@/lib/reminders'
import type { ReminderJob, ReminderState } from '@/lib/reminders'
import { sendApprovalReminder, reviewUrl } from '@/lib/notify-v2'
import type { ReminderEmailJob } from '@/lib/notify-v2'
import { sendNtfy } from '@/lib/ntfy'
import { torontoDate, torontoHour } from '@/lib/local-time'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const now = new Date()
  const hour = torontoHour(now)
  if (hour < 9 || hour >= 20) return NextResponse.json({ skipped: 'quiet hours', hour })

  const { data, error } = await listOpenJobs(['id', 'reference_number', 'client_name', 'contact_email', 'company_name', 'event_name', 'date_required', 'status', 'job_type', 'items', 'reminders', 'updated_at'])
  if (error) return NextResponse.json({ error: 'Failed to load jobs' }, { status: 500 })

  let sent = 0, alerted = 0
  for (const row of data ?? []) {
    const job = row as ReminderJob & ReminderEmailJob
    const d = decideReminder(job, now)
    if (!d.sendClient && !d.alertOwner) continue
    const next: ReminderState = { ...(job.reminders ?? {}) }
    if (d.sendClient && (await sendApprovalReminder(job, d.waiting.map(it => it.name)))) {
      next.count = (next.count ?? 0) + 1
      next.last_sent_at = now.toISOString()
      sent++
    }
    if (d.alertOwner) {
      await sendNtfy({
        title: 'Approval waiting 5+ days',
        message: `${job.event_name || job.company_name} (${job.reference_number}): ${d.waiting.length} design(s) waiting ${d.daysWaiting} days. Reminders sent: ${next.count ?? 0}.`,
        priority: 4, tags: 'hourglass', clickUrl: reviewUrl(job.id),
      })
      next.owner_alerted_on = torontoDate(now)
      alerted++
    }
    await updateJob(job.id, { reminders: next })
  }
  return NextResponse.json({ checked: (data ?? []).length, sent, alerted })
}
```

- [ ] **Step 6: Create `src/app/api/admin/jobs/[id]/reminders/route.ts`** (job drawer: **Send reminder now** and **Pause reminders**)

```ts
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { getJob, updateJob } from '@/lib/jobs-repo'
import { waitingItems } from '@/lib/reminders'
import type { ReminderState } from '@/lib/reminders'
import { sendApprovalReminder } from '@/lib/notify-v2'
import type { ReminderEmailJob } from '@/lib/notify-v2'
import type { JobItem } from '@/lib/job-types'

export const dynamic = 'force-dynamic'

async function load(idParam: string, tenantId: string) {
  const jobId = parseInt(idParam, 10)
  if (isNaN(jobId)) return null
  const { data } = await getJob(jobId, ['id', 'reference_number', 'client_name', 'contact_email', 'company_name', 'event_name', 'date_required', 'job_type', 'items', 'reminders'], tenantId)
  return data
}

// Send a reminder now (counts toward the max of 3).
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin()
  if ('unauthorized' in auth) return auth.unauthorized
  const job = await load((await params).id, auth.tenantId)
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  const waiting = waitingItems((job.items ?? []) as JobItem[])
  if (!waiting.length) return NextResponse.json({ error: 'No designs are waiting for approval' }, { status: 409 })
  if (!(await sendApprovalReminder(job as ReminderEmailJob, waiting.map(it => it.name)))) {
    return NextResponse.json({ error: 'Email could not be sent' }, { status: 502 })
  }
  const st = (job.reminders ?? {}) as ReminderState
  const reminders: ReminderState = { ...st, count: (st.count ?? 0) + 1, last_sent_at: new Date().toISOString() }
  await updateJob(job.id, { reminders }, auth.tenantId)
  return NextResponse.json({ reminders })
}

// Pause / resume automatic reminders: body { paused: boolean }
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin()
  if ('unauthorized' in auth) return auth.unauthorized
  const body = await req.json().catch(() => ({}))
  if (typeof body.paused !== 'boolean') return NextResponse.json({ error: 'paused must be true or false' }, { status: 400 })
  const job = await load((await params).id, auth.tenantId)
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  const reminders: ReminderState = { ...((job.reminders ?? {}) as ReminderState), paused: body.paused }
  await updateJob(job.id, { reminders }, auth.tenantId)
  return NextResponse.json({ reminders })
}
```

- [ ] **Step 7: Write the route test — `tests/approval-reminders.test.ts`**

```ts
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { hasDb, TEST_URL, applySchema, resetTables } from './helpers/db'

const sent: { to: { email: string }[]; subject: string }[] = []
vi.mock('@/lib/mailer', () => ({ sendMail: vi.fn(async (m: { to: { email: string }[]; subject: string }) => { sent.push(m); return true }) }))
vi.mock('@/lib/ntfy', () => ({ sendNtfy: vi.fn(async () => {}) }))

describe.skipIf(!hasDb)('GET /api/cron/approval-reminders', () => {
  let GET: typeof import('@/app/api/cron/approval-reminders/route').GET
  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_URL
    process.env.CRON_SECRET = 'cron-test'
    process.env.REVIEW_LINK_SECRET = 'r'.repeat(40)
    applySchema()
    GET = (await import('@/app/api/cron/approval-reminders/route')).GET
  })
  beforeEach(async () => { await resetTables(); sent.length = 0 })
  afterEach(() => { vi.useRealTimers() })

  const call = () => GET(new Request('http://x/api/cron/approval-reminders', { headers: { authorization: 'Bearer cron-test' } }))

  it('emails a client whose design has waited 2+ days, once, and records it', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-15T15:00:00.000Z'), toFake: ['Date'] })
    const repo = await import('@/lib/jobs-repo')
    const tenantId = await (await import('@/lib/tenant')).getDefaultTenantId()
    const { data } = await repo.insertJob({
      tenant_id: tenantId, reference_number: 'DDF-REM-1', client_name: 'Aanya Mehta', company_name: 'Co', contact_email: 'aanya@example.com',
      event_name: 'Wedding', date_required: '2026-12-12', notes: null, setup_location: null, setup_time: null, removal_location: null, removal_time: null,
      items: [{ name: 'Floor wrap', quantity: 1, size: '16x16', material: 'vinyl', proof_urls: ['uploads/a.png'], approval_status: 'pending', proof_sent_at: '2026-11-12T15:00:00.000Z' }],
      file_paths: [], submission_id: randomUUID(), submitted_at: '2026-11-02T00:00:00.000Z', status: 'received',
    })
    expect(await (await call()).json()).toMatchObject({ sent: 1 })
    expect(sent[0].to[0].email).toBe('aanya@example.com')
    expect(sent[0].subject).toContain('1 design is waiting')
    expect((await repo.getJob(data!.id, ['reminders'])).data!.reminders).toMatchObject({ count: 1 })
    expect(await (await call()).json()).toMatchObject({ sent: 0 })
  })

  it('stays quiet at night', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-16T05:00:00.000Z'), toFake: ['Date'] }) // 00:00 Toronto
    expect(await (await call()).json()).toMatchObject({ skipped: 'quiet hours' })
  })
})
```

- [ ] **Step 8: Run** — `npx vitest run tests/reminders.test.ts tests/approval-reminders.test.ts` → all pass.

- [ ] **Step 9: Commit**

```bash
git add src/lib/reminders.ts src/app/api/cron/approval-reminders "src/app/api/admin/jobs/[id]/reminders" tests/reminders.test.ts tests/approval-reminders.test.ts
git commit -m "feat: approval reminders (auto, send now, pause) with owner alert"
```

---

### Task 8: Deposit model, Square client, repo helpers

Square facts this task relies on (checked against Square's docs, Nov 2026):
- `POST /v2/online-checkout/payment-links` with `quick_pay { name, price_money, location_id }` returns `payment_link { id, url, order_id }`.
- A quick-pay order is `DRAFT` until the buyer pays, then `OPEN` with a `tenders[]` entry; `Tender.id` is the Payment id. **"Paid" = the order has a tender**, not `state = COMPLETED`.
- Webhooks carry `x-square-hmacsha256-signature` = base64 HMAC-SHA256 of (notification URL + raw body), keyed with the subscription's signature key. The URL must match the subscription byte-for-byte.

**Files:** Create `src/lib/deposits.ts`, `src/lib/square.ts`; Modify `src/lib/jobs-repo.ts`; Test `tests/deposits.test.ts`, `tests/square.test.ts`, `tests/jobs-repo-deposit.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/deposits.test.ts`:
```ts
import { describe, it, expect, afterEach } from 'vitest'
import { defaultDepositCents, depositPercent, publicDeposit, canRequestDeposit } from '@/lib/deposits'
import type { Deposit } from '@/lib/deposits'
import type { JobItem } from '@/lib/job-types'

const item = (quote_price?: number): JobItem => ({ name: 'X', quantity: 1, size: '', material: 'pvc', quote_price })
const sent: Deposit = { amount_cents: 115000, status: 'sent', link_id: 'L1', url: 'https://square.link/u/abc', order_id: 'O1', attempt: 1, sent_at: '2026-11-15T15:00:00.000Z' }

describe('deposits', () => {
  afterEach(() => { delete process.env.DEPOSIT_PERCENT })
  it('defaults to 50% of the quoted total, in cents, rounded to the cent', () => {
    expect(defaultDepositCents([item(1500), item(800), item()])).toBe(115000)
    expect(defaultDepositCents([item(99.99)])).toBe(5000)
    expect(defaultDepositCents([item()])).toBe(0)
  })
  it('reads DEPOSIT_PERCENT and ignores bad values', () => {
    process.env.DEPOSIT_PERCENT = '30'
    expect(depositPercent()).toBe(30)
    expect(defaultDepositCents([item(1000)])).toBe(30000)
    process.env.DEPOSIT_PERCENT = 'abc'
    expect(depositPercent()).toBe(50)
  })
  it('publicDeposit hides ids, shows the link only while unpaid, hides cancelled', () => {
    expect(publicDeposit(sent)).toEqual({ status: 'sent', amount_cents: 115000, url: 'https://square.link/u/abc', paid_at: null })
    expect(publicDeposit({ ...sent, status: 'paid', paid_at: '2026-11-16T00:00:00.000Z' })).toEqual({ status: 'paid', amount_cents: 115000, url: null, paid_at: '2026-11-16T00:00:00.000Z' })
    expect(publicDeposit({ ...sent, status: 'cancelled' })).toBeNull()
    expect(publicDeposit(null)).toBeNull()
  })
  it('a new deposit can be requested only when none is open or paid', () => {
    expect(canRequestDeposit(null)).toBe(true)
    expect(canRequestDeposit({ ...sent, status: 'cancelled' })).toBe(true)
    expect(canRequestDeposit(sent)).toBe(false)
    expect(canRequestDeposit({ ...sent, status: 'paid' })).toBe(false)
  })
})
```

`tests/square.test.ts`:
```ts
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { verifySquareSignature, createDepositLink, orderPaid, deletePaymentLink } from '@/lib/square'

const URL = 'https://jobs.ddfpixel.com/api/square/webhook'
const BODY = '{"type":"payment.updated","data":{"object":{"payment":{"id":"PAY1","order_id":"ORD1","status":"COMPLETED"}}}}'
const SIG = 'ZuwDkSLgytMdkyQoB79O3gvJeOJv6czu6kxcjqjOLpU=' // python: base64(hmac_sha256('test-signature-key', URL + BODY))

describe('verifySquareSignature', () => {
  it('accepts the known vector and rejects tampering', () => {
    expect(verifySquareSignature(BODY, SIG, URL, 'test-signature-key')).toBe(true)
    expect(verifySquareSignature(BODY + ' ', SIG, URL, 'test-signature-key')).toBe(false)
    expect(verifySquareSignature(BODY, SIG, URL + '/', 'test-signature-key')).toBe(false)
    expect(verifySquareSignature(BODY, null, URL, 'test-signature-key')).toBe(false)
    expect(verifySquareSignature(BODY, SIG, URL, '')).toBe(false)
  })
})

describe('Square API calls', () => {
  const calls: { url: string; init: RequestInit }[] = []
  beforeEach(() => {
    process.env.SQUARE_ACCESS_TOKEN = 'tok'
    process.env.SQUARE_LOCATION_ID = 'LOC1'
    process.env.SQUARE_ENV = 'sandbox'
    calls.length = 0
  })
  afterEach(() => { vi.unstubAllGlobals() })
  const stub = (status: number, body: unknown) => vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  }))

  it('creates a CAD quick-pay link on the sandbox host', async () => {
    stub(200, { payment_link: { id: 'PL1', url: 'https://sandbox.square.link/u/x', order_id: 'ORD1' } })
    const link = await createDepositLink({ name: 'Deposit — Gala (DDF-1)', amountCents: 115000, idempotencyKey: 'deposit-1-1', buyerEmail: 'a@b.co' })
    expect(link).toEqual({ id: 'PL1', url: 'https://sandbox.square.link/u/x', order_id: 'ORD1' })
    expect(calls[0].url).toBe('https://connect.squareupsandbox.com/v2/online-checkout/payment-links')
    const sentBody = JSON.parse(String(calls[0].init.body))
    expect(sentBody).toMatchObject({ idempotency_key: 'deposit-1-1', quick_pay: { price_money: { amount: 115000, currency: 'CAD' }, location_id: 'LOC1' }, pre_populated_data: { buyer_email: 'a@b.co' } })
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer tok')
  })

  it('throws with Square’s error detail', async () => {
    stub(400, { errors: [{ detail: 'Invalid location' }] })
    await expect(createDepositLink({ name: 'x', amountCents: 100, idempotencyKey: 'k' })).rejects.toThrow('Invalid location')
  })

  it('orderPaid: draft order is unpaid, order with a tender is paid', async () => {
    stub(200, { order: { state: 'DRAFT', tenders: [] } })
    expect(await orderPaid('ORD1')).toEqual({ paid: false, paymentId: null, paidAt: null })
    stub(200, { order: { state: 'OPEN', updated_at: '2026-11-16T12:00:00Z', tenders: [{ id: 'PAY1' }] } })
    expect(await orderPaid('ORD1')).toEqual({ paid: true, paymentId: 'PAY1', paidAt: '2026-11-16T12:00:00Z' })
  })

  it('deletePaymentLink treats 404 as already gone', async () => {
    stub(404, { errors: [{ detail: 'not found' }] })
    await expect(deletePaymentLink('PL1')).resolves.toBeUndefined()
  })
})
```

`tests/jobs-repo-deposit.test.ts`:
```ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { hasDb, TEST_URL, applySchema, resetTables } from './helpers/db'

describe.skipIf(!hasDb)('jobs-repo deposit helpers', () => {
  let repo: typeof import('@/lib/jobs-repo')
  let tenantId: string
  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_URL
    applySchema()
    repo = await import('@/lib/jobs-repo')
    tenantId = await (await import('@/lib/tenant')).getDefaultTenantId()
  })
  beforeEach(async () => { await resetTables() })

  const newJob = async () => (await repo.insertJob({
    tenant_id: tenantId, reference_number: `DDF-D-${randomUUID().slice(0, 6)}`, client_name: 'A', company_name: 'B', contact_email: 'a@b.co',
    event_name: null, date_required: '2030-01-02', notes: null, setup_location: null, setup_time: null, removal_location: null, removal_time: null,
    items: [], file_paths: [], submission_id: randomUUID(), submitted_at: new Date().toISOString(), status: 'received',
  })).data!.id

  it('markDepositPaid flips a sent deposit once and only once', async () => {
    const id = await newJob()
    await repo.updateJob(id, { deposit: { status: 'sent', order_id: 'ORD9', amount_cents: 1000 } })
    expect((await repo.markDepositPaid('ORD9', '2030-01-01T00:00:00.000Z', 'PAY9')).data).toEqual({ id })
    expect((await repo.markDepositPaid('ORD9', '2030-01-01T00:00:00.000Z', 'PAY9')).data).toBeNull()
    expect((await repo.getJob(id, ['deposit'])).data!.deposit).toMatchObject({ status: 'paid', paid_at: '2030-01-01T00:00:00.000Z', payment_id: 'PAY9', amount_cents: 1000 })
  })

  it('ignores unknown and cancelled orders', async () => {
    const id = await newJob()
    await repo.updateJob(id, { deposit: { status: 'cancelled', order_id: 'ORDC' } })
    expect((await repo.markDepositPaid('ORDC', 'x', null)).data).toBeNull()
    expect((await repo.markDepositPaid('NOPE', 'x', null)).data).toBeNull()
  })

  it('listSentDeposits returns only unpaid open links', async () => {
    const a = await newJob(); const b = await newJob()
    await repo.updateJob(a, { deposit: { status: 'sent', order_id: 'OA' } })
    await repo.updateJob(b, { deposit: { status: 'paid', order_id: 'OB' } })
    expect((await repo.listSentDeposits()).data!.map(r => r.id)).toEqual([a])
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/deposits.test.ts tests/square.test.ts tests/jobs-repo-deposit.test.ts`
Expected: FAIL (modules / functions missing).

- [ ] **Step 3: Create `src/lib/deposits.ts`**

```ts
import { jobQuoteTotal } from '@/lib/job-types'
import type { JobItem } from '@/lib/job-types'

// Deposit at approval (spec B3). Stored on jobs.deposit (jsonb, nullable).
export type DepositStatus = 'sent' | 'paid' | 'cancelled'
export interface Deposit {
  amount_cents: number
  status: DepositStatus
  link_id: string
  url: string
  order_id: string
  attempt: number            // 1, 2, … — part of the Square idempotency key
  sent_at: string
  paid_at?: string
  payment_id?: string | null
  cancelled_at?: string
}
/** What a client may see: no Square ids. */
export interface PublicDeposit { status: DepositStatus; amount_cents: number; url: string | null; paid_at: string | null }

export function depositPercent(): number {
  const n = Number(process.env.DEPOSIT_PERCENT ?? 50)
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : 50
}

/** Default deposit: DEPOSIT_PERCENT of the quoted total, in cents, rounded to the cent. */
export function defaultDepositCents(items: JobItem[], percent = depositPercent()): number {
  const totalCents = Math.round(jobQuoteTotal(items).total * 100)
  return Math.round((totalCents * percent) / 100)
}

export function publicDeposit(d: Deposit | null | undefined): PublicDeposit | null {
  if (!d || d.status === 'cancelled') return null
  return { status: d.status, amount_cents: d.amount_cents, url: d.status === 'sent' ? d.url : null, paid_at: d.paid_at ?? null }
}

export function canRequestDeposit(d: Deposit | null | undefined): boolean {
  return !d || d.status === 'cancelled'
}
```

- [ ] **Step 4: Create `src/lib/square.ts`**

```ts
import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'

// Raw-fetch Square client (no SDK). Sandbox when SQUARE_ENV=sandbox.
const SQUARE_VERSION = '2025-10-16'
const apiBase = () => (process.env.SQUARE_ENV === 'sandbox' ? 'https://connect.squareupsandbox.com' : 'https://connect.squareup.com')

export class SquareError extends Error {
  constructor(message: string, public status: number) { super(message) }
}

export function squareConfigured(): boolean {
  return !!(process.env.SQUARE_ACCESS_TOKEN && process.env.SQUARE_LOCATION_ID)
}

async function square<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
      'Square-Version': SQUARE_VERSION,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const detail = (data as { errors?: { detail?: string }[] })?.errors?.[0]?.detail ?? res.statusText
    throw new SquareError(`Square ${method} ${path} failed: ${detail}`, res.status)
  }
  return data as T
}

export interface PaymentLink { id: string; url: string; order_id: string }

export async function createDepositLink(o: {
  name: string; amountCents: number; idempotencyKey: string; buyerEmail?: string; note?: string; redirectUrl?: string
}): Promise<PaymentLink> {
  const data = await square<{ payment_link: PaymentLink }>('POST', '/v2/online-checkout/payment-links', {
    idempotency_key: o.idempotencyKey,
    quick_pay: { name: o.name.slice(0, 255), price_money: { amount: o.amountCents, currency: 'CAD' }, location_id: process.env.SQUARE_LOCATION_ID },
    checkout_options: { allow_tipping: false, ask_for_shipping_address: false, ...(o.redirectUrl ? { redirect_url: o.redirectUrl } : {}) },
    ...(o.buyerEmail ? { pre_populated_data: { buyer_email: o.buyerEmail } } : {}),
    ...(o.note ? { payment_note: o.note.slice(0, 500) } : {}),
  })
  const { id, url, order_id } = data.payment_link
  return { id, url, order_id }
}

export async function deletePaymentLink(id: string): Promise<void> {
  try {
    await square('DELETE', `/v2/online-checkout/payment-links/${encodeURIComponent(id)}`)
  } catch (e) {
    if (e instanceof SquareError && e.status === 404) return
    throw e
  }
}

export interface OrderPaid { paid: boolean; paymentId: string | null; paidAt: string | null }

/** A quick-pay order is DRAFT until paid, then gets a tender (Tender.id = Payment id). */
export async function orderPaid(orderId: string): Promise<OrderPaid> {
  const { order } = await square<{ order: { state?: string; updated_at?: string; tenders?: { id?: string; payment_id?: string }[] } }>(
    'GET', `/v2/orders/${encodeURIComponent(orderId)}`)
  const tender = order.tenders?.[0]
  const paid = !!tender && order.state !== 'CANCELED'
  return { paid, paymentId: paid ? (tender?.payment_id ?? tender?.id ?? null) : null, paidAt: paid ? (order.updated_at ?? new Date().toISOString()) : null }
}

/** x-square-hmacsha256-signature = base64(HMAC-SHA256(key, notificationUrl + rawBody)). */
export function verifySquareSignature(rawBody: string, signature: string | null, notificationUrl: string, key: string): boolean {
  if (!signature || !key) return false
  const expected = Buffer.from(createHmac('sha256', key).update(notificationUrl + rawBody).digest('base64'))
  const got = Buffer.from(signature)
  return expected.length === got.length && timingSafeEqual(expected, got)
}
```

- [ ] **Step 5: Add to `src/lib/jobs-repo.ts`**

```ts
/**
 * Atomically flip a SENT deposit to paid. Returns { id } when this call made the
 * change, null when the order is unknown or the deposit is already paid/cancelled,
 * so a webhook and the daily reconcile can't both announce the same payment.
 */
export function markDepositPaid(orderId: string, paidAt: string, paymentId: string | null): Promise<Result<{ id: number } | null>> {
  return attempt('markDepositPaid', async () => {
    const rows = await db()`
      update jobs
         set deposit = deposit || ${json({ status: 'paid', paid_at: paidAt, payment_id: paymentId })}
       where deposit->>'order_id' = ${orderId} and deposit->>'status' = 'sent'
   returning id`
    return (rows[0] as { id: number } | undefined) ?? null
  })
}

/** Jobs with an unpaid deposit link (for the daily reconcile). Includes completed jobs. */
export function listSentDeposits(): Promise<Result<Row[]>> {
  return attempt('listSentDeposits', async () => {
    const rows = await db()`select id, deposit from jobs where deposit->>'status' = 'sent' order by id`
    return rows as unknown as Row[]
  })
}
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/deposits.test.ts tests/square.test.ts tests/jobs-repo-deposit.test.ts`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/deposits.ts src/lib/square.ts src/lib/jobs-repo.ts tests/deposits.test.ts tests/square.test.ts tests/jobs-repo-deposit.test.ts
git commit -m "feat(deposit): deposit model, Square client, atomic paid flip"
```

---

### Task 9: Request / cancel a deposit (admin) + deposit email

**Files:** Modify `src/lib/notify-v2.ts`; Create `src/app/api/admin/jobs/[id]/deposit/route.ts`; Test `tests/deposit-route.test.ts`

- [ ] **Step 1: Write the failing test — `tests/deposit-route.test.ts`**

```ts
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { hasDb, TEST_URL, applySchema, resetTables } from './helpers/db'

const sent: { to: { email: string }[]; subject: string; html: string }[] = []
const created: { amountCents: number; idempotencyKey: string }[] = []
const deleted: string[] = []
vi.mock('@/lib/mailer', () => ({ sendMail: vi.fn(async (m: { to: { email: string }[]; subject: string; html: string }) => { sent.push(m); return true }) }))
vi.mock('@/lib/square', () => ({
  squareConfigured: () => true,
  createDepositLink: vi.fn(async (o: { amountCents: number; idempotencyKey: string }) => {
    created.push(o)
    return { id: `PL${created.length}`, url: `https://square.link/u/${created.length}`, order_id: `ORD${created.length}` }
  }),
  deletePaymentLink: vi.fn(async (id: string) => { deleted.push(id) }),
}))

let tenantId = ''
vi.mock('@/lib/admin-auth', () => ({ requireAdmin: async () => ({ user: { id: 'u', email: 'a@b.co' }, tenantId }) }))

describe.skipIf(!hasDb)('/api/admin/jobs/[id]/deposit', () => {
  let route: typeof import('@/app/api/admin/jobs/[id]/deposit/route')
  let repo: typeof import('@/lib/jobs-repo')
  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_URL
    process.env.REVIEW_LINK_SECRET = 'r'.repeat(40)
    applySchema()
    repo = await import('@/lib/jobs-repo')
    tenantId = await (await import('@/lib/tenant')).getDefaultTenantId()
    route = await import('@/app/api/admin/jobs/[id]/deposit/route')
  })
  beforeEach(async () => { await resetTables(); sent.length = 0; created.length = 0; deleted.length = 0 })

  const newJob = async (quote?: number) => (await repo.insertJob({
    tenant_id: tenantId, reference_number: 'DDF-DEP-1', client_name: 'Aanya Mehta', company_name: 'Co', contact_email: 'aanya@example.com',
    event_name: 'Wedding', date_required: '2030-12-12', notes: null, setup_location: null, setup_time: null, removal_location: null, removal_time: null,
    items: [{ name: 'Floor', quantity: 1, size: '16x16', material: 'vinyl', ...(quote ? { quote_price: quote } : {}) }],
    file_paths: [], submission_id: randomUUID(), submitted_at: new Date().toISOString(), status: 'received',
  })).data!.id
  const req = (method: string, body?: unknown) => new NextRequest('http://x/api/admin/jobs/1/deposit', { method, body: body ? JSON.stringify(body) : undefined })
  const ctx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) })

  it('POST creates a 50% link, saves it, emails the client', async () => {
    const id = await newJob(2300)
    const res = await route.POST(req('POST', {}), ctx(id))
    expect(res.status).toBe(200)
    expect(created[0]).toMatchObject({ amountCents: 115000, idempotencyKey: `deposit-${id}-1` })
    expect((await repo.getJob(id, ['deposit'])).data!.deposit).toMatchObject({ status: 'sent', amount_cents: 115000, order_id: 'ORD1', attempt: 1 })
    expect(sent[0].to[0].email).toBe('aanya@example.com')
    expect(sent[0].html).toContain('https://square.link/u/1')
  })

  it('POST honours an edited amount, and refuses a second open deposit', async () => {
    const id = await newJob(2300)
    await route.POST(req('POST', { amount_cents: 50000 }), ctx(id))
    expect(created[0].amountCents).toBe(50000)
    expect((await route.POST(req('POST', {}), ctx(id))).status).toBe(409)
  })

  it('POST refuses when nothing is quoted', async () => {
    const id = await newJob()
    expect((await route.POST(req('POST', {}), ctx(id))).status).toBe(409)
  })

  it('DELETE cancels the link; a new request uses the next attempt number', async () => {
    const id = await newJob(2300)
    await route.POST(req('POST', {}), ctx(id))
    expect((await route.DELETE(req('DELETE'), ctx(id))).status).toBe(200)
    expect(deleted).toEqual(['PL1'])
    expect((await repo.getJob(id, ['deposit'])).data!.deposit).toMatchObject({ status: 'cancelled' })
    await route.POST(req('POST', {}), ctx(id))
    expect(created[1].idempotencyKey).toBe(`deposit-${id}-2`)
  })
})
```

- [ ] **Step 2: Run it to see it fail** — `npx vitest run tests/deposit-route.test.ts` → FAIL (route missing).

- [ ] **Step 3: Append the deposit emails to `src/lib/notify-v2.ts`**

Add `money` to the existing `email-layout` import (`import { renderEmail, esc, money } from '@/lib/email-layout'`), then append:

```ts
// ── Deposit request (client) ──────────────────────────────────────────
export interface DepositEmailJob { reference_number: string; client_name: string; contact_email: string; event_name: string | null; company_name: string }

export function buildDepositEmail(job: DepositEmailJob, amountCents: number, url: string): { subject: string; html: string } {
  const title = job.event_name || job.company_name
  return {
    subject: `Deposit for ${title}: ${money(amountCents)}`,
    html: renderEmail({
      preheader: `Pay your ${money(amountCents)} deposit to lock in production`,
      heading: 'Your designs are', accent: 'approved.',
      paragraphs: [
        `Hi ${esc(firstName(job.client_name))}, thanks for approving everything for <b>${esc(title)}</b>.`,
        `To book production, please pay the deposit of <b>${money(amountCents)}</b>. Card, Apple Pay and Google Pay are accepted on Square’s secure page.`,
      ],
      cta: { label: `Pay ${money(amountCents)} deposit`, url },
      footnote: 'Questions about the amount? Just reply to this email.',
      reference: job.reference_number,
    }),
  }
}

export async function sendDepositRequest(job: DepositEmailJob, amountCents: number, url: string): Promise<boolean> {
  const { subject, html } = buildDepositEmail(job, amountCents, url)
  return sendMail({ to: [{ email: job.contact_email, name: job.client_name }], subject, html, replyTo: ownerReplyTo() })
}

// ── Deposit paid (internal) ───────────────────────────────────────────
export async function sendDepositPaidNotice(job: DepositEmailJob & { id: number }, amountCents: number): Promise<boolean> {
  const to = process.env.NOTIFICATION_EMAIL
  if (!to) return false
  const title = job.event_name || job.company_name
  return sendMail({
    to: [{ email: to }],
    subject: `Deposit paid: ${title} (${money(amountCents)})`,
    html: renderEmail({
      preheader: `${job.client_name} paid ${money(amountCents)}`,
      heading: 'Deposit', accent: 'paid.',
      paragraphs: [
        `<b>${esc(job.client_name)}</b> paid the <b>${money(amountCents)}</b> deposit for <b>${esc(title)}</b>.`,
        'Record it on the Command Centre invoice so the client isn’t billed twice.',
      ],
      cta: { label: 'Open admin', url: `${baseUrl()}/admin` },
      reference: job.reference_number,
    }),
  })
}
```

- [ ] **Step 4: Create `src/app/api/admin/jobs/[id]/deposit/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { getJob, updateJob } from '@/lib/jobs-repo'
import { canRequestDeposit, defaultDepositCents } from '@/lib/deposits'
import type { Deposit } from '@/lib/deposits'
import { createDepositLink, deletePaymentLink, squareConfigured } from '@/lib/square'
import { sendDepositRequest } from '@/lib/notify-v2'
import type { DepositEmailJob } from '@/lib/notify-v2'
import { baseUrl } from '@/lib/file-tokens'
import type { JobItem } from '@/lib/job-types'

export const dynamic = 'force-dynamic'

async function load(idParam: string, tenantId: string) {
  const jobId = parseInt(idParam, 10)
  if (isNaN(jobId)) return null
  const { data } = await getJob(jobId, ['id', 'reference_number', 'event_name', 'company_name', 'client_name', 'contact_email', 'items', 'deposit'], tenantId)
  return data
}

// Request a deposit. Body: { amount_cents?: number } — defaults to DEPOSIT_PERCENT of the quote.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin()
  if ('unauthorized' in auth) return auth.unauthorized
  if (!squareConfigured()) {
    return NextResponse.json({ error: 'Square is not set up yet (SQUARE_ACCESS_TOKEN / SQUARE_LOCATION_ID).' }, { status: 503 })
  }
  const job = await load((await params).id, auth.tenantId)
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  const prev = job.deposit as Deposit | null
  if (!canRequestDeposit(prev)) return NextResponse.json({ error: 'A deposit is already open or paid for this job.' }, { status: 409 })

  const body = await req.json().catch(() => ({})) as { amount_cents?: unknown }
  const amount = body.amount_cents === undefined ? defaultDepositCents((job.items ?? []) as JobItem[]) : Number(body.amount_cents)
  if (!Number.isInteger(amount) || amount <= 0) {
    return NextResponse.json({ error: body.amount_cents === undefined ? 'Add quotes to the pieces first.' : 'Enter a deposit amount.' }, { status: body.amount_cents === undefined ? 409 : 400 })
  }
  if (amount < 100 || amount > 10_000_000) return NextResponse.json({ error: 'Deposit must be between $1 and $100,000.' }, { status: 400 })

  const attempt = (prev?.attempt ?? 0) + 1
  const title = job.event_name || job.company_name
  let link
  try {
    link = await createDepositLink({
      name: `Deposit — ${title} (${job.reference_number})`,
      amountCents: amount,
      idempotencyKey: `deposit-${job.id}-${attempt}`,
      buyerEmail: job.contact_email,
      note: job.reference_number,
      redirectUrl: `${baseUrl()}/portal`,
    })
  } catch (e) {
    console.error('[deposit] Square link failed:', e)
    return NextResponse.json({ error: 'Square could not create the payment link. Try again in a minute.' }, { status: 502 })
  }

  const deposit: Deposit = { amount_cents: amount, status: 'sent', link_id: link.id, url: link.url, order_id: link.order_id, attempt, sent_at: new Date().toISOString() }
  const { error } = await updateJob(job.id, { deposit }, auth.tenantId)
  if (error) return NextResponse.json({ error: 'Saved the link in Square but not here. Try again (same link is reused).' }, { status: 500 })
  const emailed = await sendDepositRequest(job as DepositEmailJob, amount, link.url)
  return NextResponse.json({ deposit, emailed })
}

// Cancel an unpaid deposit link.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin()
  if ('unauthorized' in auth) return auth.unauthorized
  const job = await load((await params).id, auth.tenantId)
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  const d = job.deposit as Deposit | null
  if (!d || d.status !== 'sent') return NextResponse.json({ error: 'There is no unpaid deposit to cancel.' }, { status: 409 })
  try {
    await deletePaymentLink(d.link_id)
  } catch (e) {
    console.error('[deposit] Square delete failed:', e)
    return NextResponse.json({ error: 'Square could not cancel the link. Try again.' }, { status: 502 })
  }
  const deposit: Deposit = { ...d, status: 'cancelled', cancelled_at: new Date().toISOString() }
  await updateJob(job.id, { deposit }, auth.tenantId)
  return NextResponse.json({ deposit })
}
```

- [ ] **Step 5: Run** — `npx vitest run tests/deposit-route.test.ts` → 4 passed.

- [ ] **Step 6: Commit**

```bash
git add src/lib/notify-v2.ts "src/app/api/admin/jobs/[id]/deposit" tests/deposit-route.test.ts
git commit -m "feat(deposit): admin request/cancel deposit + client email"
```

---

### Task 10: Square webhook + daily reconcile

**Files:** Create `src/lib/deposit-settle.ts`, `src/app/api/square/webhook/route.ts`, `src/app/api/cron/deposit-reconcile/route.ts`; Test `tests/square-webhook.test.ts`

- [ ] **Step 1: Write the failing test — `tests/square-webhook.test.ts`**

```ts
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { randomUUID, createHmac } from 'node:crypto'
import { hasDb, TEST_URL, applySchema, resetTables } from './helpers/db'

const pushes: { title?: string }[] = []
const mails: { subject: string }[] = []
vi.mock('@/lib/ntfy', () => ({ sendNtfy: vi.fn(async (o: { title?: string }) => { pushes.push(o) }) }))
vi.mock('@/lib/mailer', () => ({ sendMail: vi.fn(async (m: { subject: string }) => { mails.push(m); return true }) }))
const orderState: Record<string, { paid: boolean; paymentId: string | null; paidAt: string | null }> = {}
vi.mock('@/lib/square', async (orig) => ({
  ...(await orig<typeof import('@/lib/square')>()),
  orderPaid: vi.fn(async (id: string) => orderState[id] ?? { paid: false, paymentId: null, paidAt: null }),
}))

const HOOK_URL = 'https://jobs.ddfpixel.com/api/square/webhook'
const KEY = 'test-signature-key'
const sign = (body: string) => createHmac('sha256', KEY).update(HOOK_URL + body).digest('base64')

describe.skipIf(!hasDb)('Square webhook + reconcile', () => {
  let webhook: typeof import('@/app/api/square/webhook/route')
  let reconcile: typeof import('@/app/api/cron/deposit-reconcile/route')
  let repo: typeof import('@/lib/jobs-repo')
  let tenantId: string
  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_URL
    process.env.SQUARE_WEBHOOK_SIGNATURE_KEY = KEY
    process.env.SQUARE_WEBHOOK_URL = HOOK_URL
    process.env.CRON_SECRET = 'cron-test'
    process.env.NOTIFICATION_EMAIL = 'jobs@example.com'
    process.env.SQUARE_ACCESS_TOKEN = 'tok'
    process.env.SQUARE_LOCATION_ID = 'LOC1'
    applySchema()
    repo = await import('@/lib/jobs-repo')
    tenantId = await (await import('@/lib/tenant')).getDefaultTenantId()
    webhook = await import('@/app/api/square/webhook/route')
    reconcile = await import('@/app/api/cron/deposit-reconcile/route')
  })
  beforeEach(async () => { await resetTables(); pushes.length = 0; mails.length = 0; for (const k of Object.keys(orderState)) delete orderState[k] })

  const jobWithDeposit = async (orderId: string) => {
    const id = (await repo.insertJob({
      tenant_id: tenantId, reference_number: `DDF-W-${randomUUID().slice(0, 6)}`, client_name: 'Aanya', company_name: 'Co', contact_email: 'a@b.co',
      event_name: 'Wedding', date_required: '2030-12-12', notes: null, setup_location: null, setup_time: null, removal_location: null, removal_time: null,
      items: [], file_paths: [], submission_id: randomUUID(), submitted_at: new Date().toISOString(), status: 'received',
    })).data!.id
    await repo.updateJob(id, { deposit: { status: 'sent', order_id: orderId, amount_cents: 115000, link_id: 'PL', url: 'u', attempt: 1, sent_at: 'x' } })
    return id
  }
  const post = (body: string, sig = sign(body)) =>
    webhook.POST(new Request(HOOK_URL, { method: 'POST', body, headers: { 'x-square-hmacsha256-signature': sig } }))
  const paymentEvent = (orderId: string, status = 'COMPLETED') =>
    JSON.stringify({ type: 'payment.updated', data: { object: { payment: { id: 'PAY1', order_id: orderId, status, updated_at: '2030-01-01T00:00:00Z' } } } })

  it('rejects a bad signature', async () => {
    expect((await post(paymentEvent('ORD1'), 'bad')).status).toBe(401)
  })

  it('marks the deposit paid once, notifies once, ignores repeats', async () => {
    const id = await jobWithDeposit('ORD1')
    expect((await post(paymentEvent('ORD1'))).status).toBe(200)
    expect((await post(paymentEvent('ORD1'))).status).toBe(200)
    expect((await repo.getJob(id, ['deposit'])).data!.deposit).toMatchObject({ status: 'paid', payment_id: 'PAY1' })
    expect(pushes).toHaveLength(1)
    expect(mails).toHaveLength(1)
  })

  it('ignores unpaid statuses and unknown orders with 200', async () => {
    await jobWithDeposit('ORD2')
    expect((await post(paymentEvent('ORD2', 'APPROVED'))).status).toBe(200)
    expect((await post(paymentEvent('NOPE'))).status).toBe(200)
    expect(pushes).toHaveLength(0)
  })

  it('reconcile settles deposits Square says are paid', async () => {
    const a = await jobWithDeposit('ORDA')
    const b = await jobWithDeposit('ORDB')
    orderState.ORDA = { paid: true, paymentId: 'PAYA', paidAt: '2030-01-02T00:00:00Z' }
    const res = await reconcile.GET(new Request('http://x/api/cron/deposit-reconcile', { headers: { authorization: 'Bearer cron-test' } }))
    expect(await res.json()).toMatchObject({ checked: 2, settled: 1 })
    expect((await repo.getJob(a, ['deposit'])).data!.deposit).toMatchObject({ status: 'paid', payment_id: 'PAYA' })
    expect((await repo.getJob(b, ['deposit'])).data!.deposit).toMatchObject({ status: 'sent' })
  })
})
```

- [ ] **Step 2: Run it to see it fail** — `npx vitest run tests/square-webhook.test.ts` → FAIL (routes missing).

- [ ] **Step 3: Create `src/lib/deposit-settle.ts`**

```ts
import 'server-only'
import { markDepositPaid, findJobByDepositOrder } from '@/lib/jobs-repo'
import { sendNtfy } from '@/lib/ntfy'
import { sendDepositPaidNotice } from '@/lib/notify-v2'
import type { DepositEmailJob } from '@/lib/notify-v2'
import { money } from '@/lib/email-layout'
import { baseUrl } from '@/lib/file-tokens'
import type { Deposit } from '@/lib/deposits'

export type SettleResult = { ok: true; changed: boolean } | { ok: false }

/** Shared by the webhook and the reconcile: flip to paid (once) and tell the owner. */
export async function settleDeposit(orderId: string, paymentId: string | null, paidAt: string): Promise<SettleResult> {
  const flipped = await markDepositPaid(orderId, paidAt, paymentId)
  if (flipped.error) return { ok: false }
  const { data: job } = await findJobByDepositOrder(orderId)
  if (!flipped.data) {
    // Not a fresh payment. Warn if money arrived on a link we had cancelled.
    if (job && (job.deposit as Deposit | null)?.status === 'cancelled') {
      await sendNtfy({ title: 'Payment on a cancelled deposit link', message: `${job.reference_number}: Square reports a payment for a cancelled deposit link. Check Square.`, priority: 4, tags: 'warning' })
    }
    return { ok: true, changed: false }
  }
  if (job) {
    const amount = (job.deposit as Deposit).amount_cents
    await sendNtfy({
      title: `Deposit paid - ${money(amount)}`,
      message: `${job.event_name || job.company_name} (${job.reference_number}) paid the deposit. Record it on the CC invoice.`,
      priority: 4, tags: 'moneybag', clickUrl: `${baseUrl()}/admin`,
    })
    await sendDepositPaidNotice(job as DepositEmailJob & { id: number }, amount)
  }
  return { ok: true, changed: true }
}
```

- [ ] **Step 4: Create `src/app/api/square/webhook/route.ts`**

```ts
import { NextResponse } from 'next/server'
import { verifySquareSignature } from '@/lib/square'
import { settleDeposit } from '@/lib/deposit-settle'
import { baseUrl } from '@/lib/file-tokens'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Square → us. Public URL; trust comes only from the signature. Always 200 for
// events we don't act on (Square retries non-2xx); 500 only when the DB failed.
export async function POST(req: Request) {
  const raw = await req.text()
  const url = process.env.SQUARE_WEBHOOK_URL || `${baseUrl()}/api/square/webhook`
  const key = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY ?? ''
  if (!verifySquareSignature(raw, req.headers.get('x-square-hmacsha256-signature'), url, key)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }
  let evt: { type?: string; data?: { object?: { payment?: { id?: string; order_id?: string; status?: string; updated_at?: string } } } }
  try { evt = JSON.parse(raw) } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const p = evt.data?.object?.payment
  if ((evt.type !== 'payment.created' && evt.type !== 'payment.updated') || !p?.order_id || p.status !== 'COMPLETED') {
    return NextResponse.json({ ignored: true })
  }
  const r = await settleDeposit(p.order_id, p.id ?? null, p.updated_at ?? new Date().toISOString())
  if (!r.ok) return NextResponse.json({ error: 'Database error' }, { status: 500 })
  return NextResponse.json({ changed: r.changed })
}
```

- [ ] **Step 5: Create `src/app/api/cron/deposit-reconcile/route.ts`**

```ts
import { NextResponse } from 'next/server'
import { cronAuthorized } from '@/lib/cron-auth'
import { listSentDeposits } from '@/lib/jobs-repo'
import { orderPaid, squareConfigured } from '@/lib/square'
import { settleDeposit } from '@/lib/deposit-settle'
import type { Deposit } from '@/lib/deposits'

export const dynamic = 'force-dynamic'

// Daily safety net: webhooks sent while the shop PC was offline are lost, so ask
// Square directly about every unpaid deposit link.
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!squareConfigured()) return NextResponse.json({ skipped: 'square not configured' })
  const { data, error } = await listSentDeposits()
  if (error) return NextResponse.json({ error: 'Failed to load deposits' }, { status: 500 })
  let settled = 0, failed = 0
  for (const row of data ?? []) {
    const d = row.deposit as Deposit
    try {
      const o = await orderPaid(d.order_id)
      if (o.paid && (await settleDeposit(d.order_id, o.paymentId, o.paidAt ?? new Date().toISOString())).ok) settled++
    } catch (e) {
      failed++
      console.error('[deposit-reconcile]', d.order_id, e)
    }
  }
  return NextResponse.json({ checked: (data ?? []).length, settled, failed })
}
```

- [ ] **Step 6: Run** — `npx vitest run tests/square-webhook.test.ts` → 4 passed.

- [ ] **Step 7: Commit**

```bash
git add src/lib/deposit-settle.ts src/app/api/square/webhook src/app/api/cron/deposit-reconcile tests/square-webhook.test.ts
git commit -m "feat(deposit): signed Square webhook + daily reconcile"
```

---

### Task 11: Expose deposit (and stages) to the client pages

**Files:** Modify `src/app/api/portal/me/route.ts`, `src/app/api/review/[token]/route.ts`

- [ ] **Step 1: `portal/me/route.ts`.** Import `publicDeposit` and the `Deposit` type from `@/lib/deposits`. Add `'deposit'` to the `getJob` columns (after `'fulfillment'`), and change the response from Task 4 to:

```ts
  const { contact_email, production, deposit, ...rest } = job
  const stages = deriveStages({ ...rest, production } as Parameters<typeof deriveStages>[0])
  return NextResponse.json({
    jobs: [{ ...rest, stages, deposit: publicDeposit(deposit as Deposit | null), items: publicItems((rest.items ?? []) as JobItem[]) }],
    email: contact_email,
  })
```

- [ ] **Step 2: `review/[token]/route.ts`.** Import `publicDeposit` / `Deposit` from `@/lib/deposits`. Change the `getJob` columns to:

```ts
['reference_number', 'event_name', 'date_required', 'items', 'client_name', 'tenant_id', 'deposit', 'job_type']
```
and add two fields to the JSON response (after `shopName`):

```ts
    deposit: publicDeposit(job.deposit as Deposit | null),
    jobType: job.job_type ?? 'event',
```
(The approval page shows the deposit callout once every piece is approved, and uses `jobType` for wording.)

- [ ] **Step 3: Type-check and run the suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors; all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/portal/me/route.ts "src/app/api/review/[token]/route.ts"
git commit -m "feat: portal + review APIs return deposit (no Square ids)"
```

---

### Task 12: Ops loop schedule, env, docs

**Files:** Modify `ops/loop.sh`, `docker-compose.yml`, `.env.example`, `SYSTEM_STATE.md`

- [ ] **Step 1: `docker-compose.yml`.** Under `services.ops.environment`, add `TZ: America/Toronto` (the ops image already installs `tzdata`). Leave the `app` service on UTC; the app does its own Toronto conversions.

- [ ] **Step 2: `ops/loop.sh`.** Add these functions above `log "ops loop starting"`:

```bash
cron_call() {   # cron_call <path> <state-key> <alert-title>
  if curl -fsS -m 300 -H "Authorization: Bearer ${CRON_SECRET:-}" "$APP_URL$1" >/dev/null; then
    mark "$2"; return 0
  fi
  log "$1 failed"
  ntfy 4 "$3" "$1 failed at $(date)." "$2"
  return 1
}

do_reminders() { cron_call /api/cron/approval-reminders reminders "Approval reminders run failed"; }
do_reconcile() { cron_call /api/cron/deposit-reconcile reconcile "Deposit reconcile failed"; }
do_morning() {
  if cron_call /api/cron/morning-digest morning "Morning print schedule failed"; then
    date +%F > "$STATE/morning-date"
  fi
}
```

and add these lines inside the `while true` loop, after the existing `do_digest` line:

```bash
  hour=$((10#$(date +%H)))                        # local time (TZ=America/Toronto)
  if (( $(age reminders) > 72000 )) && (( hour >= 9 && hour < 20 )); then do_reminders; fi   # 20 h, daytime only
  if [[ "$(cat "$STATE/morning-date" 2>/dev/null)" != "$(date +%F)" ]] && (( hour >= 7 )); then do_morning; fi
  if (( $(age reconcile) > 72000 )); then do_reconcile; fi                                     # 20 h
```

Check: `bash -n ops/loop.sh && echo syntax-ok` → `syntax-ok`.

- [ ] **Step 3: `.env.example`.** Append:

```bash
# ── Client experience v2 ─────────────────────────────────────
# Square deposits (owner creates these in the Square Developer Dashboard; never paste them in chat)
SQUARE_ACCESS_TOKEN=
SQUARE_LOCATION_ID=
SQUARE_ENV=production            # or: sandbox
SQUARE_WEBHOOK_SIGNATURE_KEY=
SQUARE_WEBHOOK_URL=https://jobs.ddfpixel.com/api/square/webhook   # must match the Square subscription exactly
DEPOSIT_PERCENT=50
```

- [ ] **Step 4: `SYSTEM_STATE.md`.** Add a section:

```markdown
## Client experience v2 — scheduled jobs (ops container, Toronto time)
| Job | When | Endpoint |
|---|---|---|
| Morning print schedule | once a day, first loop run after 07:00 | `/api/cron/morning-digest` (push + email to NOTIFICATION_EMAIL) |
| Approval reminders | every ~20 h, 09:00–20:00 only | `/api/cron/approval-reminders` (2 days, then every 3, max 3; owner push at 5 days) |
| Deposit reconcile | every ~20 h | `/api/cron/deposit-reconcile` (asks Square about unpaid links) |

Square webhook: `POST /api/square/webhook`, subscribed to `payment.created` and `payment.updated`.
Square setup (owner): Developer Dashboard → app → Credentials (access token) → Locations (location id) →
Webhooks → Add subscription (URL above, events above) → copy the signature key into `.env.local`.
```

- [ ] **Step 5: Commit**

```bash
git add ops/loop.sh docker-compose.yml .env.example SYSTEM_STATE.md
git commit -m "ops: schedule reminders, morning digest, deposit reconcile (Toronto time)"
```

---

### Task 13: Verify and hand off

- [ ] **Step 1: Full checks**

```bash
docker compose up -d db
npx tsc --noEmit
npm run lint
npx vitest run
npm run build
```
Expected: all green. Fix anything red before continuing (use superpowers:systematic-debugging).

- [ ] **Step 2: Local smoke of the cron routes** (with the app running via `docker compose up -d --build app`)

```bash
source .env.local
curl -s -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/morning-digest
curl -s -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/approval-reminders
curl -s -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/deposit-reconcile
```
Expected: JSON bodies (`{"today":…}`, `{"checked":…}` or `{"skipped":"quiet hours"}`, `{"skipped":"square not configured"}` until Square is set up). The owner's phone gets one "Print schedule" push.

- [ ] **Step 3: Square sandbox end-to-end (with the owner, once Square sandbox credentials are in `.env.local` and `SQUARE_ENV=sandbox`)**
  1. Owner creates a sandbox webhook subscription pointing at `https://jobs.ddfpixel.com/api/square/webhook` (tunnel must be up) and sets `SQUARE_WEBHOOK_SIGNATURE_KEY`.
  2. On a test job with a quote: `POST /api/admin/jobs/<id>/deposit` from the admin (Plan C adds the button; until then use the browser console: `fetch('/api/admin/jobs/<id>/deposit', { method: 'POST', body: '{}' }).then(r => r.json())`).
  3. Open the emailed link, pay with Square's sandbox test card.
  4. Expect: deposit `status: 'paid'` on the job, one "Deposit paid" push, one admin email.
  5. Cancel path: request on a second test job, `DELETE` it, confirm the link no longer opens.
  6. Delete only the test jobs you created, by exact id.

- [ ] **Step 4: Finish the branch** — use superpowers:finishing-a-development-branch (PR into `main`, owner merges).
