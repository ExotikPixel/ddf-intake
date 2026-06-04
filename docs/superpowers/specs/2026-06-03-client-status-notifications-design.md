# Client Status Notifications — Design Spec
**Date:** 2026-06-03  
**Project:** ddf-intake  
**Status:** Approved

---

## Overview

Add a per-job opt-in toggle that lets the admin control whether a client receives email notifications when their job reaches key milestones. Off by default. Uses the existing Brevo email integration.

---

## Data Layer

**Supabase migration:**
- Add column `notify_client BOOLEAN NOT NULL DEFAULT false` to the `jobs` table.

No new tables. No new relationships. The existing job record carries the flag.

---

## Admin UI — Job Card Toggle

- A small toggle labelled **"Notify client"** on each job card in the admin dashboard.
- **Default state:** off (grey).
- **Active state:** on (`#C8702A` / `text-[#C8702A]` — the existing brand amber used across the app).
- Toggling fires a `PATCH /api/admin/jobs/[id]` request with `{ notify_client: boolean }`.
- The toggle is **disabled while the PATCH is in-flight** to prevent concurrent requests and race conditions.
- The toggle updates optimistically on click. If the PATCH fails, the toggle reverts to its previous state.
- The toggle renders its initial state from the `notify_client` field returned by the jobs GET endpoint. On page refresh, the DB value is the source of truth.
- Toggle is visually compact and does not disrupt the existing card layout.

---

## Notification Triggers

Notifications fire server-side when the admin updates a job's status. Two triggers:

| Status change to | Email sent |
|---|---|
| `In Progress` | "Your job is now in production" |
| `Ready for Pickup` | "Your job is ready for collection" |

**De-duplication rule:** The email fires every time the status transitions *to* a trigger value. No de-duplication logic required.

---

## PATCH Route Handler Logic

The Zod schema for the PATCH body (currently inline in the route handler — add `notify_client` to the existing schema):
```ts
z.object({
  status: z.string().optional(),
  notify_client: z.boolean().optional(),
})
```
Both fields are independently optional. A status-only PATCH and a toggle-only PATCH are both valid.

**On a status update**, after the DB write succeeds:
1. Re-fetch the full job record from Supabase. If the row is not found (deleted job), return `404` and skip notification.
2. Check if `notify_client === true` and the new status is `In Progress` or `Ready for Pickup`.
3. If both conditions met, check that `job.client_email` is a non-empty string. If missing, log a warning and skip sending.
4. If all conditions met, call `sendStatusNotification(job, newStatus)`.

**Response:** Return `200` with the updated job object on success (consistent with existing PATCH responses in the route).

**Known limitation:** If a status PATCH and a `notify_client` toggle PATCH are fired simultaneously from different browser tabs, the re-fetch after the status write may read a stale `notify_client` value. This is an unlikely edge case in a single-admin system and is accepted without mitigation.

---

## `sendStatusNotification` Function

**Required fields on `Job` interface** (confirm these exist or add them):
- `client_email: string` — recipient address
- `client_name: string` — recipient name
- `reference: string` — job reference number

**Signature:**
```ts
sendStatusNotification(
  job: Pick<Job, 'reference' | 'client_name' | 'client_email'>,
  status: 'In Progress' | 'Ready for Pickup'
): Promise<void>
```

- Internally wraps the Brevo call in `try/catch`.
- On success: resolves silently.
- On error: logs via `console.error` and resolves (does not throw). The caller does not need its own try/catch.
- Uses the **same sender address/name** already configured in `email.ts`. Do not introduce a new `from` address.

---

## Email Templates

### In Progress
> **Subject:** Your job is in production — [job.reference]
>
> Hi [job.client_name],
>
> Good news — your job is now in production. We'll be in touch when it's ready for pickup.
>
> **Job Reference:** [job.reference]
>
> If you have any questions, feel free to contact us.
>
> — The DDF Pixel team

### Ready for Pickup
> **Subject:** Your job is ready — [job.reference]
>
> Hi [job.client_name],
>
> Great news — your job is ready! Come collect at your convenience during business hours.
>
> **Job Reference:** [job.reference]
>
> If you have any questions, feel free to contact us.
>
> — The DDF Pixel team

---

## Data Flow

1. Admin page loads → `GET /api/admin/jobs` returns all jobs including `notify_client` field
2. Each job card reads `job.notify_client` for initial toggle state
3. Admin flips toggle → toggle disabled → optimistic UI update → `PATCH /api/admin/jobs/[id]` with `{ notify_client: boolean }` → toggle re-enabled → on success: DB updated; on failure: toggle reverts
4. Admin changes status → `PATCH /api/admin/jobs/[id]` with `{ status: string }` → DB updated → handler re-fetches job → if `notify_client && triggerStatus && client_email` → `sendStatusNotification(job, status)`

---

## Files to Change

| File | Change |
|---|---|
| Supabase | Migration: add `notify_client BOOLEAN NOT NULL DEFAULT false` to `jobs` table |
| `src/lib/job-types.ts` | Add `notify_client: boolean` to `Job` interface; confirm `client_email`, `client_name`, `reference` exist (add if missing) |
| `src/app/api/admin/jobs/route.ts` | Ensure `notify_client` is selected in the GET query |
| `src/app/api/admin/jobs/[id]/route.ts` | Add `notify_client` to PATCH Zod schema; re-fetch job after status update; call `sendStatusNotification` if conditions met; return 404 if re-fetch finds no row |
| `src/lib/email.ts` | Add `sendStatusNotification(job, status)` using existing Brevo sender config |
| `src/app/admin/page.tsx` | Add toggle to each job card; disabled during in-flight PATCH; optimistic update with rollback on error |

---

## Out of Scope

- SMS notifications
- Client-side opt-in (admin controls this entirely)
- Per-status granular control (only the two key milestones)
- Email open/click tracking
- De-duplication of repeated status transitions
