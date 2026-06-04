# Client Status Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-job admin toggle (`notify_client`) that, when enabled, automatically emails the client when their job moves to `in_progress` or `completed`.

**Architecture:** A boolean column on the `jobs` table gates notification sending. The existing PATCH route handler is extended with a new branch for `notify_client` updates, and a post-status-update hook fires a new `sendStatusNotification` function in `email.ts`. The admin UI adds a small toggle to each job card with optimistic updates and rollback on failure.

**Tech Stack:** Next.js 16 App Router, Supabase (Postgres + JS client), Brevo (`@getbrevo/brevo`), Zod, React 19, Tailwind CSS v4

---

## Important: Field Name Corrections vs. Spec

The spec uses generic names. The actual codebase uses:
- `reference_number` (not `reference`)
- `contact_email` (not `client_email`)
- `client_name` ✓ (same)
- Trigger statuses: `in_progress` and `completed` (DB values) — there is no "Ready for Pickup" status; `completed` is the equivalent
- `sendStatusNotification` status parameter type: `'in_progress' | 'completed'` (not `'In Progress' | 'Ready for Pickup'` as the spec states)

All code in this plan uses the actual field names.

---

## File Map

| File | Action | What changes |
|---|---|---|
| Supabase dashboard | Migrate | Add `notify_client` column |
| `src/lib/job-types.ts` | Modify | Add `NOTIFICATION_STATUSES` constant |
| `src/lib/schemas.ts` | Modify | Add `JobPatchSchema` with `notify_client` field |
| `src/lib/email.ts` | Modify | Add `sendStatusNotification` function |
| `src/app/api/admin/jobs/[id]/route.ts` | Modify | Add `notify_client` PATCH branch; add notification logic to status branch |
| `src/app/admin/page.tsx` | Modify | Add `notify_client` to `Job` interface; add toggle to job card |

> **Note:** `src/app/api/admin/jobs/route.ts` does NOT need changes — the GET already uses `select('*')` which returns all columns including the new one.

---

## Task 1: Add `notify_client` column to Supabase

**Files:** Supabase dashboard SQL editor

- [ ] **Step 1: Run migration in Supabase**

