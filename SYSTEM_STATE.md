# DDF x Pixel — System State

> **For Claude (and humans): read this before exploring the code.** It maps both
> apps, their integration contracts, what shipped recently, and the agreed next
> steps. Last full update: **2026-07-04**.

## The two apps

| | **ddf-intake** (this repo) | **Command Centre / "GetFlowDesk"** |
|---|---|---|
| Path | `~/Documents/Claude/ddf-intake` | `~/Documents/Claude/command-centre` |
| GitHub | `ExotikPixel/ddf-intake` | `ExotikPixel/flowdesk` |
| Prod URL | `jobs.ddfpixel.com` | `www.getflowdesk.ca` |
| Vercel project | `ddf-intake` (team `info-exotikwrapzs-projects`, **Hobby plan** → crons max 1×/day) | `flowdesk-akv9` (same team) |
| Supabase | `pbgyekhyoihietqjrfpb` — `jobs.id` is **bigint** | `lkxdqwglzcvcgbrojbxd` — ids are **uuid** (has its own unrelated `jobs` table — never run intake SQL here) |
| Purpose | Client-facing: brief intake, design proofs, approvals, per-item chat, client portal | Internal: Kanban job boards, invoices/estimates/receipts (Square), to-dos, crew views |

- **Deploy workflow: push `main` → prod.** No PR gate. Preview builds fail (Supabase env is Production-only) — ignore them.
- **Local CC dev runs on `localhost:4000` and writes to the PRODUCTION Supabase.** Intake's local `.env.local` points its CC webhooks at localhost:4000; **prod env points at getflowdesk.ca** (verified).
- Vercel env vars on flowdesk are **"sensitive"**: `vercel env pull` returns `""` for them. That does NOT mean they're empty.
- A separate SaaS fork lives at `~/Documents/Claude/proofdeck` (own repo/Vercel/Supabase). ddf-intake stays stable; don't SaaS-ify it here.

## Integration contracts (intake → CC)

All secret-gated by `INTAKE_WEBHOOK_SECRET` (header `x-intake-secret`), org resolved via CC's `INTAKE_ADMIN_USER_ID`:

1. **Kanban sync** — `POST /api/intake-kanban-webhook`. One CC project per intake job (`projects.intake_ref` = reference number), one task per event day (`tasks.intake_ref` = `REF::day-YYYY-MM-DD`). Sender: `src/lib/kanban-sync.ts`, fired on every approval + admin resync. Upserts are **race-safe** (23505 → adopt winner / update existing). `done: true` on a ticket forces the CC card to Done (never back to todo).
2. **Invoices** — `POST /api/intake-webhook` → draft invoices, price-catalog auto-match, "Intake Invoices" tab.
3. **Status callback** — CC → intake `src/app/api/cc/status-callback/route.ts` (exists; currently minimal — future job-tracker hook).

### Self-healing Kanban sync (intake side, live 2026-07-03)
On failed push: quiet retries at 30s/90s post-response (Next `after()`) → still failing lands in `kanban_sync_queue` (table: `SUPABASE_KANBAN_RETRY_QUEUE.sql`, already run in prod) with a soft priority-4 ntfy → drained by any later successful sync (limit 3) and by daily cron `GET /api/cron/kanban-retry` (12:00 UTC, `CRON_SECRET` Bearer). Recovery pings priority 3; persistent failure alarms priority 5. **A loud alarm now means CC is genuinely down.**

## Command Centre specifics Claude keeps rediscovering

