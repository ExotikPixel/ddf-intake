# Client Experience v2 — Plan C: Portal, Approval, Admin and Emails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ] `) syntax for tracking.

**Goal:** Restyle the client portal, the design-approval page, the admin dashboard and all emails to the approved "soft glass" design, and wire in the Plan B features: progress tracker, deposit card / callout / admin controls, reminder controls, print schedule, and the "On the floor" proof preview.

**Architecture:** New logic is small pure modules with tests (`floor-preview.ts`, `admin-kpis.ts`) plus focused presentational components in `src/components/cx/`. The approval page (`ReviewClient.tsx`, 561 lines) gets a full new render because its layout changes completely (accordion → tabs + stage + side panel). The portal (1,242 lines) and admin (2,792 lines) keep all their state, handlers and API calls: their top-level layout is replaced with full code given here, and the remaining inner blocks are re-skinned with the class mapping in Task 6. Emails move onto Plan B's `renderEmail` layout.

**Tech Stack:** Next.js 16, React 19, `ui.css` (Plan A), `lucide-react`, vitest.

**Spec:** `docs/superpowers/specs/2026-11-15-client-experience-v2-design.md` (A2 Portal / Approval / Admin / Emails; B1–B4 UI).
**Design reference:** `docs/design/client-experience-v2/mockup.html` (Portal, Approval, Admin, Emails tabs) and `src/screens/*.tsx.ref`.
**Prerequisites:** Plans B and A merged (this plan imports `progress.ts`, `deposits.ts`, `reminders.ts`, `local-time.ts`, `email-layout.ts`, the admin reminder/deposit/schedule routes, `ui.css`, `kit.tsx`, `countdown.ts`, `limits.ts`).

---

## Ground rules

- Read `AGENTS.md`. Branch: `git checkout main && git pull && git checkout -b cx2-pages`.
- **Never change what a handler sends to the API or how it updates state** unless a step says so. This plan changes markup and adds features; the approval, upload, edit and add-to-job flows must behave exactly as before.
- Every page sits inside `<div className="cx">` (via `Page` or the admin shell), or `ui.css` won't apply.
- Verify each page at **390 px** and **1360 px** against the mockup before committing it.

## File map

| File | Status | Responsibility |
|---|---|---|
| `src/app/ui.css` | modify | real-image + fixed-drawer additions |
| `src/lib/floor-preview.ts` | create | which pieces get the "On the floor" preview |
| `src/lib/admin-kpis.ts` | create | KPI counts + per-job approval summary |
| `src/components/cx/pills.tsx` | create | approval / job status / deposit pills |
| `src/components/cx/Tracker.tsx` | create | 6-stage progress tracker |
| `src/components/cx/DepositCard.tsx` | create | client deposit card (pay / paid) |
| `src/components/cx/ProofStage.tsx` | create | proof viewer with the floor perspective |
| `src/app/review/[token]/ReviewClient.tsx` | rewrite render | approval page |
| `src/app/api/portal/me/route.ts` | modify | return setup / removal details |
| `src/app/portal/page.tsx` | modify | portal |
| `src/components/admin/JobFeaturesPanel.tsx` | create | reminders, deposit, floor preview flags |
| `src/components/admin/ScheduleAside.tsx` | create | 7-day print schedule panel |
| `src/app/admin/page.tsx` | modify | shell, KPIs, table + drawer |
| `src/lib/email.ts` | rewrite | all existing emails on the branded layout |
| `tests/floor-preview.test.ts`, `tests/admin-kpis.test.ts`, `tests/email-templates.test.ts` | create | tests |

---

### Task 1: Stylesheet additions

**Files:** Modify `src/app/ui.css`

- [ ] **Step 1: Append to `src/app/ui.css`**

```css
/* ── Plan C additions: real proof images, app-sized drawer ───────────── */
.cx a.floor { display: block; }
.cx .floor img { display: block; width: 100%; height: auto; border-radius: 6px; background: #fff; }
.cx .opt img { display: block; width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 10px; background: #fff; }
.cx .item-card .thumb img { width: 100%; height: 100%; object-fit: cover; }
.cx .drawer { position: fixed; z-index: 100; overflow-y: auto; }
.cx .drawer-backdrop { position: fixed; inset: 0; z-index: 99; background: rgba(18,18,18,.18); }
.cx .earlier { display: flex; gap: 8px; flex-wrap: wrap; }
.cx .earlier a { width: 64px; height: 64px; border-radius: 12px; overflow: hidden; opacity: .75; border: 1px solid var(--line); background: #fff; }
.cx .earlier img { width: 100%; height: 100%; object-fit: cover; }
.cx .admin-main { padding: 22px 22px 60px; display: grid; gap: 22px; align-content: start; min-width: 0; }
```

- [ ] **Step 2: Commit**

```bash
git add src/app/ui.css
git commit -m "style: soft-glass additions for real proof images and the admin drawer"
```

---

### Task 2: Floor preview rule + admin KPIs (pure logic)

**Files:** Create `src/lib/floor-preview.ts`, `src/lib/admin-kpis.ts`; Test `tests/floor-preview.test.ts`, `tests/admin-kpis.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/floor-preview.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { wantsFloorPreview } from '@/lib/floor-preview'

describe('wantsFloorPreview', () => {
  it('uses the admin flag first', () => {
    expect(wantsFloorPreview({ name: 'Welcome sign', preview: 'floor' })).toBe(true)
    expect(wantsFloorPreview({ name: 'Monogram dance floor wrap', preview: 'flat' })).toBe(false)
  })
  it('otherwise detects floor pieces by name', () => {
    expect(wantsFloorPreview({ name: 'Monogram dance floor wrap' })).toBe(true)
    expect(wantsFloorPreview({ name: 'Floor decal 16x16' })).toBe(true)
    expect(wantsFloorPreview({ name: 'Nov 19 - Dancefloor' })).toBe(true)
    expect(wantsFloorPreview({ name: 'Welcome sign' })).toBe(false)
    expect(wantsFloorPreview({ name: 'Floral arch' })).toBe(false)
  })
})
```

`tests/admin-kpis.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { adminKpis, approvalSummary, jobWaiting } from '@/lib/admin-kpis'
import type { JobItem } from '@/lib/job-types'

const proofed = (approval_status?: JobItem['approval_status']): JobItem => ({ name: 'X', quantity: 1, size: '', material: 'pvc', proof_urls: ['uploads/a.png'], approval_status })
const job = (over: Record<string, unknown>) => ({ status: 'received', date_required: '2026-11-18', items: [proofed('approved')], deposit: null, ...over })
const TODAY = '2026-11-15'

describe('admin KPIs', () => {
  it('approvalSummary counts proofed pieces only', () => {
    expect(approvalSummary([proofed('approved'), proofed(), { name: 'Y', quantity: 1, size: '', material: 'pvc' }])).toEqual({ approved: 1, total: 2 })
  })
  it('jobWaiting: a proof is out and not yet approved', () => {
    expect(jobWaiting(job({ items: [proofed()] }))).toBe(true)
    expect(jobWaiting(job({ items: [proofed('changes_requested')] }))).toBe(false)
    expect(jobWaiting(job({}))).toBe(false)
  })
  it('counts the four cards', () => {
    const k = adminKpis([
      job({ items: [proofed()] }),                                        // waiting, due in 3 days
      job({ date_required: '2026-11-30' }),                               // not soon
      job({ status: 'in_progress', deposit: { status: 'sent' } }),        // production, deposit due, soon
      job({ status: 'completed', items: [proofed()] }),                   // closed: ignored
    ], TODAY)
    expect(k).toEqual({ awaiting: 1, soon: 2, inProduction: 1, depositsOutstanding: 1 })
  })
})
```

- [ ] **Step 2: Run them to see them fail** — `npx vitest run tests/floor-preview.test.ts tests/admin-kpis.test.ts` → FAIL (modules missing).

- [ ] **Step 3: Create `src/lib/floor-preview.ts`**

```ts
import type { JobItem } from '@/lib/job-types'

// Spec default ⚑4: the "On the floor" perspective preview shows for pieces whose
// name says floor (dance floor wraps, floor decals), unless the admin flagged the
// piece with preview: 'floor' | 'flat' in the job drawer.
export function wantsFloorPreview(item: Pick<JobItem, 'name' | 'preview'>): boolean {
  if (item.preview === 'floor') return true
  if (item.preview === 'flat') return false
  return /floor/i.test(item.name)
}
```

- [ ] **Step 4: Create `src/lib/admin-kpis.ts`**

```ts
import { itemProofs } from '@/lib/job-types'
import type { JobItem } from '@/lib/job-types'
import { addDays } from '@/lib/local-time'

export interface KpiJob { status: string; date_required: string; items: JobItem[]; deposit?: { status?: string } | null }

/** Approved vs proofed pieces (pieces without a proof don't count yet). */
export function approvalSummary(items: JobItem[]): { approved: number; total: number } {
  const proofed = (items ?? []).filter(it => itemProofs(it).length > 0)
  return { approved: proofed.filter(it => it.approval_status === 'approved').length, total: proofed.length }
}

/** A proof is with the client and they haven't answered (changes requested = ball is with the shop). */
export function jobWaiting(job: KpiJob): boolean {
  return (job.items ?? []).some(it => itemProofs(it).length > 0 && (it.approval_status ?? 'pending') === 'pending')
}

const open = (j: KpiJob) => j.status !== 'completed' && j.status !== 'cancelled'

export function adminKpis(jobs: KpiJob[], today: string) {
  const end = addDays(today, 6)
  return {
    awaiting: jobs.filter(j => open(j) && jobWaiting(j)).length,
    soon: jobs.filter(j => open(j) && j.date_required >= today && j.date_required <= end).length,
    inProduction: jobs.filter(j => j.status === 'in_progress').length,
    depositsOutstanding: jobs.filter(j => j.deposit?.status === 'sent').length,
  }
}
```

- [ ] **Step 5: Run** — `npx vitest run tests/floor-preview.test.ts tests/admin-kpis.test.ts` → 5 passed.

- [ ] **Step 6: Commit**

```bash
git add src/lib/floor-preview.ts src/lib/admin-kpis.ts tests/floor-preview.test.ts tests/admin-kpis.test.ts
git commit -m "feat: floor-preview rule + admin KPI helpers"
```

---

### Task 3: Shared client components

**Files:** Create `src/components/cx/pills.tsx`, `src/components/cx/Tracker.tsx`, `src/components/cx/DepositCard.tsx`, `src/components/cx/ProofStage.tsx`

- [ ] **Step 1: `src/components/cx/pills.tsx`**

```tsx
import { Pill } from '@/components/cx/kit'
import type { ApprovalStatus } from '@/lib/job-types'

export function ApprovalPill({ status }: { status: ApprovalStatus | undefined }) {
  if (status === 'approved') return <Pill tone="ok">Approved</Pill>
  if (status === 'changes_requested') return <Pill tone="alert">Changes requested</Pill>
  return <Pill tone="wait">Needs you</Pill>
}

export function JobStatusPill({ status }: { status: string }) {
  if (status === 'in_progress') return <Pill tone="gold">In production</Pill>
  if (status === 'completed') return <Pill tone="ok">Completed</Pill>
  if (status === 'cancelled') return <Pill tone="alert">Cancelled</Pill>
  return <Pill tone="neutral">Received</Pill>
}

export function DepositPill({ status }: { status: string | undefined }) {
  if (status === 'paid') return <Pill tone="ok">Paid</Pill>
  if (status === 'sent') return <Pill tone="wait">Link sent</Pill>
  return <Pill tone="neutral">Not requested</Pill>
}
```