Log in to [supabase.com](https://supabase.com), open your project, go to **SQL Editor**, and run:

```sql
ALTER TABLE jobs
ADD COLUMN notify_client BOOLEAN NOT NULL DEFAULT false;
```

- [ ] **Step 2: Verify the column exists**

In SQL Editor, run:
```sql
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'jobs' AND column_name = 'notify_client';
```

Expected output: one row with `column_name = notify_client`, `data_type = boolean`, `column_default = false`.

---

## Task 2: Add `NOTIFICATION_STATUSES` to `job-types.ts`

**Files:**
- Modify: `src/lib/job-types.ts`

This gives the route handler and email function a single source of truth for which status values trigger a notification.

- [ ] **Step 1: Add the constant**

Open `src/lib/job-types.ts`. After the `STATUS_CONFIG` block, add:

```ts
/** DB status values that trigger a client notification email */
export const NOTIFICATION_STATUSES = ['in_progress', 'completed'] as const
export type NotificationStatus = typeof NOTIFICATION_STATUSES[number]
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/sarbhome/Documents/Claude/ddf-intake && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/job-types.ts
git commit -m "feat: add NOTIFICATION_STATUSES constant to job-types"
```

---

## Task 3: Add `JobPatchSchema` to `schemas.ts`

**Files:**
- Modify: `src/lib/schemas.ts`

The PATCH route currently uses manual `if` checks with no Zod validation. A separate `JobPatchNotifySchema` is added here rather than a unified schema, because the existing status and edit branches don't use Zod — refactoring those would be out of scope. This schema covers only the `notify_client` toggle PATCH.

- [ ] **Step 1: Add the schema**

Open `src/lib/schemas.ts`. After the existing exports, add:

```ts
export const JobPatchNotifySchema = z.object({
  notify_client: z.boolean(),
})

export type JobPatchNotifyInput = z.infer<typeof JobPatchNotifySchema>
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/sarbhome/Documents/Claude/ddf-intake && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/schemas.ts
git commit -m "feat: add JobPatchNotifySchema to schemas"
```

---

## Task 4: Add `sendStatusNotification` to `email.ts`

**Files:**
- Modify: `src/lib/email.ts`

Adds a new exported function that sends a status-update email to the client. Reuses the existing `SENDER` config and `brevo` instance.

- [ ] **Step 1: Add the function**

Open `src/lib/email.ts`. After the closing `}` of `sendConfirmationEmail`, add:

```ts
export async function sendStatusNotification(
  job: { reference_number: string; client_name: string; contact_email: string },
  status: 'in_progress' | 'completed'
): Promise<void> {
  const isInProgress = status === 'in_progress'

  const subject = isInProgress
    ? `Your job is in production — ${job.reference_number}`
    : `Your job is ready — ${job.reference_number}`

  const bodyText = isInProgress
    ? `Good news — your job is now in production. We'll be in touch when it's ready for pickup.`
    : `Great news — your job is ready! Come collect at your convenience during business hours.`

  const html = `
<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;color:#1a1a1a;max-width:600px;margin:0 auto;padding:24px">
  <div style="background:#1a1a1a;color:#fff;padding:16px 20px;margin-bottom:24px">
    <span style="font-weight:800;font-size:18px;letter-spacing:2px">DDF-PIXEL</span>
    <span style="float:right;background:#C8702A;color:#fff;padding:4px 10px;font-size:12px;font-weight:700;border-radius:3px">${job.reference_number}</span>
  </div>

  <p>Hi ${job.client_name},</p>
  <p>${bodyText}</p>
  <p><strong>Job Reference:</strong> ${job.reference_number}</p>
  <hr style="border:none;border-top:1px solid #e0deda;margin:24px 0">
  <p style="color:#666;font-size:13px">If you have any questions, feel free to contact us.</p>
  <p style="color:#666;font-size:13px">— The DDF Pixel team</p>
</body>
</html>`

  try {
    await brevo.transactionalEmails.sendTransacEmail({
      to: [{ email: job.contact_email, name: job.client_name }],
      sender: SENDER,
      subject,
      htmlContent: html,
    })
  } catch (err) {
    console.error('[sendStatusNotification] Brevo send failed:', err)
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/sarbhome/Documents/Claude/ddf-intake && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/email.ts
git commit -m "feat: add sendStatusNotification to email.ts"
```

---

## Task 5: Extend PATCH route handler

**Files:**
- Modify: `src/app/api/admin/jobs/[id]/route.ts`

Two changes:
1. Add a new `notify_client` PATCH branch (toggle-only update).
2. After a status update, re-fetch the job and conditionally send a notification email.

- [ ] **Step 1: Update the top of the file**

Open `src/app/api/admin/jobs/[id]/route.ts`. Replace **everything from line 1 through the `const VALID_STATUSES` line** (the imports, the `export const dynamic`, and the `VALID_STATUSES` declaration) with:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { requireAdmin } from '@/lib/admin-auth'
import { STATUSES, NOTIFICATION_STATUSES } from '@/lib/job-types'
import { JobPatchNotifySchema } from '@/lib/schemas'
import { sendStatusNotification } from '@/lib/email'

export const dynamic = 'force-dynamic'

const VALID_STATUSES: string[] = [...STATUSES]
```

Everything after `const VALID_STATUSES` (the `export async function PATCH` and its body) is untouched.

- [ ] **Step 2: Replace ONLY the status branch**

Find the `if ('status' in body) { ... }` block — it ends with `return NextResponse.json({ success: true })`. Replace **only that block** (leave the edit branch and final `return NextResponse.json({ error: 'Nothing to update' })` completely untouched). Replace the status block with:

```ts
  // notify_client toggle update
  if ('notify_client' in body) {
    const parsed = JobPatchNotifySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid notify_client value' }, { status: 400 })
    }
    const { error } = await supabaseAdmin
      .from('jobs')
      .update({ notify_client: parsed.data.notify_client })
      .eq('id', jobId)
    if (error) return NextResponse.json({ error: 'Update failed' }, { status: 500 })
    return NextResponse.json({ success: true })
  }

  // Status-only update
  if ('status' in body) {
    if (!VALID_STATUSES.includes(body.status as string)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }
    const { error } = await supabaseAdmin
      .from('jobs')
      .update({ status: body.status })
      .eq('id', jobId)
    if (error) return NextResponse.json({ error: 'Update failed' }, { status: 500 })

    // Notification: re-fetch job and send if conditions met
    const newStatus = body.status as string
    if ((NOTIFICATION_STATUSES as readonly string[]).includes(newStatus)) {
      const { data: job } = await supabaseAdmin
        .from('jobs')
        .select('reference_number, client_name, contact_email, notify_client')
        .eq('id', jobId)
        .single()

      if (!job) {
        return NextResponse.json({ error: 'Job not found' }, { status: 404 })
      }

      if (job.notify_client && job.contact_email) {
        await sendStatusNotification(
          {
            reference_number: job.reference_number,
            client_name: job.client_name,
            contact_email: job.contact_email,
          },
          newStatus as 'in_progress' | 'completed'
        )
      } else if (job.notify_client && !job.contact_email) {
        console.warn(`[notify] Job ${jobId} has notify_client=true but no contact_email — skipping send`)
      }
    }

    return NextResponse.json({ success: true })
  }
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/sarbhome/Documents/Claude/ddf-intake && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/admin/jobs/\[id\]/route.ts
git commit -m "feat: extend PATCH handler with notify_client branch and status notification trigger"
```

---

## Task 6: Add `notify_client` to the admin UI

**Files:**
- Modify: `src/app/admin/page.tsx`

Three sub-changes:
1. Add `notify_client` to the `Job` interface.
2. Add a `togglingNotify` state to track in-flight toggle PATCHes.
3. Add the toggle UI to each job card with optimistic update + rollback.

- [ ] **Step 1: Update the `Job` interface**

Find the `interface Job {` block by searching for the text `interface Job {` near the top of the file. Add `notify_client: boolean` as the last field:

```ts
interface Job {
  id: number
  reference_number: string
  client_name: string
  company_name: string
  contact_email: string
  event_name: string | null
  date_required: string
  notes: string | null
  status: string
  submitted_at: string
  items: JobItem[]
  file_paths: string[]
  notify_client: boolean
}
```

- [ ] **Step 2: Add `togglingNotify` state**

Find where the other state variables are declared (look for lines like `const [updating, setUpdating] = useState<number | null>(null)`). Add directly after:

```ts
const [togglingNotify, setTogglingNotify] = useState<number | null>(null)
```

- [ ] **Step 3: Add the `toggleNotify` handler function**

Find the `updateStatus` function definition in `page.tsx`. After its closing `}`, add:

```ts
async function toggleNotify(jobId: number, currentValue: boolean) {
  const newValue = !currentValue
  // Optimistic update
  setJobs(prev => prev.map(j => j.id === jobId ? { ...j, notify_client: newValue } : j))
  setTogglingNotify(jobId)
  try {
    const res = await fetch(`/api/admin/jobs/${jobId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notify_client: newValue }),
    })
    if (!res.ok) throw new Error('PATCH failed')
  } catch {
    // Rollback on failure
    setJobs(prev => prev.map(j => j.id === jobId ? { ...j, notify_client: currentValue } : j))
  } finally {
    setTogglingNotify(null)
  }
}
```

- [ ] **Step 4: Add the toggle to each job card**

Find the `{/* Status dropdown */}` comment in the job card JSX. Place the notify toggle **immediately before** that comment:

```tsx
{/* Notify client toggle */}
<button
  onClick={() => toggleNotify(job.id, job.notify_client)}
  disabled={togglingNotify === job.id}
  title={job.notify_client ? 'Client notifications ON — click to disable' : 'Client notifications OFF — click to enable'}
  style={{
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    padding: '5px 9px',
    fontSize: 11,
    fontWeight: 600,
    border: '1px solid',
    borderColor: job.notify_client ? '#C8702A' : '#ddd',
    background: job.notify_client ? '#fff7ed' : '#fff',
    color: job.notify_client ? '#C8702A' : '#999',
    cursor: togglingNotify === job.id ? 'wait' : 'pointer',
    opacity: togglingNotify === job.id ? 0.6 : 1,
    fontFamily: 'var(--font-body)',
  }}
>
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
    <path d="M13.73 21a2 2 0 01-3.46 0"/>
  </svg>
  {job.notify_client ? 'Notify: ON' : 'Notify: OFF'}
</button>
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd /Users/sarbhome/Documents/Claude/ddf-intake && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/admin/page.tsx
git commit -m "feat: add notify_client toggle to admin job card"
```

---

## Task 7: Manual end-to-end test

- [ ] **Step 1: Start dev server**

```bash
cd /Users/sarbhome/Documents/Claude/ddf-intake && npm run dev
```

- [ ] **Step 2: Test the toggle**

1. Open `http://localhost:3000/admin` and log in
2. Find any job card — confirm the toggle shows "Notify: OFF" in grey by default
3. Click the toggle — it should optimistically flip to "Notify: ON" in amber
4. Refresh the page — the toggle should still show ON (DB persisted)
5. Click it again — should revert to OFF
6. Refresh — should show OFF

- [ ] **Step 3: Test notification on status change**

1. Enable "Notify: ON" for a job that has a valid `contact_email`
2. Change the job status to "In Progress" via the status dropdown
3. Check the `contact_email` inbox — should receive the "in production" email within ~1 minute
4. Change status to "Completed"
5. Check inbox again — should receive the "job ready" email

- [ ] **Step 4: Test notification suppression**

1. Ensure a job has "Notify: OFF"
2. Change its status to "In Progress"
3. Confirm no email is sent to the client

- [ ] **Step 5: Commit and deploy**

```bash
git add -A
git commit -m "feat: client status notifications — notify toggle + email on in_progress/completed"
git push
```

---

## Summary

| Task | Files touched |
|---|---|
| 1 — Supabase migration | Supabase SQL editor |
| 2 — NOTIFICATION_STATUSES | `src/lib/job-types.ts` |
| 3 — JobPatchNotifySchema | `src/lib/schemas.ts` |
| 4 — sendStatusNotification | `src/lib/email.ts` |
| 5 — PATCH route extension | `src/app/api/admin/jobs/[id]/route.ts` |
| 6 — Admin UI toggle | `src/app/admin/page.tsx` |
| 7 — Manual E2E test | — |
