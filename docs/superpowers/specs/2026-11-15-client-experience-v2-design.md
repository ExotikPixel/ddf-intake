# Client Experience v2 — Redesign + Four Features — Design Spec

**Date:** 2026-11-15 · **Repo:** ddf-intake · **Status:** Draft for owner review
**Mockup (approved reference):** https://claude.ai/artifact/63KGNvjm6zYmGK3i9avckQ. Five screens (intake, portal, approval, admin, emails), desktop + phone toggle, fictional sample data.
**Depends on:** Supabase Exit Phase 1 (`2026-11-15-supabase-exit-design.md`) merged to `main`. Build on top of it: same repos (`jobs-repo.ts`), file links (`file-tokens.ts`), ops loop, admin auth.

⚑ = a default chosen for the owner to confirm or change. Changing one doesn't change the design.

## 1. Goals

1. Every client-facing page and email feels modern and premium (soft glass, Geist + Instrument Serif) for **both** divisions: DDF events and Pixel products/fabrication. It works well on a phone, where most clients open links.
2. Admin becomes a scan-first dashboard: what needs attention today, at a glance.
3. Four features from the agreed roadmap: **approval reminders, client progress tracker, deposit at approval, morning print digest.**
4. No change to URLs, review/portal links, Command Centre contracts, or data already stored.

**Non-goals:** new auth, multi-tenant/SaaS work, Command Centre UI changes. CC-side work is listed as a dependency where a feature would benefit from it.

## 2. Part A — Visual redesign