- [ ] **Step 2: `src/components/cx/Tracker.tsx`**

```tsx
import { Check } from 'lucide-react'
import type { Stage } from '@/lib/progress'
import { prettyDate } from '@/lib/countdown'

export function Tracker({ stages }: { stages: Stage[] }) {
  return (
    <ol className="track" aria-label="Job progress" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {stages.map(s => (
        <li key={s.key} className="track-step" data-state={s.state} aria-current={s.state === 'current' ? 'step' : undefined}>
          <span className="dot">{s.state === 'done' && <Check size={12} />}</span>
          <span className="stack" style={{ gap: 2 }}>
            <span className="t-name">{s.label}</span>
            <span className="tiny muted">{s.detail ?? (s.date ? prettyDate(s.date) : s.state === 'current' ? 'Now' : '')}</span>
          </span>
        </li>
      ))}
    </ol>
  )
}
```

- [ ] **Step 3: `src/components/cx/DepositCard.tsx`**

```tsx
import { Lock } from 'lucide-react'
import { Pill } from '@/components/cx/kit'
import { money } from '@/lib/email-layout'
import { prettyDate } from '@/lib/countdown'
import type { PublicDeposit } from '@/lib/deposits'

/** Portal side card. Shown only when the shop has requested a deposit. */
export function DepositCard({ deposit }: { deposit: PublicDeposit }) {
  const paid = deposit.status === 'paid'
  return (
    <div className="panel" style={{ padding: 22, display: 'grid', gap: 12 }}>
      <div className="between"><span className="label">Deposit</span>{paid && <Pill tone="ok">Paid</Pill>}</div>
      <div className="display num" style={{ fontSize: 34 }}>{money(deposit.amount_cents)}</div>
      {paid ? (
        <span className="small muted">Received{deposit.paid_at ? ` ${prettyDate(deposit.paid_at.slice(0, 10))}` : ''}. Thank you, your date is booked.</span>
      ) : (
        <>
          <span className="small muted">Secures your date and starts production.</span>
          {deposit.url && (
            <a className="btn btn-ink btn-block" href={deposit.url} target="_blank" rel="noopener noreferrer"><Lock size={14} /> Pay securely with Square</a>
          )}
          <span className="tiny muted">Card, Apple Pay or Google Pay on Square’s secure page.</span>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 4: `src/components/cx/ProofStage.tsx`**

```tsx
// Light "studio" stage for one proof. With floor=true and view='floor' the image
// tilts into a perspective "on the floor" preview (CSS 3D, .floor[data-view=floor]).
export function ProofStage({ src, href, alt, floor, view, note }: {
  src?: string; href?: string; alt: string; floor: boolean; view: 'floor' | 'flat'; note?: string
}) {
  return (
    <div className="stage">
      <a className="floor" data-view={floor ? view : 'flat'} href={href ?? src} target="_blank" rel="noopener noreferrer"
        style={{ width: floor ? undefined : 'min(70%, 440px)' }} aria-label={`${alt} (opens full size)`}>
        {src
          ? <img src={src} alt={alt} />
          : <span className="small muted" style={{ display: 'grid', placeItems: 'center', aspectRatio: '1', background: '#fff', borderRadius: 6 }}>Loading proof…</span>}
      </a>
      {note && <span className="stage-note muted">{note}</span>}
    </div>
  )
}
```

- [ ] **Step 5: Type-check** — `npx tsc --noEmit` → no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/cx/pills.tsx src/components/cx/Tracker.tsx src/components/cx/DepositCard.tsx src/components/cx/ProofStage.tsx
git commit -m "feat(ui): pills, progress tracker, deposit card, proof stage"
```

---

### Task 4: Approval page (`/review/[token]`)

**Files:** Modify `src/app/review/[token]/ReviewClient.tsx`

Keeps: the data fetch, `refresh`, `submit`, `submitAll` and every API call, unchanged. Changes: tabs instead of an accordion, a proof stage with the "On the floor" toggle, an inline conversation instead of the chat drawer, the deposit callout once everything is approved.

- [ ] **Step 1: Imports and types.** Replace the import block and `ReviewData` with:

```tsx
'use client'

import { useEffect, useState } from 'react'
import { Check, Lock, MessageSquare } from 'lucide-react'
import { itemProofs, itemExamplePhotos, itemThread, designsMode } from '@/lib/job-types'
import type { JobItem, ApprovalStatus } from '@/lib/job-types'
import { Page, SiteHead, SiteFoot } from '@/components/cx/kit'
import { ApprovalPill } from '@/components/cx/pills'
import { ProofStage } from '@/components/cx/ProofStage'
import { wantsFloorPreview } from '@/lib/floor-preview'
import { daysUntil, countdownLabel, prettyDate } from '@/lib/countdown'
import { money } from '@/lib/email-layout'
import type { PublicDeposit } from '@/lib/deposits'

interface ReviewData {
  reference_number: string
  event_name: string | null
  date_required: string
  items: JobItem[]
  proofUrls: Record<string, string>
  fileUrls?: Record<string, string>   // signed originals for PDF/AI/EPS proofs (thumbnail is a preview/tile)
  clientName: string
  shopName: string
  deposit: PublicDeposit | null
  jobType?: string
}
```
Delete the old `ApprovalPill` function and the `useRef` / `chatBodyRef` / chat-scroll `useEffect` (the conversation is inline now). Keep `fmtWhen`.

- [ ] **Step 2: State.** Replace `openIdx` and `chatOpen` with:

```tsx
  const [active, setActive] = useState<number | null>(null)            // item index on the stage
  const [viewing, setViewing] = useState<Record<number, string>>({})    // item index → proof shown on the stage
  const [view, setView] = useState<'floor' | 'flat'>('floor')
  const [asking, setAsking] = useState<number | null>(null)             // item index with the change box open
  const [toast, setToast] = useState('')
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 2600); return () => clearTimeout(t) }, [toast])
```
At the end of the success path in `submit` (after `setNoteDraft(...)`) add:

```tsx
      if (action === 'approve') {
        setToast(`${data?.items[idx]?.name ?? 'Design'} approved`)
        const next = (items as JobItem[]).findIndex((x, j) => j !== idx && itemProofs(x).length > 0 && x.approval_status !== 'approved')
        if (next >= 0) setTimeout(() => setActive(next), 700)
      } else {
        setAsking(null)
        setToast('Sent. We’ll send a revised proof.')
      }
```

- [ ] **Step 3: Loading / invalid states.** Replace the two early returns with:

```tsx
  const brand = { businessName: data?.shopName ?? 'DDF x Pixel', logoUrl: '/logo-ddfpixel.png', replyToEmail: null }

  if (loading) {
    return <Page><SiteHead brand={brand} /><p className="muted" style={{ padding: '80px 0', textAlign: 'center' }}>Loading your proofs…</p></Page>
  }
  if (invalid || !data) {
    return (
      <Page>
        <SiteHead brand={brand} />
        <section className="panel" style={{ padding: 32, maxWidth: 480, margin: '60px auto', display: 'grid', gap: 10 }}>
          <h1 className="display" style={{ margin: 0, fontSize: 34 }}>Link not <span className="serif">valid.</span></h1>
          <p className="muted" style={{ margin: 0 }}>This approval link is invalid or has expired. Ask us for a fresh one, or open your job page.</p>
          <a className="btn btn-ink" href="/portal" style={{ justifySelf: 'start' }}>Open my job page</a>
        </section>
      </Page>
    )
  }
```

- [ ] **Step 4: Replace the main `return (…)` (from `const reviewable = …` through the end of the component, and the old `Shell` function) with:**