- **Middleware whitelist**: `middleware.ts` 401s ALL `/api/*` without a session unless the path is in `PUBLIC_API_PREFIXES`. **Every new secret-gated/public endpoint must be added there** (this bit us: `/api/todos/ingest` returned mystery 401s).
- **"Daily Tasks" system project** (`is_system=true`, oldest = id `6d45f714-…`) backs three things: dashboard `WeeklyKanban`, `AIChatBar` (typed AI task-add via `/api/tasks/ai-create`), and the **/todos sidebar board + voice ingest** (below). Selection is `order created_at asc` everywhere (`lib/todos.ts`, `/api/projects/default`) because 3 empty duplicate system projects exist (`4f42536d…`, `fd3c61eb…`, `512b245a…`) — deletion offered, **user has not OK'd it**.
- **Voice to-dos (live 2026-07-04)**: iOS Shortcut → `POST /api/todos/ingest` (`x-todo-secret` = `TODO_INGEST_SECRET`) → Claude Haiku (`claude-haiku-4-5-20251001`, raw-fetch pattern) splits dictation into titled/dated tasks, `source:'voice'` → Daily Tasks board. Parse failure = raw text becomes one task. Setup guide: `VOICE_TODO_SHORTCUT.md` (flowdesk repo). User still needs to build the Shortcut on their phone.
- **Receipts**: enabled purely by `payment_status='paid'` / `deposit_paid_at`. `cc_fee_enabled` (chip) is the 3% card *option*; `cc_fee_applied`+`cc_fee_amount` are what a receipt actually itemises — cheque payments show the clean total. "Email receipt" needs `sent_to_email`/`client_email`. **Manual mark-paid doesn't stamp `paid_at`** → receipt date falls back to today (open item). `invoices` has no `updated_at` column.
- **Print/PDF filenames** come from the page `<title>`: `generateMetadata` on public receipt/invoice/estimate pages + internal invoice detail titles them "Receipt INV-…" etc. New printable pages need the same.
- CC is Next **14.2.15** (sync `params`); intake is Next **16.2.6** (async `params`, read `node_modules/next/dist/docs` before assuming APIs).

## Intake specifics

- Items live as a JSON array on `jobs.items`; **all writes must go through the atomic `update_job_item` RPC** (read-modify-write races lost client approvals once).
- Proof selection: `approvedProofs()` in `src/lib/job-types.ts` honours `designs_mode` ('all'/'pick'/'latest').
- ntfy phone push via `src/lib/ntfy.ts` (`NTFY_TOPIC_URL`); headers must be ASCII.
- Repo-root `SUPABASE_*.sql` files are run manually in the **intake** Supabase SQL editor.

## Shipped this session (2026-07-03 → 04)

| What | Repo / commits |
|---|---|
| CC webhook race fix (project+task 23505 handling) + done-status sync | flowdesk `42db648` |
| Self-healing Kanban sync (queue, cron, quiet retries) | ddf-intake `e6d79eb` + SQL run |
| Voice to-dos + /todos sidebar board + middleware exemption + dedupe-safe project selection | flowdesk `d803a6d`, `a3e980c`, `65f4cbb` |
| PDF filename page titles | flowdesk `b8bf963` |
| **Incident**: 167 Daily Tasks wiped by a bad cleanup, fully restored same hour (titles/dues/statuses kept; original created_at + manual order lost) | see memory `claude-destructive-ops-lesson` |

## Agreed next steps (user-ranked)

1. **Client approval nudges** — cron: items awaiting approval > N days → Brevo reminder email w/ review link; escalate to ntfy at ~5 days. All building blocks exist (Brevo lib, review tokens, per-item status). *User's likely next ask.*
2. **Client-facing job tracker** — CC stage flags (`stage_designed/printed/prepared/installed`) → portal progress bar via the existing status-callback route.
3. **Deposit at approval** — Square payment link generated when admin approves for print; CC already has Square raw-fetch code.
4. **Morning print-schedule digest** — daily ntfy/email of board tickets due in next 7 days, flagging unapproved.
5. Housekeeping: delete 3 dup system projects (needs OK), stamp `paid_at` on manual mark-paid, `SENDER_EMAIL` still on old address pending Brevo domain verify.

## Hard-learned rules for Claude

- Never bulk-delete rows by query in shared tables — capture exact ids your test created and delete only those; SELECT and eyeball before any delete.
- Don't trust a filtered grep to prove code is "orphaned" (`grep -v` filters matching *lines*, including callers).
- Intake SQL goes to `pbgyekhyoihietqjrfpb`, CC SQL to `lkxdqwglzcvcgbrojbxd` — both have a `jobs` table; the wrong one fails (or worse, succeeds).
- New public/secret-gated CC API routes must be whitelisted in `middleware.ts`.