### A1. Design system: "soft glass" (from the mockup's `src/index.css`)
Direction (owner's reference: a modern habit-tracker app on Dribbble): airy mauve → stone wash, frosted-glass pills, big rounded white cards, light tight headings, ink-black pill buttons and a round "+" button. It serves both divisions (events **and** products/fabrication), so it isn't wedding-specific.

| Token | Value | Use |
|---|---|---|
| `--bg` + `--wash` | `#ebe6e1` + radial mauve `#dcc4d4` / sand `#eadccd` | page background |
| `--surface` | `#ffffff` | cards, inputs |
| `--glass` / `--glass-line` | `rgba(255,255,255,.58)` / `rgba(255,255,255,.8)` + `backdrop-filter: blur(14–18px)` | pills, nav, secondary buttons |
| `--ink` / `--ink-soft` | `#121212` / `#2c2a29` | text, primary buttons, dark summary card |
| `--muted` / `--line` | `#756e68` / `#e6dfd8` | secondary text, rules |
| `--mauve` / `--mauve-deep` / `--mauve-wash` | `#b48ea8` / `#7a4c69` / `#f3eaf0` | accent, progress, highlights |
| `--sage` / `--sage-wash` | `#4b6b53` / `#e3ebe3` | approved, approve button |
| `--amber` / `--amber-wash` | `#93601f` / `#f6ecdc` | waiting |
| `--rose` / `--rose-wash` | `#8b2252` / `#f5e5ec` | needs attention (brand burgundy family) |
| radius | 32 / 24 / 16 / 12 px; buttons and chips fully round | |
| shadow | `0 24px 60px -34px rgba(74,44,64,.38)` | cards |

- **Type:** **Geist** (300 for large headings at −0.04em tracking; 400/500 for UI and body) + **Instrument Serif** italic for one accent word per heading ("Tell us what you're *making.*"). Both via `next/font/google`. Replaces Oswald/Montserrat.
- **Dark summary card** (brief, reference, countdown): ink with a soft plum glow. **Floating dock** on phones: glass pill with a black round "+" (add a piece) and messages.
- **Tenant branding stays:** `/s/[slug]` sets `--mauve-deep`/`--mauve` from `tenant_settings.brand_color`.
- **Components** (`src/components/ui/`): `Button` (ink / sage / glass; sm/block), `Fab`, `Field`, `Chip`, `Pill` (ok / wait / alert / neutral / accent), `SecHead` (number pill + title), `SummaryCard`, `Panel`, `GlassBar`, `Stepper`, `Dropzone`, `FileRow`, `Tracker`, `Switch`, `Toast`, `Dock`. Styles in `src/app/ui.css`, imported once in `layout.tsx`.
- **Responsive:** container queries on a `.frame` wrapper (breakpoint 760px; admin 900px). Every page is checked at 390px and 1360px.
- **Accessibility:** visible `:focus-visible` ring, `prefers-reduced-motion`, AA contrast (glass surfaces keep text on ≥ 58% white), real `<label for>` on every field.

### A1b. Events and products
- New **"What's it for?"** choice at the top of the intake: **An event** (event name, date, venue/setup, removal) or **Products & fabrication** (CNC wood, signs, displays, large-format: **needed-by** date and **pick up / deliver / install** + address).
- Data: `jobs.job_type text not null default 'event' check (job_type in ('event','product'))`, `jobs.fulfillment text` (`pickup` | `delivery` | `install`, product jobs). The product address/time reuse `setup_location` / `setup_time`. Labels change by type.
- Material chips add **Metal**; uploads accept **DXF** (CNC files).
- Wording everywhere is neutral ("make", "pieces", "due"). The tracker's last stage reads **Installed** (event), **Ready for pickup**, **Delivered** or **Installed** (product, from `fulfillment`).
- Admin shows an **Event / Product** tag on every job; the print schedule includes product due dates.

### A1c. Limits (raised, now that there's no 1 GB cap) ⚑
| Limit | Was | New |
|---|---|---|
| Pieces per brief | 10 | **30** |
| Pieces per "Add to job" | 10 | **30** |
| General files per brief / add | 3 | **10** |
| Reference photos per piece | 8 | 8 |
| Final files per piece | 8 | 8 |
| Max size per file | 50 MB | **95 MB** (Cloudflare's free plan caps a single upload at 100 MB) |

Change in `src/lib/schemas.ts` (`SubmitSchema.items`, `filePaths`; `AddToJobSchema.newItems`, `newFilePaths`), `IntakeForm.tsx` (`MAX_FILES`, `MAX_BYTES`, piece cap), `upload-url/route.ts` (`MAX_BYTES`, allow `.dxf` → `application/dxf`, `image/vnd.dxf`, `application/octet-stream`), and the portal add-to-job UI.

### A2. Surfaces
| Surface | Route / file | What changes |
|---|---|---|
| Intake | `/`, `/s/[slug]` → `IntakeForm.tsx` | "What's it for?" (event / products) cards, artwork chips (design it for me / print-ready), glass step bar, numbered sections, piece cards with quantity stepper + material chips, dropzone with progress rows, sticky dark **summary card** (event or due date, countdown, pieces/units, files) with Send. Success screen shows the reference as a ticket + 3-step "what happens next". Same fields, validation and API. |
| Portal | `/portal` → `portal/page.tsx` | Lookup card; job header with reference/countdown ticket; **progress tracker** (B2); "N designs waiting" callout; piece cards with proof thumbnail + status pill; **deposit card** (B3); add-to-job and upload-final kept. |
| Approval | `/review/[token]` → `ReviewClient.tsx` | Glass piece tabs with status dots; light studio "stage" proof viewer; **"On the floor" preview** for dance-floor pieces; pick-one option rail; Approve (sage) / Request changes; conversation thread; deposit callout once all approved (B3). |
| Admin | `/admin` → `admin/page.tsx` | Floating glass side nav; KPI cards (awaiting approval, events in 7 days, in production, deposits outstanding); filter chips; jobs table (approvals bar, deposit, reminders, status); **job drawer** (reminders, deposit, pieces + proof upload, notify toggle, Command Centre resync); **print schedule** panel (B4). |
| Login | `/login` | Restyled to tokens (Phase 1 already made it admin-only). |
| Emails | `src/lib/email.ts` | One branded layout (logo header, rounded white card, black pill CTA, footer) for all templates, built as table-based HTML with inline styles for email clients. New templates: reminder (B1), deposit (B3), digest (B4). |

- **"On the floor" preview:** a CSS 3D transform of the proof image (`rotateX(58deg) rotateZ(-8deg)`) on a soft studio backdrop with a floor shadow, labelled "not to scale". It shows for an item when `item.preview === 'floor'` (admin can set it in the drawer). Otherwise it shows when the item name contains "floor" ⚑. A non-image proof (PDF/AI) uses its preview PNG; with no preview PNG the toggle is hidden.
- **Admin refactor (targeted):** `admin/page.tsx` is >2,000 lines of inline styles. Split it while restyling: `KpiStrip`, `JobsTable`, `JobDrawer`, `PrintSchedule`, `ProofUploader`, `LibraryPicker`. Keep data flow and API calls identical.

## 3. Part B — Features

### B1. Approval reminders
- **Who/when:** a client gets a reminder email when any proofed item has been waiting for approval (`approval_status` not `approved`) for **2 days**, then **every 3 days**, **max 3** ⚑. The owner gets an ntfy push when an item has waited **5 days** ⚑ (once per job per day).
- **Stops when:** all proofed items are approved; the event date has passed; the job is `completed`/`cancelled`; 3 reminders have been sent; or the admin paused reminders for the job.
- **"Waiting since":** new item field `proof_sent_at` (ISO), set **server-side** whenever an item's `proof_urls` change in the admin item patch or the brief-edit merge (the admin UI clears `proof_uploaded_at` today, and that field means client-uploaded finals). Older items without it fall back to `jobs.updated_at`.
- **Data:** `jobs.reminders jsonb not null default '{}'` → `{ count, last_sent_at, paused, owner_alerted_on }`.
- **Endpoints:** `GET /api/cron/approval-reminders` (Bearer `CRON_SECRET`, idempotent per day). Admin: `POST /api/admin/jobs/[id]/reminders` (send now; counts toward the 3) and `PATCH` on the same route `{ paused }`.
- **Schedule:** ops loop calls it when the last run is > 20 h old **and** local time is 09:00–20:00 America/Toronto ⚑ (no 3 a.m. emails).
- **Email:** "N designs are waiting for your approval": event countdown, names of waiting pieces, Review button (signed review link), "reply to pause reminders".

### B2. Client progress tracker
Six stages, derived from data the app already has (no CC change needed):

| Stage | Done when | Date shown |
|---|---|---|
| Brief received | always | `submitted_at` |
| Designing | any item has a proof, or client sent finals | first `proof_sent_at` |
| Proofs ready | any item has a proof | first `proof_sent_at` |
| Approved | every item approved (current shows "x of y") | last `approved_at` |
| In production | `status = in_progress`, or any `production` day is `in_progress`/`done` | — |
| Installed / Ready for pickup / Delivered | `status = completed` (label from `job_type` + `fulfillment`) | `date_required` |

- Pure function `deriveStages(job)` in `src/lib/progress.ts`, used by `/api/portal/me` (adds `stages` to the response) and the portal UI.
- ⚑ **Later (CC dependency):** finer stages (printed / prepared / installed) need Command Centre's status callback to send a `stage` field. The tracker accepts an optional `production_stage` and slots it in when present.

### B3. Deposit at approval (Square)
- **Trigger:** admin clicks **Request deposit** in the job drawer (matches the roadmap's "when admin approves for print"; never automatic). Enabled only when the job has a quote (`jobQuoteTotal(items).total > 0`).
- **Amount:** `DEPOSIT_PERCENT` (default **50%** ⚑) of the quote total, rounded to the cent, editable before sending. Currency CAD.
- **Square:** `POST https://connect.squareup.com/v2/online-checkout/payment-links` with `quick_pay { name: "Deposit — <event> (<ref>)", price_money { amount, currency: "CAD" }, location_id }`, `Idempotency-Key: deposit-<jobId>-<n>`. Raw `fetch`, same pattern as Command Centre's Square code. Sandbox via `SQUARE_ENV=sandbox`.
- **Data:** `jobs.deposit jsonb` (nullable) → `{ amount_cents, link_id, url, order_id, attempt, status: 'sent' | 'paid' | 'cancelled', sent_at, paid_at, payment_id, cancelled_at }`. Paid = the Square order has a tender (quick-pay orders go DRAFT → OPEN when paid).
- **Client sees:** deposit email (B3 template); deposit card in the portal; deposit callout on the approval page once everything is approved. The Square-hosted page takes card / Apple Pay / Google Pay. No card data touches our server.
- **Paid detection:** `POST /api/square/webhook` (signature verified: HMAC-SHA256 of notification URL + raw body with `SQUARE_WEBHOOK_SIGNATURE_KEY`) on `payment.updated` with `status = COMPLETED` and matching `order_id` → `status: 'paid'`, ntfy + admin email. **Plus** a daily reconcile in the ops loop (`GET /v2/orders/{order_id}` for unpaid deposits), because webhooks sent while the shop PC is offline would otherwise be missed.
- **Cancel / resend:** admin can cancel (Square `DELETE /v2/online-checkout/payment-links/{id}`) and request again.
- ⚑ **Double-billing guard (CC dependency):** Command Centre also invoices through Square. Until CC learns about intake deposits (extend the existing intake → CC invoice webhook with `deposit_paid_cents`), the admin drawer shows "Deposit paid — record it on the CC invoice" after payment.
- **Env:** `SQUARE_ACCESS_TOKEN`, `SQUARE_LOCATION_ID`, `SQUARE_WEBHOOK_SIGNATURE_KEY`, `SQUARE_ENV`, `DEPOSIT_PERCENT`. Cost: Square's per-payment fee only; no monthly fee.

### B4. Morning print digest
- **When:** daily, first ops-loop run at or after **07:00** America/Toronto ⚑ (catches up if the PC was off). Also on demand from the admin "Print schedule" panel (live data via `GET /api/admin/schedule`).
- **What:** every job (event or product) with an event day or due date in the **next 7 days** (per-item dates via `kanban-days.resolveDate`, else `date_required`), grouped by day: pieces, approvals x/y, deposit status. **Flags:** item not approved; no proof yet; deposit not requested or unpaid. Builder: `buildSchedule(jobs, today)` in `src/lib/schedule.ts` (pure).
- **Delivery:** ntfy (priority 4 if any flag within 3 days, else 3) + email to `NOTIFICATION_EMAIL` ⚑. Endpoint `GET /api/cron/morning-digest` (Bearer `CRON_SECRET`, once per local day).

## 4. Data model changes (`db/schema.sql`, idempotent)
```sql
alter table public.jobs add column if not exists reminders jsonb not null default '{}'::jsonb;
alter table public.jobs add column if not exists deposit jsonb;
```
```sql
alter table public.jobs add column if not exists job_type text not null default 'event';
alter table public.jobs add column if not exists fulfillment text;
```
Item JSON gains optional `proof_sent_at` and `preview` ('floor' | 'flat'). `jobs-repo.ts`: add `reminders`, `deposit`, `job_type`, `fulfillment` to `JobColumn` and `UPDATABLE`; `reminders`, `deposit` to `JSON_COLUMNS`. `insertJob` takes `job_type` and `fulfillment`.

## 5. Ops loop additions (`ops/loop.sh`)
- `approval-reminders`: if age > 20 h and local hour is 09–20.
- `morning-digest`: if the last digest's local date ≠ today and local hour ≥ 7.
- `deposit-reconcile`: if age > 20 h.
Set `TZ=America/Toronto` in the `ops` service.

## 6. Order of work
1. **Plan A — Design system + intake + login** (no data changes).
2. **Plan B — Backend features:** B4 digest → B1 reminders → B2 tracker → B3 deposit (last: needs the owner's Square credentials and webhook setup).
3. **Plan C — Portal, approval, admin, emails redesign**, wiring in B1–B4 UI.
Run order: **B → A → C**. Plan A's last data task stores `job_type`, which Plan B adds to the database; C needs both.
Plans: `docs/superpowers/plans/2026-11-15-cx2-plan-a-design-intake.md`, `…-cx2-plan-b-features.md`, `…-cx2-plan-c-pages.md`. Design reference: `docs/design/client-experience-v2/`.

## 7. Testing
- Unit: `deriveStages` (every stage transition), reminder eligibility (2/3/5-day rules, stop conditions, quiet hours), `buildSchedule` (date resolution, flags), deposit amount rounding, Square signature verify (known vector), email templates render without throwing and contain the CTA URL.
- DB: reminders/deposit jsonb updates via `updateJob`; webhook marks the right job paid, ignores unknown orders, is idempotent on repeats.
- Visual QA: screenshot every page at 390px and 1360px against the mockup before merge.
- Square sandbox end-to-end: request deposit → pay with a sandbox card → webhook marks paid → portal shows Paid.

## 8. Risks
- **Email deliverability:** reminders and deposits make email critical. `SYSTEM_STATE.md` notes Brevo domain verification for `SENDER_EMAIL` is still pending. Finish it before B1/B3 go live.
- **Shop PC offline:** webhooks are covered by the reconcile; reminders and digest catch up on the next run.
- **Reminder fatigue:** capped at 3, with reply-to-pause and an admin pause.
- **Double billing with CC** until the CC dependency in B3 ships.

## 9. Defaults to confirm (⚑)
| # | Default |
|---|---|
| 1 | Reminders: first after 2 days, then every 3 days, max 3; owner alert at 5 days; sent 9 a.m.–8 p.m. only |
| 2 | Deposit: 50% of quoted total, admin-triggered, CAD |
| 3 | Digest: 7:00 a.m. daily, phone push + email to `NOTIFICATION_EMAIL` |
| 4 | "On the floor" preview: items named "…floor…" or admin-flagged |
| 5 | Look: soft glass, Geist + Instrument Serif, mauve/stone/ink (replaces Oswald and the gold-on-cream site) |
| 6 | Limits: 30 pieces, 10 files, 95 MB per file |
| 7 | Product jobs: needed-by date + pick up / deliver / install |