```tsx
  const reviewable = data.items.map((it, idx) => ({ it, idx })).filter(x => itemProofs(x.it).length > 0)
  const approvedCount = reviewable.filter(x => x.it.approval_status === 'approved').length
  const allDone = reviewable.length > 0 && approvedCount === reviewable.length
  const days = daysUntil(data.date_required)
  const isProduct = data.jobType === 'product'
  const cur = reviewable.find(x => x.idx === active) ?? reviewable.find(x => x.it.approval_status !== 'approved') ?? reviewable[0]

  return (
    <Page>
      <SiteHead brand={brand} right={<span className="muted hide-sm">{data.event_name || data.reference_number}</span>} />

      <section style={{ padding: '34px 0 18px', display: 'grid', gap: 8 }}>
        <span className="eyebrow">Design approval</span>
        <h1 className="display" style={{ margin: 0, fontSize: 'clamp(34px, 5vw, 56px)' }}>
          {allDone ? <>Everything is <span className="serif">approved.</span></> : <>Your designs are <span className="serif">ready.</span></>}
        </h1>
        <p className="muted" style={{ margin: 0 }}>
          {data.reference_number} · {isProduct ? 'Needed by' : 'Event'} {prettyDate(data.date_required)} · {countdownLabel(days)}
        </p>
      </section>

      {reviewable.length === 0 || !cur ? (
        <div className="panel" style={{ padding: 28 }}>Your proofs aren’t ready yet. We’ll email you as soon as they are.</div>
      ) : (
        <>
          <div className="tabs glass" role="tablist" aria-label="Pieces">
            {reviewable.map(({ it, idx }) => (
              <button key={idx} role="tab" className="tab" aria-selected={idx === cur.idx} onClick={() => { setActive(idx); setAsking(null) }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: it.approval_status === 'approved' ? '#7fa487' : it.approval_status === 'changes_requested' ? 'var(--rose)' : 'var(--mauve)' }} />
                {it.name}
              </button>
            ))}
          </div>

          {allDone && (
            <div className="callout stack-sm" style={{ marginTop: 22, background: 'var(--sage-wash)' }}>
              {data.deposit?.status === 'sent' && data.deposit.url ? (
                <>
                  <div><b>Everything is approved — thank you.</b><div className="small muted">Secure your date with your {money(data.deposit.amount_cents)} deposit. Production starts once it’s paid.</div></div>
                  <a className="btn btn-ink" href={data.deposit.url} target="_blank" rel="noopener noreferrer"><Lock size={14} /> Pay deposit</a>
                </>
              ) : data.deposit?.status === 'paid' ? (
                <div><b>Approved and deposit received — thank you.</b><div className="small muted">Your pieces are booked into production.</div></div>
              ) : (
                <div><b>Everything is approved — thank you.</b><div className="small muted">We’ll get these into production.</div></div>
              )}
            </div>
          )}

          {reviewable.length > 1 && !allDone && (
            <div className="callout stack-sm" style={{ marginTop: 22 }}>
              <div><b>Happy with everything?</b><div className="small muted">{approvedCount} of {reviewable.length} approved. Approve the rest in one go.</div>{allMsg && <div className="small" style={{ color: 'var(--rose)', marginTop: 4 }}>{allMsg}</div>}</div>
              <button type="button" className="btn btn-forest" onClick={submitAll} disabled={actioningAll}><Check size={15} /> {actioningAll ? 'Approving…' : 'Approve all'}</button>
            </div>
          )}

          {(() => {
            const { it, idx } = cur
            const status: ApprovalStatus = it.approval_status ?? 'pending'
            const proofs = itemProofs(it)
            const mode = designsMode(it)
            const latestMode = proofs.length > 1 && mode === 'latest'
            const shown = latestMode ? proofs.slice(0, 1) : proofs
            const multi = shown.length > 1
            const pickMode = multi && mode === 'pick'
            const isApproved = status === 'approved'
            const chosen = isApproved ? it.approved_proof_url : selected[idx]
            const onStage = (pickMode ? chosen : undefined) ?? viewing[idx] ?? shown[0]
            const floor = wantsFloorPreview(it)
            const busy = actioning === idx
            const needsPick = pickMode && !selected[idx]
            const thread = itemThread(it)
            const examples = itemExamplePhotos(it)
            return (
              <div className="split" style={{ marginTop: 26, gridTemplateColumns: 'minmax(0,1fr) 380px' }}>
                <div className="stack" style={{ gap: 14 }}>
                  <ProofStage
                    src={data.proofUrls[onStage]} href={data.fileUrls?.[onStage] ?? data.proofUrls[onStage]}
                    alt={`Design for ${it.name}`} floor={floor} view={view}
                    note={floor && view === 'floor' ? 'Preview on the floor · not to scale' : [it.size, it.material].filter(Boolean).join(' · ')}
                  />
                  <div className="between stack-sm">
                    {multi ? (
                      <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
                        <span className="label">{pickMode ? (isApproved ? 'Chosen design' : 'Pick one') : `${shown.length} designs · all printed`}</span>
                        <div className="optrail">
                          {shown.map((p, pi) => (
                            <button key={p} type="button" className="opt"
                              aria-pressed={p === onStage}
                              disabled={pickMode && isApproved && p !== chosen}
                              onClick={() => {
                                setViewing(v => ({ ...v, [idx]: p }))
                                if (pickMode && !isApproved) { setSelected(s => ({ ...s, [idx]: p })); setErr(e => ({ ...e, [idx]: '' })) }
                              }}>
                              {data.proofUrls[p] ? <img src={data.proofUrls[p]} alt="" /> : <span className="tiny muted">…</span>}
                              <span>{pickMode ? `Option ${String.fromCharCode(65 + pi)}` : `Design ${pi + 1}`}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : <span className="small muted">Tap the design to open it full size.</span>}
                    {floor && (
                      <div className="seg light">
                        <button type="button" aria-pressed={view === 'flat'} onClick={() => setView('flat')}>Flat artwork</button>
                        <button type="button" aria-pressed={view === 'floor'} onClick={() => setView('floor')}>On the floor</button>
                      </div>
                    )}
                  </div>
                  {data.fileUrls?.[onStage] && (
                    <a className="link tiny" href={data.fileUrls[onStage]} target="_blank" rel="noopener noreferrer">Open the {onStage.split('.').pop()?.toUpperCase()} file</a>
                  )}
                  {latestMode && (
                    <div className="stack" style={{ gap: 8 }}>
                      <span className="label">Earlier designs</span>
                      <div className="earlier">{proofs.slice(1).map((p, vi) => <a key={p} href={data.proofUrls[p]} target="_blank" rel="noopener noreferrer" title={`Earlier design ${vi + 1}`}>{data.proofUrls[p] && <img src={data.proofUrls[p]} alt="" />}</a>)}</div>
                    </div>
                  )}
                  {(it.proof_history?.length ?? 0) > 0 && (
                    <div className="stack" style={{ gap: 8 }}>
                      <span className="label">Earlier versions</span>
                      <div className="earlier">{it.proof_history!.map((p, vi) => <a key={p} href={data.proofUrls[p]} target="_blank" rel="noopener noreferrer" title={`Version ${vi + 1}`}>{data.proofUrls[p] && <img src={data.proofUrls[p]} alt="" />}</a>)}</div>
                    </div>
                  )}
                  {examples.length > 0 && (
                    <div className="panel" style={{ padding: 18, display: 'grid', gap: 10 }}>
                      <span className="label">Inspiration &amp; examples</span>
                      <p className="small muted" style={{ margin: 0 }}>For reference only. These are <b>not</b> your artwork and are <b>not</b> printed.</p>
                      <div className="earlier">{examples.map(p => <a key={p} href={data.proofUrls[p]} target="_blank" rel="noopener noreferrer">{data.proofUrls[p] && <img src={data.proofUrls[p]} alt="Example" />}</a>)}</div>
                    </div>
                  )}
                </div>

                <aside className="stack" style={{ gap: 18, alignContent: 'start' }}>
                  <div className="between"><b style={{ fontSize: 18 }}>{it.name}</b><ApprovalPill status={status} /></div>
                  <div className="small muted">{it.quantity} × {[it.size, it.material].filter(Boolean).join(' · ')}</div>
                  {it.description && <p className="small" style={{ margin: 0 }}><span className="muted">Your brief: </span>{it.description}</p>}
                  {it.admin_note && <div className="msg shop"><div className="tiny muted" style={{ marginBottom: 3 }}>A note from us</div>{it.admin_note}</div>}

                  {!isApproved && asking !== idx && (
                    <div className="stack" style={{ gap: 10 }}>
                      <button type="button" className="btn btn-forest btn-block" onClick={() => submit(idx, 'approve', proofs)} disabled={busy || needsPick}>
                        <Check size={15} /> {busy ? 'Saving…' : needsPick ? 'Choose a design first' : pickMode ? 'Approve this option' : 'Approve this design'}
                      </button>
                      <button type="button" className="btn btn-quiet btn-block" onClick={() => setAsking(idx)}>Request changes</button>
                    </div>
                  )}
                  {(asking === idx) && (
                    <div className="stack" style={{ gap: 10 }}>
                      <label className="label" htmlFor={`chg-${idx}`}>{isApproved ? 'Message us' : 'What should we change?'}</label>
                      <textarea id={`chg-${idx}`} className="input" autoFocus value={noteDraft[idx] ?? ''}
                        onChange={e => setNoteDraft(prev => ({ ...prev, [idx]: e.target.value }))}
                        placeholder="e.g. Make the date larger and use our full names." />
                      <div className="row">
                        <button type="button" className="btn btn-ink btn-sm" disabled={busy || !(noteDraft[idx] ?? '').trim()} onClick={() => submit(idx, 'request_changes', proofs)}>{busy ? 'Sending…' : 'Send to designer'}</button>
                        <button type="button" className="link tiny" onClick={() => setAsking(null)}>Cancel</button>
                      </div>
                      <span className="tiny muted">Sending a message asks for changes on this design.</span>
                    </div>
                  )}
                  {isApproved && asking !== idx && (
                    <p className="small muted" style={{ margin: 0 }}>Approved. Changed your mind? <button type="button" className="link" onClick={() => setAsking(idx)}>Message us</button> and we’ll reopen it.</p>
                  )}
                  {err[idx] && <p className="err" role="alert">{err[idx]}</p>}

                  <hr className="rule" />
                  <div className="row label" style={{ gap: 8 }}><MessageSquare size={13} /> Conversation</div>
                  {thread.length === 0 ? (
                    <p className="small muted" style={{ margin: 0 }}>No messages yet.</p>
                  ) : (
                    <div className="stack" style={{ gap: 8 }}>
                      {thread.map((m, k) => (
                        <div key={k} className={`msg ${m.from}`}>
                          <div className="tiny muted" style={{ marginBottom: 3 }}>{m.from === 'shop' ? `${data.shopName} team` : 'You'}{m.at ? ` · ${fmtWhen(m.at)}` : ''}</div>
                          {m.text}
                        </div>
                      ))}
                    </div>
                  )}
                </aside>
              </div>
            )
          })()}
        </>
      )}

      <p className="small muted" style={{ marginTop: 40 }}>
        Need to add pieces or change your brief? <a className="link" href="/portal">Open your job page</a> with your reference and email.
      </p>
      <SiteFoot brand={brand} />
      {toast && <div className="toast" role="status">{toast}</div>}
    </Page>
  )
}
```
Also replace `toLocaleDateString('en-ZA'` / `toLocaleTimeString('en-ZA'` in `fmtWhen` with `'en-CA'`.

- [ ] **Step 5: Check**

Run: `npx tsc --noEmit && npm run lint && npm run build` → clean.
Then, with a local test job that has (a) a floor-named piece with two "pick" designs and (b) a sign with one design: open its review link (admin → copy review link) at 1360 px and 390 px and confirm against the mockup's Approval tab:
1. Tabs switch pieces; dots are mauve / sage / rose by status.
2. Floor piece: "On the floor" tilts the proof; "Flat artwork" straightens it. The sign has no toggle.
3. Pick mode: options A/B; approve stays disabled until one is picked; after approving, the other option is disabled.
4. Request changes → message appears in the conversation, pill turns rose, toast shows.
5. Approve all on a job with several waiting pieces.
6. With a deposit link sent (Plan B Task 9), the green callout shows "Pay deposit" once everything is approved.

- [ ] **Step 6: Commit**

```bash
git add "src/app/review/[token]/ReviewClient.tsx"
git commit -m "feat(review): soft-glass approval page with floor preview, inline conversation, deposit callout"
```

---

### Task 5: Client portal (`/portal`)

**Files:** Modify `src/app/api/portal/me/route.ts`, `src/app/portal/page.tsx`

The portal keeps every handler (`handleLookup`, `submitApproval`, `uploadFinalDesign`, edit and add-to-job, `signOut`). This task replaces the page frame, the lookup screen and each job's header, and adds the hero, tracker, waiting callout, deposit card and details panel. Task 6 re-skins the inner blocks.

- [ ] **Step 1: Return the job's logistics.** In `src/app/api/portal/me/route.ts`, add `'setup_location', 'setup_time', 'removal_location', 'removal_time'` to the `getJob` columns.

- [ ] **Step 2: Imports and types in `src/app/portal/page.tsx`.** Add:

```tsx
import { Plus, Home, MessageCircle } from 'lucide-react'
import { Page, SiteHead, SiteFoot, SecHead } from '@/components/cx/kit'
import { JobStatusPill } from '@/components/cx/pills'
import { Tracker } from '@/components/cx/Tracker'
import { DepositCard } from '@/components/cx/DepositCard'
import { daysUntil, countdownLabel, prettyDate } from '@/lib/countdown'
import type { Stage } from '@/lib/progress'
import type { PublicDeposit } from '@/lib/deposits'

const BRAND = { businessName: 'DDF x Pixel', logoUrl: '/logo-ddfpixel.png', replyToEmail: 'hello@ddfevents.ca' }
const HANDOVER: Record<string, string> = { pickup: 'Pickup at our shop', delivery: 'Delivery', install: 'Install' }
```
Add to `interface Job`:
```ts
  job_type?: 'event' | 'product'
  fulfillment?: 'pickup' | 'delivery' | 'install' | null
  setup_location?: string | null
  setup_time?: string | null
  removal_location?: string | null
  removal_time?: string | null
  stages?: Stage[]
  deposit?: PublicDeposit | null
```
Delete the local `StatusPill` and `ApprovalPill` functions and import `ApprovalPill` from `@/components/cx/pills` alongside `JobStatusPill` (same props; `ApprovalPill` accepts `undefined` too).

- [ ] **Step 3: Lookup screen.** Replace the whole `if (needsLookup) { return (…) }` block with:

```tsx
  if (needsLookup) {
    return (
      <Page>
        <SiteHead brand={BRAND} right={<a className="btn btn-quiet btn-sm" href="/">Send a brief</a>} />
        <section style={{ padding: '64px 0', display: 'grid', placeItems: 'center' }}>
          <form className="panel" style={{ padding: 32, width: '100%', maxWidth: 440, display: 'grid', gap: 18 }} onSubmit={handleLookup}>
            <span className="eyebrow">Track your job</span>
            <h1 className="display" style={{ margin: 0, fontSize: 34 }}>Find your <span className="serif">job.</span></h1>
            <p className="small muted" style={{ margin: 0 }}>Use the reference from your confirmation email and the email you sent the brief from. No password needed.</p>
            <div className="field">
              <label className="label" htmlFor="lk-ref">Reference number</label>
              <input id="lk-ref" className="input" value={lookupRef} onChange={e => setLookupRef(e.target.value)} required placeholder="DDF-20260722-A1B2C3" autoCapitalize="characters" autoCorrect="off" spellCheck={false} />
            </div>
            <div className="field">
              <label className="label" htmlFor="lk-mail">Email</label>
              <input id="lk-mail" type="email" className="input" value={lookupEmail} onChange={e => setLookupEmail(e.target.value)} required placeholder="you@company.com" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
            </div>
            {lookupError && <div className="alert" role="alert">{lookupError}</div>}
            <button className="btn btn-ink btn-block" type="submit" disabled={lookingUp}>{lookingUp ? 'Looking up…' : 'Open my job'}</button>
            <span className="tiny muted">Lost your reference? Email <a className="link" href={`mailto:${BRAND.replyToEmail}`}>{BRAND.replyToEmail}</a></span>
          </form>
        </section>
        <SiteFoot brand={BRAND} />
      </Page>
    )
  }
```

- [ ] **Step 4: Page frame.** Replace the main `return (` wrapper's opening — the outer `<div>`, `{/* Header */}`, `{/* Page title bar */}`, the content container `<div>`, the loading and empty states and `{/* Summary row */}` — with:

```tsx
  return (
    <Page>
      <SiteHead brand={BRAND} right={<><span className="muted hide-sm">{email}</span><button type="button" className="btn btn-quiet btn-sm" onClick={signOut}>{usingToken ? 'Another job' : 'Sign out'}</button></>} />
      {loading ? (
        <p className="muted" style={{ padding: '80px 0', textAlign: 'center' }}>Loading your job…</p>
      ) : jobs.length === 0 ? (
        <section className="panel" style={{ padding: 32, maxWidth: 480, margin: '60px auto', display: 'grid', gap: 12 }}>
          <h1 className="display" style={{ margin: 0, fontSize: 34 }}>No jobs <span className="serif">yet.</span></h1>
          <p className="muted" style={{ margin: 0 }}>Send your first brief and we’ll come back with a quote.</p>
          <a className="btn btn-ink" href="/" style={{ justifySelf: 'start' }}>Send a brief</a>
        </section>
      ) : (
        <>
          {jobs.map(job => {
```
and, at the other end, replace everything after the job card's last panel (`{/* Add-to-Job panel … */}` block) — the closing tags of the old job card, list, container, `{/* Footer */}` and the footer — with the matching close of the structure in Step 5 plus:

```tsx
          })}
        </>
      )}
      <SiteFoot brand={BRAND} />
    </Page>
  )
```
(Delete the `active` / `completed` counters; nothing uses them now.)

- [ ] **Step 5: Each job.** Replace the job card's opening and header — from `<div key={job.id} …>` down to (not including) `{/* ── Design proofs / approvals ─── */}` — with:

```tsx
            const days = daysUntil(job.date_required)
            const isProduct = job.job_type === 'product'
            const waiting = proofItems.filter(x => (x.it.approval_status ?? 'pending') === 'pending').length
            const unproofed = job.items.map((it, idx) => ({ it, idx })).filter(x => itemProofs(x.it).length === 0)
            const place = isProduct
              ? (job.fulfillment === 'pickup' ? HANDOVER.pickup : [HANDOVER[job.fulfillment ?? ''] , job.setup_location].filter(Boolean).join(' · '))
              : job.setup_location
            return (
              <article key={job.id} className="stack" style={{ gap: 22, marginBottom: 48 }}>
                <section className="split" style={{ padding: '40px 0 6px', alignItems: 'end' }}>
                  <div className="stack" style={{ gap: 10 }}>
                    <span className="row" style={{ gap: 10 }}><span className="eyebrow">Your job</span><JobStatusPill status={job.status} /></span>
                    <h1 className="display hero-title" style={{ margin: 0 }}>{job.event_name || job.reference_number}</h1>
                    <p className="muted" style={{ margin: 0 }}>{[place, `${isProduct ? 'Needed by' : 'Event'} ${prettyDate(job.date_required)}`].filter(Boolean).join(' · ')}</p>
                  </div>
                  <div className="ticket">
                    <div className="between"><span className="t-label">Reference</span><span className="t-label">Countdown</span></div>
                    <div className="between" style={{ marginTop: 8 }}>
                      <span className="t-ref">{job.reference_number}</span>
                      <span className="display num" style={{ fontSize: 40, color: '#fff' }}>{days > 1 ? <>{days}<span className="small" style={{ marginLeft: 6, color: 'rgba(243,238,241,.65)', letterSpacing: 0 }}>days</span></> : countdownLabel(days)}</span>
                    </div>
                  </div>
                </section>

                {job.stages && job.stages.length > 0 && (
                  <section className="panel" style={{ padding: '24px 24px 22px' }}>
                    <div className="between" style={{ marginBottom: 20 }}><span className="label">Progress</span><span className="tiny muted hide-sm">Updates automatically from our production board</span></div>
                    <Tracker stages={job.stages} />
                  </section>
                )}

                <div className="split">
                  <div className="stack" style={{ gap: 22, minWidth: 0 }}>
                    {waiting > 0 && (
                      <div className="callout stack-sm">
                        <div><b>{waiting} design{waiting === 1 ? ' is' : 's are'} waiting for your approval.</b><div className="small muted">We make everything as soon as it’s approved.</div></div>
                        <button type="button" className="btn btn-ink" onClick={() => document.getElementById(`proofs-${job.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>Review designs</button>
                      </div>
                    )}
                    {unproofed.length > 0 && (
                      <section className="stack" style={{ gap: 12 }}>
                        <SecHead n="01" title="In design" aside={<span className="tiny muted">{unproofed.length} piece{unproofed.length === 1 ? '' : 's'}</span>} />
                        {unproofed.map(({ it, idx }) => (
                          <article key={idx} className="item-card" style={{ gridTemplateColumns: '1fr' }}>
                            <div className="between" style={{ alignItems: 'start' }}>
                              <span className="stack" style={{ gap: 4 }}><b>{it.name}</b><span className="small muted">{it.quantity} × {[it.size, it.material].filter(Boolean).join(' · ')}</span></span>
                              <span className="pill pill-neutral">Designing</span>
                            </div>
                          </article>
                        ))}
                      </section>
                    )}
```
Then add `id={`proofs-${job.id}`}` to the container element that the existing `{proofItems.length > 0 && (` renders, and close the left column and add the aside **after** the existing `{/* Add-to-Job panel */}` block:

```tsx
                  </div>
                  <aside className="sticky stack" style={{ gap: 16 }}>
                    {job.deposit && <DepositCard deposit={job.deposit} />}
                    <div className="panel" style={{ padding: 22, display: 'grid', gap: 10 }}>
                      <span className="label">Details</span>
                      <div className="small"><span className="muted">Sent</span><br />{prettyDate(job.submitted_at.slice(0, 10))}</div>
                      {!isProduct && job.setup_location && <div className="small"><span className="muted">Setup</span><br />{[job.setup_time, job.setup_location].filter(Boolean).join(' · ')}</div>}
                      {!isProduct && job.removal_location && <div className="small"><span className="muted">Removal</span><br />{[job.removal_time, job.removal_location].filter(Boolean).join(' · ')}</div>}
                      {isProduct && <div className="small"><span className="muted">Hand-over</span><br />{place || '—'}{job.setup_time ? ` · ${job.setup_time}` : ''}</div>}
                      {job.notes && <div className="small"><span className="muted">Notes</span><br />{job.notes}</div>}
                      <hr className="rule" />
                      {canEdit && <button type="button" className="btn btn-quiet btn-sm" onClick={() => editingJob === job.id ? cancelEdit() : startEdit(job)}>{editingJob === job.id ? 'Cancel editing' : 'Edit brief'}</button>}
                      {canAdd && <button type="button" className="btn btn-quiet btn-sm" onClick={() => addingJob === job.id ? cancelAdd() : startAdd(job)}><Plus size={14} /> {addingJob === job.id ? 'Cancel' : 'Add a piece to this job'}</button>}
                    </div>
                  </aside>
                </div>
                <nav className="dock only-sm" aria-label="Quick actions">
                  <button type="button" className="d-btn" aria-label="Top of page" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}><Home size={18} /></button>
                  {canAdd && <button type="button" className="fab" aria-label="Add a piece" onClick={() => startAdd(job)}><Plus size={22} /></button>}
                  <button type="button" className="d-btn" aria-label="Designs" onClick={() => document.getElementById(`proofs-${job.id}`)?.scrollIntoView({ behavior: 'smooth' })}><MessageCircle size={18} /></button>
                </nav>
              </article>
            )
```
(`canEdit`, `canAdd`, `proofItems`, `approvedCount` stay as the existing first lines of the `jobs.map` callback. The old header's item chips are gone: pieces now show either under "In design" or in the proofs section.)

- [ ] **Step 6: Add-to-job limits.** In the add-to-job form and its handlers, replace any hard-coded `10` (items) and `3` (files) caps with `MAX_PIECES` / `MAX_FILES`, any 50 MB checks with `MAX_FILE_BYTES` (and the "50MB" text with `` `${MAX_FILE_MB} MB` ``), and add `metal` to the material options (import from `@/lib/limits` and use `MATERIALS` from `@/lib/schemas` if the file keeps its own list). Check: `grep -n "50MB\|50 \* 1024\|>= 10\|< 10\|max={10}" src/app/portal/page.tsx` prints nothing.

- [ ] **Step 7: Type-check** — `npx tsc --noEmit` → no errors (Task 6 is styling only). Commit after Task 6.

---

### Task 6: Re-skin the inner blocks (portal and admin)

The proofs list, client-final-artwork panel, edit panel and add-to-job panel in the portal, and the detail blocks inside the admin drawer (Task 8), still carry the old inline styles. Convert them with this mapping. **Only styling changes**: don't touch handlers, conditions or text that carries meaning.

| Old (inline style or markup) | New |
|---|---|
| white box: `background: '#fff'` / `#fcfbf9` + `border: 1px solid …` | `className="panel"` + `style={{ padding: 20 }}` (keep layout-only styles like `display: grid`) |
| a proofed piece row in the portal proofs list | `className="item-card"`; first column = `<div className="thumb">` holding the proof `<img>`; second column = `stack` with name + `ApprovalPill` in a `between` row |
| primary buttons (coral / charcoal backgrounds) | `className="btn btn-ink btn-sm"` |
| approve buttons (green backgrounds) | `className="btn btn-forest btn-sm"` |
| secondary / outlined buttons | `className="btn btn-quiet btn-sm"` |
| text buttons ("Cancel", "Remove", "×") | `className="link tiny"` |
| `<input>`, `<select>`, `<textarea>` with border/padding/font styles | `className="input"` (drop those styles; keep `width`/grid styles) |
| 11–13 px uppercase/letter-spaced labels | `className="label"` |
| section titles (uppercase, `var(--font-heading)`) | `<SecHead n="02" title="Designs" />` style: `className="sec-title"` |
| note / info boxes with a coloured left border | `className="callout"` (or `msg shop` for a shop note) |
| error text in red | `className="err"` |
| progress bars | `<div className="bar"><span style={{ width: … }} /></div>` |
| `var(--coral)`, `var(--coral-dark)` | `var(--mauve-deep)` |
| `var(--coral-light)` | `var(--mauve-wash)` |
| `var(--charcoal)` | `var(--ink)` |
| `var(--charcoal-60)` | `var(--muted)` |
| `var(--charcoal-border)` | `var(--line)` |
| greens (`#1B7F4F`, `#1B4D3E`, `#16a34a`, `#dcfce7`) | `var(--sage)` / `var(--sage-wash)` |
| reds (`#C62828`, `#dc2626`, `var(--red-err)`) | `var(--rose)` / `var(--rose-wash)` |
| `fontFamily: 'var(--font-heading)'`, `textTransform: 'uppercase'`, `letterSpacing` on headings | remove |
| `borderRadius: 0`, `borderRadius: 3`–`6` on boxes/buttons | remove (classes set radii) |
| `toLocaleDateString('en-ZA', …)` | `prettyDate(iso)` for dates; `'en-CA'` for date-times |
| admin `<style>` chat CSS: `var(--coral)` | `var(--ink)`; `border-bottom: 2px solid var(--coral)` → `1px solid rgba(255,255,255,.12)`; `border-radius: 6px` → `14px` |

- [ ] **Step 1: Portal.** Apply the mapping to `src/app/portal/page.tsx` from `{/* ── Design proofs / approvals` through the end of the add-to-job panel. Add `<SecHead n="02" title="Designs" aside={<span className="tiny muted">{approvedCount} of {proofItems.length} approved</span>} />` as the proofs section title (replacing the old "Design Proofs" header row).

- [ ] **Step 2: Check the portal.** Run `npx tsc --noEmit && npm run build`. Then open `/portal` with a test job's reference + email at 390 px and 1360 px next to the mockup's Portal tab:
  1. Lookup card, then hero with reference/countdown ticket, tracker (current stage dark), waiting callout scrolling to designs.
  2. Approve one design in the portal and request changes on another: pills and tracker update after reload.
  3. Edit brief (job still `received`) and Add a piece (job `in_progress`) still save.
  4. Upload a client final file on a piece: still works.
  5. Deposit card: none before a request; "Pay securely with Square" after Plan B's request; "Paid" after the sandbox payment.
  6. Phone: dock at the bottom, aside stacks under the content.

  Then: `grep -n "var(--coral\|var(--charcoal\|en-ZA\|font-heading" src/app/portal/page.tsx` → nothing.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/portal/me/route.ts src/app/portal/page.tsx
git commit -m "feat(portal): soft-glass portal with progress tracker, deposit card, waiting callout"
```

---

### Task 7: Admin components — job features panel and print schedule

**Files:** Create `src/components/admin/JobFeaturesPanel.tsx`, `src/components/admin/ScheduleAside.tsx`

- [ ] **Step 1: `src/components/admin/JobFeaturesPanel.tsx`**

```tsx
'use client'

import { useState } from 'react'
import { Send, CreditCard } from 'lucide-react'
import { DepositPill } from '@/components/cx/pills'
import { money } from '@/lib/email-layout'
import { jobQuoteTotal, itemProofs } from '@/lib/job-types'
import type { JobItem } from '@/lib/job-types'
import { defaultDepositCents } from '@/lib/deposits'
import type { Deposit } from '@/lib/deposits'
import { waitingItems } from '@/lib/reminders'
import type { ReminderState } from '@/lib/reminders'
import { wantsFloorPreview } from '@/lib/floor-preview'

export interface FeatureJob { id: number; items: JobItem[]; reminders?: ReminderState | null; deposit?: Deposit | null }
type Json = Record<string, unknown>

// Top of the admin job drawer: approval reminders (B1), deposit (B3) and the
// per-piece "On the floor" preview flag (spec ⚑4).
export function JobFeaturesPanel({ job, onJobChange }: { job: FeatureJob; onJobChange: (patch: Partial<FeatureJob>) => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [amount, setAmount] = useState(() => (defaultDepositCents(job.items ?? []) / 100).toFixed(2))
  const rem: ReminderState = job.reminders ?? {}
  const waiting = waitingItems(job.items ?? []).length
  const quoted = jobQuoteTotal(job.items ?? []).total
  const dep = job.deposit && job.deposit.status !== 'cancelled' ? job.deposit : null

  async function call(key: string, url: string, init: RequestInit, onOk: (j: Json) => void, okText: string) {
    setBusy(key)
    setMsg(null)
    try {
      const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json' } })
      const j = (await res.json().catch(() => ({}))) as Json
      if (!res.ok) { setMsg({ ok: false, text: String(j.error ?? 'Something went wrong.') }); return }
      onOk(j)
      setMsg({ ok: true, text: okText })
    } catch {
      setMsg({ ok: false, text: 'Network error. Try again.' })
    } finally {
      setBusy(null)
    }
  }

  const sendReminder = () => call('remind', `/api/admin/jobs/${job.id}/reminders`, { method: 'POST' },
    j => onJobChange({ reminders: j.reminders as ReminderState }), 'Reminder sent.')
  const setPaused = (paused: boolean) => call('pause', `/api/admin/jobs/${job.id}/reminders`, { method: 'PATCH', body: JSON.stringify({ paused }) },
    j => onJobChange({ reminders: j.reminders as ReminderState }), paused ? 'Reminders paused.' : 'Reminders on.')
  const requestDeposit = () => {
    const cents = Math.round(parseFloat(amount) * 100)
    if (!Number.isFinite(cents) || cents < 100) { setMsg({ ok: false, text: 'Enter a deposit of at least $1.' }); return }
    return call('deposit', `/api/admin/jobs/${job.id}/deposit`, { method: 'POST', body: JSON.stringify({ amount_cents: cents }) },
      j => onJobChange({ deposit: j.deposit as Deposit }), 'Square link emailed to the client.')
  }
  const cancelDeposit = () => call('cancel', `/api/admin/jobs/${job.id}/deposit`, { method: 'DELETE' },
    j => onJobChange({ deposit: j.deposit as Deposit }), 'Deposit link cancelled.')
  const setPreview = (index: number, preview: 'floor' | 'flat') => call(`preview-${index}`, `/api/admin/jobs/${job.id}`,
    { method: 'PATCH', body: JSON.stringify({ itemPatch: { index, patch: { preview } } }) },
    () => onJobChange({ items: job.items.map((it, i) => (i === index ? { ...it, preview } : it)) }), 'Preview updated.')

  return (
    <div className="stack" style={{ gap: 18 }}>
      <section className="stack" style={{ gap: 10 }}>
        <div className="between">
          <span className="label">Approval reminders</span>
          <span className="tiny muted">{rem.count ? `${rem.count} sent${rem.last_sent_at ? ` · last ${new Date(rem.last_sent_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}` : ''}` : 'None sent'}</span>
        </div>
        <p className="small" style={{ margin: 0 }}>
          {waiting ? `${waiting} design${waiting === 1 ? ' is' : 's are'} waiting. ` : 'Nothing is waiting on the client. '}
          Auto-reminds 2 days after a proof, then every 3 days (max 3). You get a phone alert at 5 days.
        </p>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-quiet btn-sm" disabled={!waiting || busy !== null} onClick={sendReminder}><Send size={13} /> {busy === 'remind' ? 'Sending…' : 'Send reminder now'}</button>
          <span className="row tiny" style={{ gap: 8 }}>
            <button type="button" className="switch" role="switch" aria-checked={!rem.paused} aria-label="Automatic reminders" disabled={busy !== null} onClick={() => setPaused(!rem.paused)} />
            {rem.paused ? 'Paused' : 'Automatic'}
          </span>
        </div>
      </section>

      <hr className="rule" />

      <section className="stack" style={{ gap: 10 }}>
        <div className="between"><span className="label">Deposit</span><DepositPill status={dep?.status} /></div>
        {dep?.status === 'paid' ? (
          <>
            <span className="display num" style={{ fontSize: 28 }}>{money(dep.amount_cents)}</span>
            <div className="callout" style={{ background: 'var(--amber-wash)' }}><span className="small">Deposit paid{dep.paid_at ? ` ${new Date(dep.paid_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}` : ''}. Record it on the Command Centre invoice so the client isn’t billed twice.</span></div>
          </>
        ) : dep?.status === 'sent' ? (
          <>
            <span className="display num" style={{ fontSize: 28 }}>{money(dep.amount_cents)}</span>
            <span className="small muted">Square link emailed {new Date(dep.sent_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}. Marked paid automatically when the client pays.</span>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => navigator.clipboard?.writeText(dep.url)}>Copy pay link</button>
              <button type="button" className="link tiny" disabled={busy !== null} onClick={cancelDeposit}>{busy === 'cancel' ? 'Cancelling…' : 'Cancel link'}</button>
            </div>
          </>
        ) : quoted > 0 ? (
          <>
            <span className="small muted">Quote total {money(Math.round(quoted * 100))}. Default deposit is 50%.</span>
            <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
              <label className="row" style={{ gap: 6 }}>
                <span className="label">$</span>
                <input className="input" style={{ width: 130 }} inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value.replace(/[^\d.]/g, ''))} aria-label="Deposit amount in dollars" />
              </label>
              <button type="button" className="btn btn-ink btn-sm" disabled={busy !== null} onClick={requestDeposit}><CreditCard size={13} /> {busy === 'deposit' ? 'Creating link…' : 'Request deposit via Square'}</button>
            </div>
          </>
        ) : (
          <span className="small muted">Add a quote to the pieces to request a deposit.</span>
        )}
      </section>

      {(job.items ?? []).some(it => itemProofs(it).length > 0) && (
        <>
          <hr className="rule" />
          <section className="stack" style={{ gap: 10 }}>
            <span className="label">“On the floor” preview</span>
            {job.items.map((it, i) => itemProofs(it).length > 0 && (
              <div key={i} className="between small">
                <span>{it.name}</span>
                <button type="button" className="switch" role="switch" aria-checked={wantsFloorPreview(it)} aria-label={`Floor preview for ${it.name}`}
                  disabled={busy !== null} onClick={() => setPreview(i, wantsFloorPreview(it) ? 'flat' : 'floor')} />
              </div>
            ))}
          </section>
        </>
      )}

      {msg && <p className={msg.ok ? 'small' : 'err'} role="status" style={msg.ok ? { color: 'var(--sage)', margin: 0 } : undefined}>{msg.text}</p>}
    </div>
  )
}
```

- [ ] **Step 2: `src/components/admin/ScheduleAside.tsx`**

```tsx
'use client'

import { useEffect, useState } from 'react'
import { Bell } from 'lucide-react'
import { Pill } from '@/components/cx/kit'
import type { ScheduleDay } from '@/lib/schedule'

// Live version of the 07:00 morning digest (GET /api/admin/schedule).
export function ScheduleAside({ refreshKey, onOpen }: { refreshKey: number; onOpen: (jobId: number) => void }) {
  const [days, setDays] = useState<ScheduleDay[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    fetch('/api/admin/schedule')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(j => { if (alive) { setDays(j.days as ScheduleDay[]); setFailed(false) } })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [refreshKey])

  return (
    <aside className="panel" style={{ padding: '20px 20px 8px', alignSelf: 'start' }}>
      <div className="between"><span className="label">Print schedule · next 7 days</span><Bell size={14} color="var(--mauve-deep)" /></div>
      <p className="tiny muted" style={{ margin: '6px 0 4px' }}>Also sent to your phone and inbox every morning at 7:00.</p>
      {failed ? <p className="small muted">Couldn’t load the schedule.</p>
        : days === null ? <p className="small muted">Loading…</p>
        : days.length === 0 ? <p className="small muted" style={{ padding: '12px 0' }}>Nothing due this week.</p>
        : days.map(d => {
          const dt = new Date(`${d.date}T00:00:00`)
          return (
            <div key={d.date} className="day">
              <div className="d-date"><span className="tiny muted">{dt.toLocaleDateString('en-US', { weekday: 'short' })}</span><b>{dt.getDate()}</b></div>
              <div className="stack" style={{ gap: 10 }}>
                {d.rows.map(r => (
                  <button key={`${r.id}-${d.date}`} type="button" onClick={() => onOpen(r.id)} style={{ all: 'unset', cursor: 'pointer', display: 'grid', gap: 4 }}>
                    <b className="small">{r.title}</b>
                    <span className="tiny muted">{r.type === 'product' ? 'Product' : 'Event'} · {r.approved}/{r.pieces} approved · {r.units} units</span>
                    {r.flags.length > 0 && <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}>{r.flags.map(f => <Pill key={f} tone="alert">{f}</Pill>)}</span>}
                  </button>
                ))}
              </div>
            </div>
          )
        })}
    </aside>
  )
}
```

- [ ] **Step 3: Type-check** — `npx tsc --noEmit` → no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/admin
git commit -m "feat(admin): job features panel (reminders, deposit, floor preview) + print schedule"
```

---

### Task 8: Admin dashboard (`/admin`)

**Files:** Modify `src/app/admin/page.tsx`

The jobs list becomes a table; a job opens in a right-hand drawer instead of expanding inline. All existing per-job tools (proof upload, quotes, approvals, chat, edit, Command Centre, invoices, library picker, production sheet) keep working: their JSX moves into the drawer unchanged (then gets the Task 6 re-skin).

- [ ] **Step 1: Types and imports.** Add to `interface Job`:

```ts
  job_type?: 'event' | 'product'
  fulfillment?: 'pickup' | 'delivery' | 'install' | null
  reminders?: ReminderState | null
  deposit?: Deposit | null
  updated_at?: string
```
and imports:
```tsx
import { Search, LayoutGrid, LogOut, Printer } from 'lucide-react'
import { JobStatusPill, DepositPill } from '@/components/cx/pills'
import { JobFeaturesPanel } from '@/components/admin/JobFeaturesPanel'
import { ScheduleAside } from '@/components/admin/ScheduleAside'
import { adminKpis, approvalSummary, jobWaiting } from '@/lib/admin-kpis'
import { torontoDate, torontoHour } from '@/lib/local-time'
import { daysUntil, countdownLabel, prettyDate } from '@/lib/countdown'
import type { Deposit } from '@/lib/deposits'
import type { ReminderState } from '@/lib/reminders'
```
Delete the local `StatusPill` (replaced by `JobStatusPill`); keep the local `ApprovalPill` only if the detail JSX still uses it, otherwise import it from `@/components/cx/pills`.

- [ ] **Step 2: State and helpers.** Inside `AdminPage`, after the existing state, add:

```tsx
  const [drawerId, setDrawerId] = useState<number | null>(null)
  const [scheduleKey, setScheduleKey] = useState(0)
  const [adminEmail, setAdminEmail] = useState('')
  useEffect(() => {
    fetch('/api/admin/me').then(r => (r.ok ? r.json() : null)).then(j => { if (j?.email) setAdminEmail(j.email) }).catch(() => {})
  }, [])
  const drawerJob = jobs.find(j => j.id === drawerId) ?? null
  const kpis = adminKpis(jobs, torontoDate())
  const hour = torontoHour()
  const partOfDay = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'
  const firstName = adminEmail ? adminEmail.split('@')[0].split(/[._-]/)[0].replace(/^./, c => c.toUpperCase()) : ''
  const FILTERS: { key: string; label: string }[] = [
    { key: 'all', label: 'All' }, { key: 'waiting', label: 'Waiting on client' }, { key: 'deposit', label: 'Deposit due' },
    ...STATUSES.filter(s => s !== 'pending').map(s => ({ key: s, label: STATUS_LABELS[s] })),
  ]
  const matchesFilter = (j: Job) =>
    filter === 'all' ? true : filter === 'waiting' ? jobWaiting(j) : filter === 'deposit' ? j.deposit?.status === 'sent' : j.status === filter

  function openJob(id: number) {
    setDrawerId(id)
  }
```
In the existing `filtered` computation, replace the status comparison (`job.status === filter` or equivalent, guarded by `filter === 'all'`) with `matchesFilter(job)`.

In `openJob`, also call whatever the old job header's `onClick` called when **opening** a job (for example a lazy loader for signed file URLs or proofs, or setting `openOverride`). Read the old header's `onClick` and copy those calls into `openJob` so the drawer has its data.

- [ ] **Step 3: Extract the job detail.** Inside the `filtered.map(job => { … })` callback, everything that renders only when the job is open (the expanded body, including `{/* ── Edit panel … */}`) moves into a new inner function declared just before `return (` in `AdminPage`:

```tsx
  function renderJobDetail(job: Job) {
    // per-job constants the old map callback computed and the detail uses go here
    return (
      <>
        {/* the moved expanded-body JSX, unchanged */}
      </>
    )
  }
```
Move any constants the detail needs from the top of the old `map` callback into this function. Don't change the moved JSX in this step.

- [ ] **Step 4: Page layout.** Replace the main `return (` content from `<main …>` through the end of the old job list (the `filtered.map` block and its wrappers), keeping the `<style>` block (chat drawer CSS) and everything after the list (chat drawer, library picker, other modals), with:

```tsx
    <main className="cx">
      <style>{/* keep the existing chat-drawer CSS string here */}</style>
      <div className="admin">
        <nav className="side" aria-label="Admin">
          <img src="/logo-ddfpixel.png" alt="DDF x Pixel" className="logo" />
          <div className="nav">
            <button type="button" aria-current="page"><LayoutGrid size={16} /> Jobs</button>
            <button type="button" onClick={printProductionSheet} disabled={buildingProdSheet}><Printer size={16} /> {buildingProdSheet ? 'Building…' : 'Production sheet'}</button>
            <button type="button" onClick={signOut}><LogOut size={16} /> Sign out</button>
          </div>
          {adminEmail && <div className="tiny muted" style={{ borderTop: '1px solid var(--line)', paddingTop: 14 }}>Signed in as<br /><span style={{ color: 'var(--ink)' }}>{adminEmail}</span></div>}
        </nav>

        <div className="admin-main">
          <div className="between stack-sm">
            <div className="stack" style={{ gap: 10 }}>
              <span className="eyebrow">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</span>
              <h1 className="display" style={{ margin: 0, fontSize: 48 }}>Good {partOfDay}{firstName ? <>, <span className="serif">{firstName}.</span></> : '.'}</h1>
            </div>
            <div className="row glass" style={{ padding: '0 14px', gap: 8, borderRadius: 999 }}>
              <Search size={15} color="var(--muted)" />
              <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search client, company, ref or event…" aria-label="Search jobs"
                style={{ border: 0, background: 'transparent', padding: '12px 0', font: 'inherit', width: 260, outline: 'none' }} />
            </div>
          </div>

          {loading ? (
            <p className="muted" style={{ padding: '60px 0', textAlign: 'center' }}>Loading jobs…</p>
          ) : loadError ? (
            <div className="alert">{loadError}</div>
          ) : (
            <>
              <div className="kpis">
                <button type="button" className="kpi dark" onClick={() => setFilter('waiting')} style={{ textAlign: 'left', cursor: 'pointer' }}>
                  <span className="label">Waiting on client</span><span className="k-val num">{kpis.awaiting}</span><span className="tiny muted">jobs with designs out</span>
                </button>
                <div className="kpi"><span className="label">Due in 7 days</span><span className="k-val num">{kpis.soon}</span><span className="tiny muted">events and orders</span></div>
                <button type="button" className="kpi" onClick={() => setFilter('in_progress')} style={{ textAlign: 'left', cursor: 'pointer' }}>
                  <span className="label">In production</span><span className="k-val num">{kpis.inProduction}</span><span className="tiny muted">on the board</span>
                </button>
                <button type="button" className="kpi" onClick={() => setFilter('deposit')} style={{ textAlign: 'left', cursor: 'pointer' }}>
                  <span className="label">Deposits due</span><span className="k-val num">{kpis.depositsOutstanding}</span><span className="tiny muted">links not yet paid</span>
                </button>
              </div>

              <div className="split" style={{ gridTemplateColumns: 'minmax(0,1fr) 300px', gap: 22 }}>
                <section className="panel" style={{ minWidth: 0, overflow: 'hidden' }}>
                  <div className="row" style={{ padding: '14px 16px', gap: 8, flexWrap: 'wrap', borderBottom: '1px solid var(--line)' }}>
                    {FILTERS.map(f => <button key={f.key} type="button" className="chip" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>{f.label}</button>)}
                    <span className="tiny muted" style={{ marginLeft: 'auto' }}>{filtered.length} job{filtered.length === 1 ? '' : 's'}</span>
                  </div>
                  <div style={{ overflowX: 'auto' }}>
                    <table className="table">
                      <thead><tr><th>Job</th><th>Date</th><th>Approvals</th><th className="hide-md">Deposit</th><th className="hide-md">Reminders</th><th>Status</th></tr></thead>
                      <tbody>
                        {filtered.map(job => {
                          const a = approvalSummary(job.items)
                          const d = daysUntil(job.date_required)
                          const rem = job.reminders ?? {}
                          return (
                            <tr key={job.id} aria-selected={drawerId === job.id} tabIndex={0}
                              onClick={() => openJob(job.id)} onKeyDown={e => { if (e.key === 'Enter') openJob(job.id) }}>
                              <td style={{ minWidth: 230 }}>
                                <span style={{ fontWeight: 500 }}>{job.event_name || job.company_name}</span>
                                <div className="row tiny muted" style={{ gap: 6, marginTop: 4 }}>
                                  <span className="type-tag">{job.job_type === 'product' ? 'Product' : 'Event'}</span>{job.company_name} · {job.reference_number}
                                </div>
                              </td>
                              <td className="num">
                                <b>{prettyDate(job.date_required)}</b>
                                <div className="tiny" style={{ color: d >= 0 && d <= 4 && job.status !== 'completed' ? 'var(--rose)' : 'var(--muted)', fontWeight: 500 }}>{countdownLabel(d)}</div>
                              </td>
                              <td>
                                {a.total ? (
                                  <div className="row" style={{ gap: 8 }}>
                                    <span className="mini-bar"><span style={{ width: `${(a.approved / a.total) * 100}%`, background: a.approved === a.total ? 'var(--sage)' : 'var(--mauve)' }} /></span>
                                    <span className="tiny num">{a.approved}/{a.total}</span>
                                  </div>
                                ) : <span className="tiny muted">No proofs yet</span>}
                              </td>
                              <td className="hide-md"><DepositPill status={job.deposit?.status === 'cancelled' ? undefined : job.deposit?.status} /></td>
                              <td className="hide-md tiny">{rem.count ? <span><b>{rem.count}×</b>{rem.paused ? <span className="muted"> · paused</span> : null}</span> : <span className="muted">{rem.paused ? 'Paused' : '—'}</span>}</td>
                              <td><JobStatusPill status={job.status} /></td>
                            </tr>
                          )
                        })}
                        {filtered.length === 0 && (
                          <tr><td colSpan={6} className="muted small" style={{ padding: 28, textAlign: 'center' }}>{search ? `No jobs match “${search}”.` : 'No jobs in this view.'}</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
                <ScheduleAside refreshKey={scheduleKey} onOpen={openJob} />
              </div>
            </>
          )}
        </div>

        {drawerJob && (
          <>
            <div className="drawer-backdrop" onClick={() => setDrawerId(null)} />
            <aside className="drawer" aria-label={`Job ${drawerJob.reference_number}`} style={{ width: 'min(720px, calc(100% - 32px))' }}>
              <div style={{ padding: 22, display: 'grid', gap: 18 }}>
                <div className="between">
                  <span className="tiny" style={{ color: 'var(--mauve-deep)', letterSpacing: '.06em', fontWeight: 500 }}>{drawerJob.reference_number} · {drawerJob.job_type === 'product' ? 'Product' : 'Event'}</span>
                  <button type="button" className="link tiny" onClick={() => setDrawerId(null)}>Close</button>
                </div>
                <h2 className="display" style={{ margin: 0, fontSize: 30 }}>{drawerJob.event_name || drawerJob.company_name}</h2>
                <span className="small muted">{drawerJob.client_name} · {prettyDate(drawerJob.date_required)} · {countdownLabel(daysUntil(drawerJob.date_required))}</span>
                <JobFeaturesPanel job={drawerJob} onJobChange={patch => {
                  setJobs(js => js.map(j => (j.id === drawerJob.id ? { ...j, ...patch } : j)))
                  setScheduleKey(k => k + 1)
                }} />
                <hr className="rule" />
                {renderJobDetail(drawerJob)}
              </div>
            </aside>
          </>
        )}
      </div>
```
then keep the existing chat drawer / library picker / modal JSX and close with `</main>`. Escape closes the drawer: add to the `drawerId` effect

```tsx
  useEffect(() => {
    if (drawerId === null) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !chatItem) setDrawerId(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawerId, chatItem])
```
Delete the now-unused `<header>`, page title, stats bar, search block, toolbar and the old row header markup. Remove state that nothing reads any more (`openOverride` if `openJob` doesn't need it) only when `tsc`/lint flag it as unused.

- [ ] **Step 5: Re-skin the drawer content** with the Task 6 mapping (everything returned by `renderJobDetail`, the edit panel and the chat-drawer CSS).

- [ ] **Step 6: Check**

Run: `npx tsc --noEmit && npm run lint && npm run build` → clean. Then at 1360 px and 390 px, against the mockup's Admin tab:
1. KPIs count correctly against the data; clicking a KPI filters.
2. Filter chips (All / Waiting on client / Deposit due / statuses) and search work together.
3. Clicking a row opens the drawer with that job's tools; Escape and the backdrop close it.
4. In the drawer: upload a proof, set a quote, approve on behalf of the client, reply in chat, edit the brief, send to Command Centre / resync — each still works.
5. Reminders: "Send reminder now" (to a test address), pause switch; deposit: request (sandbox), copy link, cancel; floor preview switch changes the approval page.
6. Print schedule lists the next 7 days; clicking an entry opens the drawer.
7. Production sheet still prints.

`grep -n "var(--coral\|var(--charcoal\|en-ZA\|font-heading" src/app/admin/page.tsx` → nothing.

- [ ] **Step 7: Commit**

```bash
git add src/app/admin/page.tsx
git commit -m "feat(admin): soft-glass dashboard — KPIs, filters, jobs table, job drawer, print schedule"
```

---

### Task 9: Emails on the branded layout

**Files:** Rewrite `src/lib/email.ts`; Test `tests/email-templates.test.ts`

Same exported functions, signatures, recipients and subjects as today; new HTML from Plan B's `renderEmail`, with every user-supplied value escaped.

- [ ] **Step 1: Write the failing test — `tests/email-templates.test.ts`**

```ts
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'

const sends: { to: { email: string }[]; subject: string; htmlContent: string }[] = []
vi.mock('@getbrevo/brevo', () => ({
  BrevoClient: class { transactionalEmails = { sendTransacEmail: vi.fn(async (m: never) => { sends.push(m) }) } },
}))

describe('email templates', () => {
  let email: typeof import('@/lib/email')
  beforeAll(async () => {
    process.env.BREVO_API_KEY = 'k'
    process.env.SENDER_EMAIL = 'jobs@ddfpixel.com'
    process.env.NOTIFICATION_EMAIL = 'owner@example.com'
    email = await import('@/lib/email')
  })
  beforeEach(() => { sends.length = 0 })

  const job = {
    referenceNumber: 'DDF-20261115-ABC123', clientName: 'Aanya <b>Mehta</b>', companyName: 'Co', contactEmail: 'a@b.co',
    eventName: 'Wedding', dateRequired: '2026-12-12', notes: 'Gold & ivory',
    items: [{ name: 'Floor wrap', quantity: 1, size: '16x16', material: 'vinyl' }],
    signedFileUrls: ['https://jobs.ddfpixel.com/f/abc'], submittedAt: 'Nov 15', portalUrl: 'https://jobs.ddfpixel.com/portal',
  }

  it('confirmation: branded, escaped, portal button, same subject', async () => {
    await email.sendConfirmationEmail(job)
    const m = sends[0]
    expect(m.subject).toBe('Job Brief Received — DDF-20261115-ABC123')
    expect(m.to[0].email).toBe('a@b.co')
    expect(m.htmlContent).toContain('border-radius:24px')
    expect(m.htmlContent).toContain('href="https://jobs.ddfpixel.com/portal"')
    expect(m.htmlContent).toContain('Aanya')
    expect(m.htmlContent).not.toContain('<b>Mehta</b>')
    expect(m.htmlContent).toContain('Gold &amp; ivory')
  })

  it('new-brief notification goes to the owner with files and pieces', async () => {
    await email.sendNotificationEmail(job)
    const m = sends[0]
    expect(m.to[0].email).toBe('owner@example.com')
    expect(m.subject).toBe('New Job Brief: Co — DDF-20261115-ABC123')
    expect(m.htmlContent).toContain('Floor wrap')
    expect(m.htmlContent).toContain('href="https://jobs.ddfpixel.com/f/abc"')
  })

  it('status, change request and added-to-job render', async () => {
    const j = { reference_number: 'DDF-1', client_name: 'Aanya Mehta', contact_email: 'a@b.co' }
    await email.sendStatusNotification(j, 'in_progress')
    await email.sendChangeRequestNotification(j, { name: 'Bar sign', note: 'Bigger <date>' })
    await email.sendAddedToJobNotification(j, { items: [{ name: 'Menu', quantity: 2, size: 'A4' }], fileCount: 1 })
    expect(sends.map(s => s.subject)).toEqual([
      'Your job is in production — DDF-1',
      'Changes requested: DDF-1 — Bar sign',
      'Client added to DDF-1',
    ])
    expect(sends[1].htmlContent).toContain('Bigger &lt;date&gt;')
    expect(sends.every(s => s.htmlContent.startsWith('<!DOCTYPE html>'))).toBe(true)
  })
})
```

- [ ] **Step 2: Run it to see it fail** — `npx vitest run tests/email-templates.test.ts` → FAIL (old templates: no `border-radius:24px`, unescaped name).

- [ ] **Step 3: Replace `src/lib/email.ts`**

```ts
import 'server-only'
import { BrevoClient } from '@getbrevo/brevo'
import type { NotificationStatus } from '@/lib/job-types'
import { renderEmail, esc } from '@/lib/email-layout'

const brevo = new BrevoClient({ apiKey: process.env.BREVO_API_KEY! })

// Branding the email templates need. A subset of TenantBranding, so callers can
// pass a full branding object. Defaults to DDF when a caller doesn't supply one.
export interface EmailBrand {
  businessName: string
  brandColor: string
}

const DDF_BRAND: EmailBrand = {
  businessName: process.env.SENDER_NAME ?? 'DDF x Pixel',
  brandColor: '#b8955a',
}

export interface JobEmailData {
  referenceNumber: string
  clientName: string
  companyName: string
  contactEmail: string
  eventName?: string
  dateRequired: string
  notes?: string
  items: Array<{ name: string; quantity: number; size: string; material: string }>
  signedFileUrls: string[]
  submittedAt: string
  portalUrl?: string   // absolute link to the client portal (/portal), if known
}

const FONT = "Helvetica,Arial,sans-serif"
const firstName = (full: string) => (full || '').trim().split(/\s+/)[0] || 'there'
const sender = (brand: EmailBrand) => ({ email: process.env.SENDER_EMAIL!, name: brand.businessName })

/** Label/value rows as one email block. Values are escaped here. */
function detailRows(rows: [string, string | null | undefined][]): string {
  const body = rows.filter(([, v]) => v).map(([k, v]) =>
    `<tr><td style="padding:5px 0;width:130px;font:400 13px ${FONT};color:#756e68;vertical-align:top">${esc(k)}</td><td style="padding:5px 0;font:500 14px ${FONT};color:#121212">${esc(v)}</td></tr>`).join('')
  return `<tr><td style="padding:18px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${body}</table></td></tr>`
}

function itemsBlock(items: JobEmailData['items']): string {
  const rows = items.map(it =>
    `<tr><td style="padding:10px 0;border-bottom:1px solid #e6dfd8;font:500 14px ${FONT};color:#121212">${esc(it.quantity)} × ${esc(it.name)}</td><td style="padding:10px 0;border-bottom:1px solid #e6dfd8;font:400 13px ${FONT};color:#756e68;text-align:right">${esc([it.size, it.material].filter(Boolean).join(' · '))}</td></tr>`).join('')
  return `<tr><td style="padding:18px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table></td></tr>`
}

function noteBlock(label: string, text: string): string {
  return `<tr><td style="padding:16px 28px 0"><div style="background:#f3eaf0;border-radius:16px;padding:14px 16px;font:400 14px/1.5 ${FONT};color:#2c2a29"><b style="font-weight:600">${esc(label)}</b><br>${esc(text)}</div></td></tr>`
}

function refBlock(ref: string): string {
  return `<tr><td style="padding:18px 28px 0"><div style="background:#1a1418;border-radius:20px;padding:18px 20px"><div style="font:500 11px ${FONT};color:#b9adb4">Your reference</div><div style="font:500 18px ${FONT};letter-spacing:2px;color:#e4c9da;margin-top:6px">${esc(ref)}</div></div></td></tr>`
}

// ── New brief (to the shop) ──────────────────────────────────────────
export async function sendNotificationEmail(job: JobEmailData, brand: EmailBrand = DDF_BRAND) {
  const files = job.signedFileUrls.length
    ? job.signedFileUrls.map((u, i) => `<a href="${esc(u)}" style="color:#7a4c69">File ${i + 1}</a>`).join(' · ') + ' <span style="color:#756e68">(links valid for 30 days)</span>'
    : 'No files uploaded'
  const html = renderEmail({
    businessName: brand.businessName,
    preheader: `${job.companyName} · ${job.items.length} piece${job.items.length === 1 ? '' : 's'} · needed ${job.dateRequired}`,
    heading: 'New', accent: 'brief.',
    paragraphs: [`<b>${esc(job.clientName)}</b> from <b>${esc(job.companyName)}</b> sent a brief.`],
    blocks: [
      detailRows([['Email', job.contactEmail], ['Date required', job.dateRequired], ['Event / project', job.eventName], ['Submitted', job.submittedAt]]),
      itemsBlock(job.items),
      ...(job.notes ? [noteBlock('Notes', job.notes)] : []),
      `<tr><td style="padding:16px 28px 0;font:400 14px ${FONT};color:#2c2a29"><b style="font-weight:600">Files:</b> ${files}</td></tr>`,
    ],
    footnote: `Reply to this email to reach ${job.clientName} at ${job.contactEmail}.`,
    reference: job.referenceNumber,
  })
  await brevo.transactionalEmails.sendTransacEmail({
    to: [{ email: process.env.NOTIFICATION_EMAIL! }],
    replyTo: { email: job.contactEmail, name: job.clientName },
    sender: sender(brand),
    subject: `New Job Brief: ${job.companyName} — ${job.referenceNumber}`,
    htmlContent: html,
  })
}

// ── Brief received (to the client) ────────────────────────────────────
export async function sendConfirmationEmail(job: JobEmailData, brand: EmailBrand = DDF_BRAND) {
  const html = renderEmail({
    businessName: brand.businessName,
    preheader: `We’ve got your brief. Reference ${job.referenceNumber}.`,
    heading: 'Brief', accent: 'received.',
    paragraphs: [
      `Hi ${esc(firstName(job.clientName))}, thanks — we’ve got your brief${job.eventName ? ` for <b>${esc(job.eventName)}</b>` : ''}. We’ll review it and come back with a quote or your first proofs.`,
    ],
    blocks: [
      refBlock(job.referenceNumber),
      itemsBlock(job.items),
      detailRows([['Company', job.companyName], ['Date required', job.dateRequired], ['Submitted', job.submittedAt]]),
      ...(job.notes ? [noteBlock('Your notes', job.notes)] : []),
    ],
    cta: job.portalUrl ? { label: 'View my job', url: job.portalUrl } : undefined,
    footnote: 'Track progress, approve designs and add pieces any time with your reference and this email. No need to send the brief again.',
    reference: job.referenceNumber,
  })
  await brevo.transactionalEmails.sendTransacEmail({
    to: [{ email: job.contactEmail, name: job.clientName }],
    sender: sender(brand),
    subject: `Job Brief Received — ${job.referenceNumber}`,
    htmlContent: html,
  })
}

// ── Change request (to the shop) ──────────────────────────────────────
export async function sendChangeRequestNotification(
  job: { reference_number: string; client_name: string; contact_email: string },
  item: { name: string; note?: string },
  brand: EmailBrand = DDF_BRAND,
): Promise<void> {
  const html = renderEmail({
    businessName: brand.businessName,
    preheader: `${job.client_name} asked for changes on ${item.name}`,
    heading: 'Changes', accent: 'requested.',
    paragraphs: [`<b>${esc(job.client_name)}</b> (${esc(job.contact_email)}) asked for changes on <b>${esc(item.name)}</b>.`],
    blocks: [item.note ? noteBlock('Client note', item.note) : `<tr><td style="padding:12px 28px 0;font:400 14px ${FONT};color:#756e68">No note was provided.</td></tr>`],
    footnote: `Reply to this email to reach ${job.client_name} directly.`,
    reference: job.reference_number,
  })
  // Best-effort — a transient email failure must not block the approval write.
  try {
    await brevo.transactionalEmails.sendTransacEmail({
      to: [{ email: process.env.NOTIFICATION_EMAIL! }],
      replyTo: { email: job.contact_email, name: job.client_name },
      sender: sender(brand),
      subject: `Changes requested: ${job.reference_number} — ${item.name}`,
      htmlContent: html,
    })
  } catch (err) {
    console.error('[sendChangeRequestNotification] Brevo send failed:', err)
  }
}

// ── Status (to the client) ────────────────────────────────────────────
export async function sendStatusNotification(
  job: { reference_number: string; client_name: string; contact_email: string },
  status: NotificationStatus,
  brand: EmailBrand = DDF_BRAND,
): Promise<void> {
  const inProduction = status === 'in_progress'
  const html = renderEmail({
    businessName: brand.businessName,
    preheader: inProduction ? 'Your job is in production.' : 'Your job is ready.',
    heading: inProduction ? 'Your job is in' : 'Your job is', accent: inProduction ? 'production.' : 'ready.',
    paragraphs: [
      `Hi ${esc(firstName(job.client_name))}, ${inProduction
        ? 'good news: your job is now in production. We’ll be in touch when it’s ready.'
        : 'great news: your job is ready. We’ll confirm the hand-over with you.'}`,
    ],
    footnote: 'Questions? Just reply to this email.',
    reference: job.reference_number,
  })
  // Best-effort delivery — never block the status update.
  try {
    await brevo.transactionalEmails.sendTransacEmail({
      to: [{ email: job.contact_email, name: job.client_name }],
      sender: sender(brand),
      subject: inProduction ? `Your job is in production — ${job.reference_number}` : `Your job is ready — ${job.reference_number}`,
      htmlContent: html,
    })
  } catch (err) {
    console.error('[sendStatusNotification] Brevo send failed:', err)
  }
}

// ── Client added to a job in progress (to the shop) ───────────────────
export async function sendAddedToJobNotification(
  job: { reference_number: string; client_name: string; contact_email: string },
  added: { items: Array<{ name: string; quantity: number; size: string }>; fileCount: number },
  brand: EmailBrand = DDF_BRAND,
): Promise<void> {
  const html = renderEmail({
    businessName: brand.businessName,
    preheader: `${job.client_name} added to ${job.reference_number}`,
    heading: 'Added to a job in', accent: 'progress.',
    paragraphs: [`<b>${esc(job.client_name)}</b> (${esc(job.contact_email)}) added to <b>${esc(job.reference_number)}</b>. Existing pieces are unchanged; the new ones need a quote and a proof.`],
    blocks: [
      ...(added.items.length ? [itemsBlock(added.items.map(it => ({ ...it, material: '' })))] : []),
      ...(added.fileCount > 0 ? [noteBlock('Files', `${added.fileCount} new document${added.fileCount === 1 ? '' : 's'} attached. View them in the admin job drawer.`)] : []),
    ],
    footnote: `Reply to this email to reach ${job.client_name} directly.`,
    reference: job.reference_number,
  })
  try {
    await brevo.transactionalEmails.sendTransacEmail({
      to: [{ email: process.env.NOTIFICATION_EMAIL! }],
      replyTo: { email: job.contact_email, name: job.client_name },
      sender: sender(brand),
      subject: `Client added to ${job.reference_number}`,
      htmlContent: html,
    })
  } catch (err) {
    console.error('[sendAddedToJobNotification] Brevo send failed:', err)
  }
}
```

- [ ] **Step 4: Run** — `npx vitest run tests/email-templates.test.ts && npx tsc --noEmit` → 3 passed, no type errors.

- [ ] **Step 5: Look at them.** Send one of each to your own inbox from the local app (submit a brief; move a test job to in production; request changes on a test proof). Check Gmail on desktop and on the iPhone Mail app: rounded white card on stone, black pill button, nothing broken in dark mode.

- [ ] **Step 6: Commit**

```bash
git add src/lib/email.ts tests/email-templates.test.ts
git commit -m "feat(email): all emails on the branded soft-glass layout, values escaped"
```

---

### Task 10: Clean up, verify, hand off

- [ ] **Step 1: Retire the old tokens.** Run `grep -rn "var(--coral\|var(--charcoal\|var(--green-ok\|var(--red-err\|en-ZA" src`. Re-skin any remaining hit with the Task 6 mapping. When nothing is left, delete `--coral`, `--coral-light`, `--coral-dark`, `--charcoal`, `--charcoal-60`, `--charcoal-border`, `--green-ok`, `--red-err` from `src/app/globals.css`.

- [ ] **Step 2: Full checks**

```bash
docker compose up -d db
npx tsc --noEmit
npm run lint
npx vitest run
npm run build
```
Expected: all green.

- [ ] **Step 3: End-to-end walk-through** (local app, test data only)
  1. Send an event brief and a product brief from `/`.
  2. Admin: quote both, upload proofs (one floor piece with two "pick" designs), copy the review link.
  3. Approval page: approve with the floor preview; request changes on one; approve the revision.
  4. Admin: request a deposit (Square sandbox), pay it from the approval page callout, see Paid in the portal, admin and the morning schedule.
  5. Run `/api/cron/approval-reminders` with a proof older than 2 days (adjust `proof_sent_at` on the test job): the client email arrives once.
  6. Delete only the test jobs created here, by exact id.

- [ ] **Step 4: Screenshots for the owner** — every page at 390 px and 1360 px, plus the six emails, attached to the PR.

- [ ] **Step 5: Finish the branch** — use superpowers:finishing-a-development-branch (PR into `main`, owner merges).
