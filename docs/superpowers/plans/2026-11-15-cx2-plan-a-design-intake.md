# Client Experience v2 — Plan A: Design System + Intake + Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ] `) syntax for tracking.

**Goal:** Ship the approved "soft glass" look (Geist + Instrument Serif, mauve / stone / ink) on the intake form and admin login, add the Event / Products & fabrication split, and raise the upload limits (30 pieces, 10 files, 95 MB per file, DXF accepted).

**Architecture:** The design system is one scoped stylesheet, `src/app/ui.css`, where every rule lives under `.cx`, so pages opt in by wrapping their content in `<div className="cx">` and pages not yet restyled (portal, review, admin until Plan C) are untouched. A small kit of presentational components (`src/components/cx/kit.tsx`) mirrors the mockup's building blocks. `IntakeForm.tsx` keeps all its state, upload and submit logic; only its render is replaced. Limits move into one module, `src/lib/limits.ts`, shared by the form, the zod schemas and the upload route.

**Tech Stack:** Next.js 16 (App Router, `next/font/google`), React 19, plain CSS (scoped), `lucide-react` icons, zod 4, vitest.

**Spec:** `docs/superpowers/specs/2026-11-15-client-experience-v2-design.md` (Part A).
**Design reference:** `docs/design/client-experience-v2/` — open `mockup.html` in a browser (Intake tab; Desktop and Phone). `ui.css` there is the stylesheet this plan installs. `src/screens/Intake.tsx.ref` is the mockup markup.
**Prerequisites:** Supabase Exit Phase 1 merged. **Plan B Task 1 merged** (Task 7 here writes `job_type` / `fulfillment`, which Plan B adds to the database and `insertJob`). Run order: **Plan B → Plan A → Plan C**.

---

## Ground rules

- Read `AGENTS.md` (Next.js 16 docs live in `node_modules/next/dist/docs/`; read the `next/font` page before Task 1).
- Branch: `git checkout main && git pull && git checkout -b cx2-design-intake`.
- TDD for logic (limits, schemas, upload route, countdown). UI tasks are verified with `tsc`, `next build` and a side-by-side check against the mockup.
- Don't change upload, validation or submit behaviour beyond what a task says. The form's existing logic is battle-tested.

## File map

| File | Status | Responsibility |
|---|---|---|
| `src/app/ui.css` | create (copy) | the scoped design system |
| `src/app/layout.tsx` | modify | Geist + Instrument Serif via `next/font`; import `ui.css` |
| `src/app/globals.css` | modify | old font variables point at Geist |
| `src/lib/limits.ts` | create | all upload / piece limits |
| `src/lib/countdown.ts` | create | days-until, labels, pretty dates (client side) |
| `src/lib/schemas.ts` | modify | limits, `metal`, `jobType`, `fulfillment` |
| `src/app/api/upload-url/route.ts` | modify | 95 MB, batch of 10, DXF |
| `src/components/cx/kit.tsx` | create | Page, SiteHead, SiteFoot, SecHead, Pill, Field, Chip, Stepper, FileRow |
| `src/components/IntakeForm.tsx` | modify | new render, job type, fulfilment, limits |
| `src/app/login/page.tsx` | modify | restyle |
| `src/app/api/submit/route.ts` | modify | store `job_type` / `fulfillment` |
| `tests/limits-schemas.test.ts`, `tests/upload-limits.test.ts`, `tests/countdown.test.ts` | create | tests |

---

### Task 1: Fonts and the design system stylesheet

**Files:** Create `src/app/ui.css`; Modify `src/app/layout.tsx`, `src/app/globals.css`, `package.json`

- [ ] **Step 1: Install the icon set**

Run: `npm install lucide-react`
Expected: `lucide-react` appears under `dependencies` in `package.json`.

- [ ] **Step 2: Copy the stylesheet**

Run: `cp docs/design/client-experience-v2/ui.css src/app/ui.css`
Expected: `head -5 src/app/ui.css` shows the header comment ("every rule is scoped under .cx").

- [ ] **Step 3: Replace `src/app/layout.tsx`**

```tsx
import type { Metadata, Viewport } from 'next'
import { Geist, Instrument_Serif } from 'next/font/google'
import './globals.css'
import './ui.css'

// Body + headings. Exposed as --font-geist-sans (Tailwind's font-sans and ui.css use it).
const geist = Geist({
  subsets: ['latin'],
  variable: '--font-geist-sans',
})

// The one italic accent word in headings ("Tell us what you're *making.*").
const instrumentSerif = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
  variable: '--font-instrument-serif',
})

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#ebe6e1',
}

export const metadata: Metadata = {
  title: 'Send a brief — DDF x Pixel',
  description: 'Send your event or fabrication brief to DDF x Pixel. Quotes, proofs and approvals in one place.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${instrumentSerif.variable}`}>
      <body className="min-h-screen">{children}</body>
    </html>
  )
}
```

- [ ] **Step 4: Point the old font variables at Geist in `src/app/globals.css`**

Replace these two lines:
```css
  --font-heading: var(--font-heading, 'Oswald', sans-serif);
  --font-body: var(--font-body, 'Montserrat', sans-serif);
```
with:
```css
  /* Oswald/Montserrat retired (client experience v2). Pages not yet restyled use Geist too. */
  --font-heading: var(--font-geist-sans), 'Helvetica Neue', Arial, sans-serif;
  --font-body: var(--font-geist-sans), 'Helvetica Neue', Arial, sans-serif;
```
In the same file, delete the line `  --font-mono: var(--font-geist-mono);` (no mono font is loaded).

- [ ] **Step 5: Build**

Run: `npx tsc --noEmit && npm run build`
Expected: build succeeds. `grep -rn "Oswald\|Montserrat" src` prints nothing.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/app/ui.css src/app/layout.tsx src/app/globals.css
git commit -m "feat(ui): soft-glass design system (scoped .cx) + Geist / Instrument Serif"
```

---

### Task 2: Limits, materials and job type in the schemas

**Files:** Create `src/lib/limits.ts`; Modify `src/lib/schemas.ts`; Test `tests/limits-schemas.test.ts`

- [ ] **Step 1: Write the failing test — `tests/limits-schemas.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { SubmitSchema, AddToJobSchema } from '@/lib/schemas'
import { MAX_PIECES, MAX_FILES, MAX_FILE_BYTES, MAX_FILE_MB, UPLOAD_BATCH } from '@/lib/limits'

const item = { name: 'Sign', quantity: 1, size: '24x36', material: 'pvc' as const }
const base = {
  clientName: 'A', companyName: 'B', contactEmail: 'A@B.co ', dateRequired: '2030-01-02',
  items: [item], filePaths: [], submissionId: randomUUID(),
}

describe('limits', () => {
  it('match the spec', () => {
    expect([MAX_PIECES, MAX_FILES, MAX_FILE_MB, UPLOAD_BATCH]).toEqual([30, 10, 95, 10])
    expect(MAX_FILE_BYTES).toBe(95 * 1024 * 1024)
  })
})

describe('SubmitSchema', () => {
  it('defaults to an event and accepts 30 pieces and 10 files', () => {
    const r = SubmitSchema.safeParse({ ...base, items: Array(30).fill(item), filePaths: Array(10).fill('uploads/a.png') })
    expect(r.success).toBe(true)
    expect(r.success && r.data.jobType).toBe('event')
  })
  it('rejects 31 pieces and 11 files', () => {
    expect(SubmitSchema.safeParse({ ...base, items: Array(31).fill(item) }).success).toBe(false)
    expect(SubmitSchema.safeParse({ ...base, filePaths: Array(11).fill('uploads/a.png') }).success).toBe(false)
  })
  it('accepts metal', () => {
    expect(SubmitSchema.safeParse({ ...base, items: [{ ...item, material: 'metal' }] }).success).toBe(true)
  })
  it('a product needs a hand-over choice, and an address unless picked up', () => {
    expect(SubmitSchema.safeParse({ ...base, jobType: 'product' }).success).toBe(false)
    expect(SubmitSchema.safeParse({ ...base, jobType: 'product', fulfillment: 'pickup' }).success).toBe(true)
    const noAddr = SubmitSchema.safeParse({ ...base, jobType: 'product', fulfillment: 'delivery' })
    expect(noAddr.success).toBe(false)
    expect(!noAddr.success && noAddr.error.issues[0].path).toEqual(['setupLocation'])
    expect(SubmitSchema.safeParse({ ...base, jobType: 'product', fulfillment: 'install', setupLocation: '214 King St W' }).success).toBe(true)
  })
})

describe('AddToJobSchema', () => {
  it('allows 30 new pieces and 10 files', () => {
    expect(AddToJobSchema.safeParse({ newItems: Array(30).fill(item), newFilePaths: Array(10).fill('uploads/a.png') }).success).toBe(true)
    expect(AddToJobSchema.safeParse({ newItems: Array(31).fill(item) }).success).toBe(false)
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/limits-schemas.test.ts`
Expected: FAIL (`@/lib/limits` missing).

- [ ] **Step 3: Create `src/lib/limits.ts`**

```ts
// Upload and brief limits (spec A1c). One place, shared by the intake form, the
// portal "Add to job" form, the zod schemas and /api/upload-url.
export const MAX_PIECES = 30            // pieces per brief, and per "Add to job"
export const MAX_FILES = 10             // job-level files per brief / add
export const MAX_ITEM_FILES = 8         // reference photos or final files per piece
export const MAX_FILE_MB = 95           // Cloudflare's free plan caps one upload at 100 MB
export const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024
export const UPLOAD_BATCH = 10          // files per /api/upload-url request
```

- [ ] **Step 4: Update `src/lib/schemas.ts`**

Add at the top, under the zod import:
```ts
import { MAX_PIECES, MAX_FILES } from '@/lib/limits'

export const MATERIALS = ['vinyl', 'fabric', 'foam-board', 'acrylic', 'cardstock', 'wood', 'pvc', 'metal', 'other'] as const
```
In `ItemSchema`, replace the material line with:
```ts
  material: z.enum(MATERIALS),
```
Replace the whole `SubmitSchema` declaration (from `export const SubmitSchema = z.object({` through its closing `})`) with:
```ts
export const SubmitSchema = z.object({
  clientName: z.string().min(1, 'Client name is required'),
  companyName: z.string().min(1, 'Company name is required'),
  contactEmail: z.string().email('Invalid email address').transform(s => s.trim().toLowerCase()),
  // ISO date string (YYYY-MM-DD): the event date, or the needed-by date for products.
  dateRequired: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format'),
  eventName: z.string().optional(),
  notes: z.string().optional(),
  // What the brief is for. Products are handed over by pickup, delivery or install.
  jobType: z.enum(['event', 'product']).default('event'),
  fulfillment: z.enum(['pickup', 'delivery', 'install']).optional(),
  // Crew logistics — one set per job (all optional, free-form text). For products,
  // setupLocation / setupTime hold the delivery or install address and time.
  setupLocation: z.string().max(300).optional(),
  setupTime: z.string().max(120).optional(),
  removalLocation: z.string().max(300).optional(),
  removalTime: z.string().max(120).optional(),
  items: z.array(ItemSchema).min(1, 'At least one item is required').max(MAX_PIECES),
  filePaths: z.array(z.string()).max(MAX_FILES),
  submissionId: z.string().uuid('Invalid submission ID'),
  // Which workspace this intake belongs to (from the /s/{slug} URL). Optional —
  // the root form omits it and the server falls back to the default tenant.
  tenantSlug: z.string().max(64).optional(),
  _hp: z.string().optional(),
}).superRefine((d, ctx) => {
  if (d.jobType !== 'product') return
  if (!d.fulfillment) {
    ctx.addIssue({ code: 'custom', path: ['fulfillment'], message: 'Choose pick up, delivery or install' })
  } else if (d.fulfillment !== 'pickup' && !d.setupLocation?.trim()) {
    ctx.addIssue({ code: 'custom', path: ['setupLocation'], message: 'Add the delivery or install address' })
  }
})
```
In `AddToJobSchema`, change `.max(10)` to `.max(MAX_PIECES)` and `.max(3)` to `.max(MAX_FILES)`.

- [ ] **Step 5: Run the tests and the type-check**

Run: `npx vitest run tests/limits-schemas.test.ts && npx tsc --noEmit`
Expected: 6 passed; no type errors. (If `tsc` reports a material union mismatch elsewhere, e.g. a hard-coded material list in the admin or portal, add `'metal'` to that list.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/limits.ts src/lib/schemas.ts tests/limits-schemas.test.ts
git commit -m "feat: raise limits (30 pieces, 10 files), metal material, job type + fulfillment in SubmitSchema"
```

---

### Task 3: Upload route — 95 MB, batches of 10, DXF

**Files:** Modify `src/app/api/upload-url/route.ts`; Test `tests/upload-limits.test.ts`

- [ ] **Step 1: Write the failing test — `tests/upload-limits.test.ts`**

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { NextRequest } from 'next/server'

describe('POST /api/upload-url limits', () => {
  let POST: typeof import('@/app/api/upload-url/route').POST
  beforeAll(async () => {
    process.env.FILE_LINK_SECRET = 'test-file-secret-0123456789abcdef0123456789'
    POST = (await import('@/app/api/upload-url/route')).POST
  })
  const call = (files: { name: string; type: string; size: number }[]) =>
    POST(new NextRequest('http://x/api/upload-url', { method: 'POST', body: JSON.stringify({ files }) }))
  const MB = 1024 * 1024

  it('accepts a 95 MB file and rejects 96 MB', async () => {
    expect((await call([{ name: 'big.pdf', type: 'application/pdf', size: 95 * MB }])).status).toBe(200)
    const res = await call([{ name: 'huge.pdf', type: 'application/pdf', size: 96 * MB }])
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('95 MB')
  })
  it('accepts DXF with an empty or DXF content type', async () => {
    expect((await call([{ name: 'cut.dxf', type: '', size: 1000 }])).status).toBe(200)
    expect((await call([{ name: 'cut.dxf', type: 'image/vnd.dxf', size: 1000 }])).status).toBe(200)
  })
  it('accepts 10 files per request, rejects 11', async () => {
    const f = { name: 'a.png', type: 'image/png', size: 1000 }
    expect((await call(Array(10).fill(f))).status).toBe(200)
    expect((await call(Array(11).fill(f))).status).toBe(400)
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/upload-limits.test.ts`
Expected: FAIL (95 MB rejected, DXF rejected, 10 files rejected).

- [ ] **Step 3: Edit `src/app/api/upload-url/route.ts`**

Add the import:
```ts
import { MAX_FILE_BYTES, MAX_FILE_MB, UPLOAD_BATCH } from '@/lib/limits'
```
Add three entries to `ALLOWED_TYPES`, just before `'application/octet-stream'`:
```ts
  'image/vnd.dxf',               // DXF (CNC cut files)
  'application/dxf',
  'image/x-dxf',
```
Replace the `ALLOWED_EXTS` line and the `MAX_BYTES` line with:
```ts
const ALLOWED_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'pdf', 'ai', 'eps', 'svg', 'dxf']
```
Replace `files.length > 8` with `files.length > UPLOAD_BATCH`.
Replace the size check block with:
```ts
    if (f.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: `${f.name} is over the ${MAX_FILE_MB} MB limit. Share a WeTransfer or Google Drive link in the notes instead.` }, { status: 400 })
    }
```
Replace the type error message with:
```ts
      return NextResponse.json({ error: `${f.name}: file type not supported (use JPG, PNG, PDF, AI, EPS, SVG or DXF)` }, { status: 400 })
```

- [ ] **Step 4: Run** — `npx vitest run tests/upload-limits.test.ts tests/file-routes.test.ts` → all pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/upload-url/route.ts tests/upload-limits.test.ts
git commit -m "feat(upload): 95 MB per file, batches of 10, DXF"
```

---

### Task 4: Countdown helpers and the UI kit

**Files:** Create `src/lib/countdown.ts`, `src/components/cx/kit.tsx`; Test `tests/countdown.test.ts`

- [ ] **Step 1: Write the failing test — `tests/countdown.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { daysUntil, countdownLabel, prettyDate } from '@/lib/countdown'

describe('countdown', () => {
  const now = new Date(2026, 10, 15, 21, 30) // Nov 15, 9:30 pm local
  it('counts whole calendar days', () => {
    expect(daysUntil('2026-12-12', now)).toBe(27)
    expect(daysUntil('2026-11-16', now)).toBe(1)
    expect(daysUntil('2026-11-15', now)).toBe(0)
    expect(daysUntil('2026-11-10', now)).toBe(-5)
  })
  it('labels', () => {
    expect(countdownLabel(0)).toBe('Today')
    expect(countdownLabel(1)).toBe('Tomorrow')
    expect(countdownLabel(27)).toBe('27 days')
    expect(countdownLabel(-5)).toBe('5 days ago')
  })
  it('pretty dates', () => {
    expect(prettyDate('2026-12-12')).toBe('Sat, Dec 12')
  })
})
```

- [ ] **Step 2: Run it to see it fail** — `npx vitest run tests/countdown.test.ts` → FAIL (module missing).

- [ ] **Step 3: Create `src/lib/countdown.ts`**

```ts
// Client-side date helpers for countdowns ("27 days") in the browser's local time.
const localDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function daysUntil(isoDate: string, now: Date = new Date()): number {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((localDate(isoDate).getTime() - today.getTime()) / 86_400_000)
}

export function countdownLabel(days: number): string {
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days < 0) return `${-days} day${days === -1 ? '' : 's'} ago`
  return `${days} days`
}

/** "Sat, Dec 12" */
export function prettyDate(isoDate: string): string {
  return localDate(isoDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}
```

- [ ] **Step 4: Run** — `npx vitest run tests/countdown.test.ts` → 3 passed.

- [ ] **Step 5: Create `src/components/cx/kit.tsx`** (presentational only; the class names come from `ui.css`)

```tsx
import type { ReactNode, CSSProperties } from 'react'
import { Minus, Plus, X } from 'lucide-react'

// Building blocks of the "soft glass" design (see docs/design/client-experience-v2).
// Everything renders inside <Page>, which adds the .cx scope that ui.css needs.

export interface BrandLike { businessName: string; logoUrl: string | null; replyToEmail?: string | null }

export function Page({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div className="cx" style={style}>
      <div className="paper-grain">
        <div className="wrap">{children}</div>
      </div>
    </div>
  )
}

export function BrandLogo({ brand, height = 30 }: { brand: BrandLike; height?: number }) {
  return brand.logoUrl
    ? <img src={brand.logoUrl} alt={brand.businessName} className="logo" style={{ height }} />
    : <span style={{ fontWeight: 500, fontSize: 18, letterSpacing: '-0.02em' }}>{brand.businessName}</span>
}

export function SiteHead({ brand, right }: { brand: BrandLike; right?: ReactNode }) {
  return (
    <header className="site-head">
      <a href="/" aria-label={`${brand.businessName} home`}><BrandLogo brand={brand} /></a>
      {right && <div className="row small" style={{ gap: 18 }}>{right}</div>}
    </header>
  )
}

export function SiteFoot({ brand }: { brand: BrandLike }) {
  return (
    <footer className="between tiny muted stack-sm no-print" style={{ padding: '28px 0 36px', borderTop: '1px solid var(--line)', marginTop: 56 }}>
      <span>{brand.businessName} · Events, signage &amp; fabrication</span>
      {brand.replyToEmail && <span>Questions? <a className="link" href={`mailto:${brand.replyToEmail}`}>{brand.replyToEmail}</a></span>}
    </footer>
  )
}

export function SecHead({ n, title, aside }: { n: string; title: string; aside?: ReactNode }) {
  return (
    <div className="sec-head">
      <span className="sec-num">{n}</span>
      <h2 className="sec-title" style={{ margin: 0 }}>{title}</h2>
      {aside && <span style={{ marginLeft: 'auto' }}>{aside}</span>}
    </div>
  )
}

export type Tone = 'ok' | 'wait' | 'alert' | 'neutral' | 'gold'
export function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`pill pill-${tone}`}>{children}</span>
}

/** Label + control + error/hint. `data-error` lets the form scroll to the first problem. */
export function Field({ id, label, error, hint, full, children }: {
  id?: string; label: ReactNode; error?: string; hint?: ReactNode; full?: boolean; children: ReactNode
}) {
  return (
    <div className="field" data-error={error || undefined} style={full ? { gridColumn: '1 / -1' } : undefined}>
      {id ? <label className="label" htmlFor={id}>{label}</label> : <span className="label">{label}</span>}
      {children}
      {error ? <p className="err" role="alert">{error}</p> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  )
}

export function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" className="chip" aria-pressed={on} onClick={onClick}>{children}</button>
}

/** Quantity stepper that also accepts typing (24 table numbers shouldn't take 23 taps). */
export function Stepper({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const n = parseInt(value) || 0
  return (
    <div className="stepper">
      <button type="button" aria-label={`Fewer (${label})`} onClick={() => onChange(String(Math.max(1, n - 1)))}><Minus size={15} /></button>
      <input aria-label={label} inputMode="numeric" value={value} onChange={e => onChange(e.target.value.replace(/\D/g, '').slice(0, 5))} />
      <button type="button" aria-label={`More (${label})`} onClick={() => onChange(String(n + 1))}><Plus size={15} /></button>
    </div>
  )
}

export function FileRow({ name, size, progress, error, onRemove }: {
  name: string; size: string; progress: number; error?: string; onRemove: () => void
}) {
  const ext = (name.split('.').pop() ?? '').toUpperCase().slice(0, 4)
  return (
    <div className="filerow">
      <span className="fileicon">{ext}</span>
      <div className="stack" style={{ gap: 6, minWidth: 0 }}>
        <div className="between small">
          <span style={{ fontWeight: 500, overflowWrap: 'anywhere' }}>{name}</span>
          {!error && <span className="muted num tiny">{progress < 100 ? `${progress}% of ${size}` : size}</span>}
        </div>
        {error
          ? <p className="err">{error}</p>
          : <div className="bar"><span style={{ width: `${progress}%`, background: progress === 100 ? 'var(--sage)' : undefined }} /></div>}
      </div>
      <button type="button" aria-label={`Remove ${name}`} onClick={onRemove} style={{ background: 'none', border: 0, cursor: 'pointer', color: 'var(--muted)' }}><X size={16} /></button>
    </div>
  )
}
```

- [ ] **Step 6: Type-check** — `npx tsc --noEmit` → no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/countdown.ts src/components/cx/kit.tsx tests/countdown.test.ts
git commit -m "feat(ui): countdown helpers + soft-glass UI kit"
```

---

### Task 5: Intake form — logic changes

All edits are in `src/components/IntakeForm.tsx`. Behaviour of uploads, validation and submit stays the same except where noted.

- [ ] **Step 1: Imports.** Below the existing imports add:

```ts
import { Check, Copy, Plus, X, UploadCloud, ImageIcon, CalendarHeart, Hammer } from 'lucide-react'
import { Page, SiteHead, SiteFoot, SecHead, Field, Chip, Stepper, FileRow } from '@/components/cx/kit'
import { MAX_PIECES, MAX_FILES, MAX_ITEM_FILES, MAX_FILE_BYTES, MAX_FILE_MB } from '@/lib/limits'
import { daysUntil, countdownLabel, prettyDate } from '@/lib/countdown'
```

- [ ] **Step 2: Constants.** Replace the block from `const ALLOWED_EXTS = …` through `const STEPS = [...]` (the old lines 55–62, which include `MAX_FILES`, `MAX_ITEM_PHOTOS`, `MAX_BYTES` and `MATERIALS`) with:

```ts
const ALLOWED_EXTS = ['.jpg', '.jpeg', '.png', '.pdf', '.ai', '.eps', '.svg', '.dxf']
const IMG_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.gif']
const SHOT_ACCEPT = '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp'
const MATERIALS = ['vinyl', 'fabric', 'foam-board', 'acrylic', 'cardstock', 'wood', 'pvc', 'metal', 'other'] as const
const MATERIAL_LABELS: Record<string, string> = {
  vinyl: 'Vinyl', fabric: 'Fabric', 'foam-board': 'Foam board', acrylic: 'Acrylic', cardstock: 'Cardstock',
  wood: 'Wood', pvc: 'PVC', metal: 'Metal', other: 'Other',
}
const FULFILL_LABELS = { pickup: 'Pick up', delivery: 'Deliver', install: 'Install' } as const
type JobType = 'event' | 'product'
type Fulfillment = keyof typeof FULFILL_LABELS
```

- [ ] **Step 3: Renames inside the logic.** Make these exact replacements (each occurs where listed):

| Old | New |
|---|---|
| `MAX_ITEM_PHOTOS` (2×, in `validateAndAddItemPhotos`) | `MAX_ITEM_FILES` |
| `MAX_BYTES` (3×) | `MAX_FILE_BYTES` |
| `` err = `${f.name}: exceeds 50MB` `` | `` err = `${f.name}: over ${MAX_FILE_MB} MB` `` |
| `'Screenshot exceeds 50MB'` | `` `Screenshot is over ${MAX_FILE_MB} MB` `` |
| `` fileErrs.push(`${f.name}: exceeds 50MB`) `` | `` fileErrs.push(`${f.name}: over ${MAX_FILE_MB} MB`) `` |

Check: `grep -n "50MB\|MAX_BYTES\|MAX_ITEM_PHOTOS\|STEPS" src/components/IntakeForm.tsx` prints only lines inside the old render (which Task 6 replaces).

- [ ] **Step 4: State.** Change the initial item's `quantity: ''` to `quantity: '1'`. Change `useRef<(HTMLDivElement | null)[]>([])` to `useRef<(HTMLElement | null)[]>([])`. After the `submitMode` state add:

```ts
  // Event (date + venue) or products & fabrication (needed-by date + hand-over).
  const [jobType, setJobType] = useState<JobType>('event')
  const [fulfillment, setFulfillment] = useState<Fulfillment>('pickup')
```

- [ ] **Step 5: Step tracker.** Replace the scroll `useEffect` (the one defining `onScroll`) with:

```ts
  // Sections 0–2 are tracked by scroll position. 3 is the sticky summary card,
  // which is always near the top on desktop, so it lights up at the page end.
  useEffect(() => {
    function onScroll() {
      let active = 0
      sectionRefs.current.slice(0, 3).forEach((el, i) => {
        if ((el?.getBoundingClientRect().top ?? 9999) < 200) active = i
      })
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 80) active = 3
      setActiveStep(prev => prev === active ? prev : active)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
```

- [ ] **Step 6: Item management.** Replace `addItem` with:

```ts
  function addItem() {
    if (items.length >= MAX_PIECES) return
    setItems(prev => [...prev, { id: genId(), name: '', quantity: '1', size: '', material: '', description: '', artwork: submitMode }])
  }
```
and add these two functions right after `updateItem` (they are the old inline `onClick` handlers of the two artwork toggles, unchanged in behaviour):

```ts
  // Job-wide default: sets every piece; each piece can still be switched.
  function chooseSubmitMode(val: 'design' | 'final') {
    setSubmitMode(val)
    setItems(prev => prev.map(i => ({ ...i, artwork: val })))
    setErrors(prev => { const e = { ...prev }; Object.keys(e).forEach(k => { if (k.endsWith('-photos') || k.endsWith('-shot')) delete e[k] }); return e })
    if (val === 'design') {
      setItemUploads(prev => Object.fromEntries(Object.entries(prev).map(([id, ups]) => [id, ups.filter(u => u.file.type.startsWith('image/'))])))
      setItemShots({})
    }
  }

  function chooseItemArtwork(itemId: string, val: 'design' | 'final') {
    updateItem(itemId, 'artwork', val)
    setErrors(prev => { const e = { ...prev }; delete e[`item-${itemId}-photos`]; delete e[`item-${itemId}-shot`]; return e })
    // Back to "design it for me": print files and the screenshot no longer apply.
    if (val === 'design') {
      setItemUploads(prev => ({ ...prev, [itemId]: (prev[itemId] ?? []).filter(u => u.file.type.startsWith('image/')) }))
      removeItemShot(itemId)
    }
  }
```
(`removeItemShot` is a function declaration further down; hoisting makes this call fine.)

- [ ] **Step 7: Validation.** In `validate()`, replace the two `dateRequired` lines with:

```ts
    const dateWord = jobType === 'event' ? 'Event date' : 'Needed-by date'
    if (!dateRequired) errs.dateRequired = `${dateWord} is needed`
    if (dateRequired && dateRequired <= todayStr()) errs.dateRequired = `${dateWord} must be in the future`
    if (jobType === 'product' && fulfillment !== 'pickup' && !setupLocation.trim()) {
      errs.setupLocation = fulfillment === 'install' ? 'Add the install address' : 'Add the delivery address'
    }
```

- [ ] **Step 8: Payload.** In `handleSubmit`, replace the four logistics lines of `payload` (`setupLocation` … `removalTime`) with:

```ts
        jobType,
        fulfillment: jobType === 'product' ? fulfillment : undefined,
        // Events: venue + setup/removal. Products: delivery/install address + time (none for pickup).
        setupLocation: jobType === 'product' && fulfillment === 'pickup' ? undefined : setupLocation.trim() || undefined,
        setupTime: jobType === 'product' && fulfillment === 'pickup' ? undefined : setupTime.trim() || undefined,
        removalLocation: jobType === 'event' ? removalLocation.trim() || undefined : undefined,
        removalTime: jobType === 'event' ? removalTime.trim() || undefined : undefined,
```

- [ ] **Step 9: Tenant theme.** Replace the `theme` constant at the top of the component with:

```ts
  // DDF keeps the stock mauve; other shops (/s/{slug}) tint the accent with their brand colour.
  const theme: CSSProperties = branding.logoInvert ? {} : ({
    ['--mauve']: branding.brandColor,
    ['--mauve-deep']: shade(branding.brandColor, 0.18),
    ['--mauve-wash']: tint(branding.brandColor, 0.92),
  } as CSSProperties)
```
and delete the `brandLogo` constant (the kit's `SiteHead` renders the logo now).

- [ ] **Step 10: Type-check the logic so far**

Run: `npx tsc --noEmit`
Expected: errors only inside the old render (unknown `STEPS`, `brandLogo`, `MAX_ITEM_PHOTOS`, `inputStyle` usage etc.). Task 6 replaces that code. Don't commit yet.

---

### Task 6: Intake form — new render

**Files:** Modify `src/components/IntakeForm.tsx`

- [ ] **Step 1: Replace everything from the line `  // ── Success screen` to the end of the file** with:

```tsx
  // ── Success screen ────────────────────────────────────────────────────────
  if (refNumber) {
    const first = clientName.trim().split(/\s+/)[0] || 'there'
    const anyFinal = items.some(i => i.artwork === 'final')
    return (
      <Page style={theme}>
        <SiteHead brand={branding} />
        <section style={{ padding: '56px 0', display: 'grid', gap: 18, maxWidth: 640 }}>
          <span className="eyebrow">Brief received</span>
          <h1 className="display hero-title" style={{ margin: 0 }}>Thank you, <span className="serif">{first}.</span></h1>
          <p className="muted" style={{ margin: 0, fontSize: 17 }}>
            We’ve emailed a copy to {contactEmail.trim()}. Your reference opens your job page any time.
          </p>
          <div className="ticket" style={{ maxWidth: 440 }}>
            <div className="t-label">Reference</div>
            <div className="between" style={{ marginTop: 8 }}>
              <span className="t-ref" style={{ fontSize: 18 }}>{refNumber}</span>
              <button type="button" className="btn btn-sm" style={{ background: 'rgba(255,255,255,.12)', color: '#fff' }} onClick={copyRef}>
                {copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy</>}
              </button>
            </div>
            <div className="tear" />
            <ol className="stack small" style={{ margin: 0, paddingLeft: 18, gap: 8, color: 'rgba(243,238,241,.85)' }}>
              <li>We review your brief today or next business day.</li>
              <li>You get a quote{anyFinal ? '' : ' and first proofs'} by email.</li>
              <li>{anyFinal ? 'Your print-ready files go to production once we confirm sizing.' : 'Approve each design online. Then we make it.'}</li>
            </ol>
          </div>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <a className="btn btn-ink" href="/portal">Open my job page</a>
            <a className="btn btn-quiet" href={slug === 'ddf' ? '/' : `/s/${slug}`}>Send another brief</a>
          </div>
          <p className="tiny muted" style={{ margin: 0 }}>Your brief is saved. No need to send it again.</p>
        </section>
        <SiteFoot brand={branding} />
      </Page>
    )
  }

  // ── Main layout ───────────────────────────────────────────────────────────
  const isEvent = jobType === 'event'
  const units = items.reduce((s, i) => s + (parseInt(i.quantity) || 0), 0)
  const fileCount = uploads.filter(u => !u.error).length + Object.values(itemUploads).flat().filter(u => !u.error).length
  const days = dateRequired ? daysUntil(dateRequired) : null
  const steps = ['About the job', 'Your pieces', isEvent ? 'Event & files' : 'Delivery & files', 'Review & send']
  const named = items.filter(i => i.name.trim())
  const placeLine = isEvent
    ? (setupLocation.trim() || 'Venue to be confirmed')
    : fulfillment === 'pickup' ? 'Pickup at our shop' : (setupLocation.trim() || `${fulfillment === 'install' ? 'Install' : 'Delivery'} address needed`)

  return (
    <Page style={theme}>
      <SiteHead
        brand={branding}
        right={<><span className="muted hide-sm">Already sent a brief?</span><a className="btn btn-quiet btn-sm" href="/portal">Track your job</a></>}
      />

      <section style={{ padding: '40px 0 28px', display: 'grid', gap: 16, maxWidth: 820 }}>
        <span className="eyebrow">New brief · replies within 1 business day</span>
        <h1 className="display hero-title" style={{ margin: 0 }}>Tell us what you’re <span className="serif">making.</span></h1>
        <p className="muted" style={{ margin: 0, maxWidth: 580, fontSize: 17 }}>
          Event décor, signage, displays and custom fabrication. Send the details and we’ll come back with a quote or your first proof.
        </p>
      </section>

      <ol className="steps glass hide-sm no-print" style={{ listStyle: 'none', margin: '0 0 30px' }} aria-label="Brief sections">
        {steps.map((s, i) => (
          <li key={s} className="step" data-state={i < activeStep ? 'done' : i === activeStep ? 'current' : 'next'}>
            <button type="button" onClick={() => scrollToSection(i)} style={{ all: 'unset', display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer' }}>
              <span className="s-num">{i < activeStep ? <Check size={12} /> : i + 1}</span>
              <span className="small" style={{ fontWeight: 500 }}>{s}</span>
            </button>
          </li>
        ))}
      </ol>

      <form onSubmit={handleSubmit} noValidate className="split">
        <div className="stack" style={{ gap: 40 }}>
          {/* 01 + 02 — what it's for, who you are */}
          <div ref={el => { sectionRefs.current[0] = el }} className="stack" style={{ gap: 40 }}>
            <section>
              <SecHead n="01" title="What’s it for?" />
              <div className="grid2">
                <KindCard on={isEvent} onClick={() => setJobType('event')} icon={<CalendarHeart size={20} />}
                  title="An event" body="Weddings, galas, launches. Dance floors, backdrops and signage, delivered and installed for your date." />
                <KindCard on={!isEvent} onClick={() => setJobType('product')} icon={<Hammer size={20} />}
                  title="Products & fabrication" body="CNC wood pieces, signs, displays and large-format prints. Picked up, delivered or installed." />
              </div>
              <div className="row" style={{ marginTop: 16, flexWrap: 'wrap', gap: 8 }}>
                <span className="label" style={{ marginRight: 4 }}>Artwork</span>
                <Chip on={submitMode === 'design'} onClick={() => chooseSubmitMode('design')}>Design it for me</Chip>
                <Chip on={submitMode === 'final'} onClick={() => chooseSubmitMode('final')}>I have print-ready files</Chip>
              </div>
            </section>

            <section>
              <SecHead n="02" title="About you" />
              <div className="grid2">
                <Field id="f-name" label="Full name" error={errors.clientName}>
                  <input id="f-name" className="input" autoComplete="name" value={clientName} onChange={e => setClientName(e.target.value)} placeholder="Jane Smith" aria-invalid={!!errors.clientName} />
                </Field>
                <Field id="f-co" label="Company" error={errors.companyName}>
                  <input id="f-co" className="input" autoComplete="organization" value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="Acme Events" aria-invalid={!!errors.companyName} />
                </Field>
                <Field id="f-mail" label="Email" error={errors.contactEmail} hint="Proofs and approval links go here." full>
                  <input id="f-mail" type="email" className="input" autoComplete="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)} placeholder="jane@acmeevents.com" aria-invalid={!!errors.contactEmail} />
                </Field>
              </div>
            </section>
          </div>

          {/* 03 — pieces */}
          <section ref={el => { sectionRefs.current[1] = el }}>
            <SecHead n="03" title="Your pieces" aside={<span className="tiny muted">{items.length} of {MAX_PIECES}</span>} />
            <div className="stack" style={{ gap: 14 }}>
              {items.map((item, idx) => {
                const ups = itemUploads[item.id] ?? []
                return (
                  <article key={item.id} className="piece">
                    <div className="between">
                      <span className="row" style={{ gap: 10 }}>
                        <span className="piece-num">{String(idx + 1).padStart(2, '0')}</span>
                        <b style={{ fontWeight: 500 }}>{item.name.trim() || 'New piece'}</b>
                      </span>
                      {items.length > 1 && <button type="button" className="link tiny" onClick={() => removeItem(item.id)}>Remove</button>}
                    </div>

                    <div className="grid2">
                      <Field id={`p-name-${item.id}`} label="What is it?" error={errors[`item-${idx}-name`]}>
                        <input id={`p-name-${item.id}`} className="input" value={item.name} onChange={e => updateItem(item.id, 'name', e.target.value)}
                          placeholder={isEvent ? 'e.g. Welcome sign' : 'e.g. Menu board'} aria-invalid={!!errors[`item-${idx}-name`]} />
                      </Field>
                      <div className="grid2" style={{ gap: 14 }}>
                        <Field label="Quantity" error={errors[`item-${idx}-qty`]}>
                          <Stepper label={`quantity of piece ${idx + 1}`} value={item.quantity} onChange={v => updateItem(item.id, 'quantity', v)} />
                        </Field>
                        <Field id={`p-size-${item.id}`} label="Size" error={errors[`item-${idx}-size`]}>
                          <input id={`p-size-${item.id}`} className="input" value={item.size} onChange={e => updateItem(item.id, 'size', e.target.value)}
                            placeholder="24 × 36 in" aria-invalid={!!errors[`item-${idx}-size`]} />
                        </Field>
                      </div>
                    </div>

                    <Field label="Material" error={errors[`item-${idx}-material`]}>
                      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
                        {MATERIALS.map(m => <Chip key={m} on={item.material === m} onClick={() => updateItem(item.id, 'material', m)}>{MATERIAL_LABELS[m]}</Chip>)}
                      </div>
                    </Field>

                    <Field id={`p-desc-${item.id}`} label={item.artwork === 'design' ? 'Describe the look' : 'Anything we should know?'}>
                      <textarea id={`p-desc-${item.id}`} className="input" value={item.description} onChange={e => updateItem(item.id, 'description', e.target.value)}
                        placeholder="Colours, finish, fonts, wording, inspiration…" />
                    </Field>

                    <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
                      <span className="label" style={{ marginRight: 4 }}>Artwork</span>
                      <Chip on={item.artwork === 'design'} onClick={() => chooseItemArtwork(item.id, 'design')}>Design it for me</Chip>
                      <Chip on={item.artwork === 'final'} onClick={() => chooseItemArtwork(item.id, 'final')}>I have the final file</Chip>
                    </div>

                    {item.artwork === 'final' ? (
                      <div className="grid2">
                        <Field label="Print-ready file" error={errors[`item-${item.id}-photos`]} hint="Goes straight to print, exactly as supplied.">
                          <label className="drop" style={{ padding: 18, cursor: 'pointer' }}>
                            <UploadCloud size={22} color="var(--mauve-deep)" />
                            <b style={{ fontWeight: 500 }}>Add file</b>
                            <span className="tiny muted">PDF · AI · EPS · SVG · DXF · PNG · JPG</span>
                            <input type="file" multiple hidden accept={ALLOWED_EXTS.join(',')} onChange={e => { validateAndAddItemPhotos(item.id, e.target.files); e.target.value = '' }} />
                          </label>
                          {ups.map(u => (
                            <FileRow key={u.path} name={u.file.name} size={fmtBytes(u.file.size)} progress={u.progress} error={u.error} onRemove={() => removeItemPhoto(item.id, u.path)} />
                          ))}
                        </Field>
                        {(() => {
                          const shot = itemShots[item.id]
                          const needShot = ups.some(u => !u.file.type.startsWith('image/'))
                          const shotErr = errors[`item-${item.id}-shot`] ?? shot?.error
                          return (
                            <Field label={needShot ? 'Screenshot of the design (needed)' : 'Screenshot of the design'} error={shotErr}
                              hint="So our team can see it. PDF, AI and EPS don’t preview in a browser.">
                              {shot ? (
                                <div className="row" style={{ gap: 12 }}>
                                  <div className="thumb sm"><img src={URL.createObjectURL(shot.file)} alt="Design screenshot" /></div>
                                  <div className="stack" style={{ gap: 6 }}>
                                    <span className="small">{shot.busy ? 'Uploading…' : shot.error ? '' : 'Screenshot added'}</span>
                                    <div className="row" style={{ gap: 12 }}>
                                      <label className="link tiny" style={{ cursor: 'pointer' }}>
                                        Replace<input type="file" hidden accept={SHOT_ACCEPT} onChange={e => { setItemShot(item.id, e.target.files); e.target.value = '' }} />
                                      </label>
                                      <button type="button" className="link tiny" onClick={() => removeItemShot(item.id)}>Remove</button>
                                    </div>
                                  </div>
                                </div>
                              ) : (
                                <label className="drop" style={{ padding: 18, cursor: 'pointer' }}>
                                  <ImageIcon size={22} color="var(--mauve-deep)" />
                                  <b style={{ fontWeight: 500 }}>Add screenshot</b>
                                  <span className="tiny muted">JPG or PNG of how it should look</span>
                                  <input type="file" hidden accept={SHOT_ACCEPT} onChange={e => { setItemShot(item.id, e.target.files); e.target.value = '' }} />
                                </label>
                              )}
                            </Field>
                          )
                        })()}
                      </div>
                    ) : (
                      <Field label="Inspiration or images to use (optional)" error={errors[`item-${item.id}-photos`]}>
                        <div className="thumbs">
                          {ups.map(u => (
                            <div key={u.path} className="thumb" title={u.file.name}>
                              {u.error ? <span className="err" style={{ padding: 6, textAlign: 'center' }}>{u.error}</span>
                                : u.progress < 100 ? <span className="num">{u.progress}%</span>
                                : <img src={URL.createObjectURL(u.file)} alt="" />}
                              <button type="button" className="x" aria-label={`Remove ${u.file.name}`} onClick={() => removeItemPhoto(item.id, u.path)}><X size={12} /></button>
                            </div>
                          ))}
                          {ups.length < MAX_ITEM_FILES && (
                            <label className="thumb thumb-add" aria-label="Add images">
                              +<input type="file" multiple hidden accept={IMG_EXTS.join(',')} onChange={e => { validateAndAddItemPhotos(item.id, e.target.files); e.target.value = '' }} />
                            </label>
                          )}
                        </div>
                      </Field>
                    )}
                  </article>
                )
              })}
              <button type="button" className="btn btn-quiet" disabled={items.length >= MAX_PIECES} onClick={addItem}>
                <Plus size={15} /> Add another piece
              </button>
            </div>
          </section>

          {/* 04 — date, place, files */}
          <section ref={el => { sectionRefs.current[2] = el }}>
            <SecHead n="04" title={isEvent ? 'Event & files' : 'Delivery & files'} />
            <div className="stack" style={{ gap: 18 }}>
              <div className="grid2">
                <Field id="f-date" label={isEvent ? 'Event date' : 'Needed by'} error={errors.dateRequired}
                  hint={days !== null && days > 0 ? `${days} day${days === 1 ? '' : 's'} from today.` : undefined}>
                  <input id="f-date" type="date" className="input" min={todayStr()} value={dateRequired} onChange={e => setDateRequired(e.target.value)} aria-invalid={!!errors.dateRequired} />
                </Field>
                <Field id="f-event" label={isEvent ? 'Event name' : 'Project name (optional)'}>
                  <input id="f-event" className="input" value={eventName} onChange={e => setEventName(e.target.value)} placeholder={isEvent ? 'Brand Launch 2026' : 'Winter menu refresh'} />
                </Field>
              </div>

              {isEvent ? (
                <div className="grid2">
                  <Field id="f-setup" label="Venue / setup location">
                    <input id="f-setup" className="input" value={setupLocation} onChange={e => setSetupLocation(e.target.value)} placeholder="Venue name and address" />
                  </Field>
                  <Field id="f-setup-t" label="Setup time">
                    <input id="f-setup-t" className="input" value={setupTime} onChange={e => setSetupTime(e.target.value)} placeholder="e.g. Sat Dec 12, 9:00 AM" />
                  </Field>
                  <Field id="f-rem" label="Removal location">
                    <input id="f-rem" className="input" value={removalLocation} onChange={e => setRemovalLocation(e.target.value)} placeholder="Same as setup, or other" />
                  </Field>
                  <Field id="f-rem-t" label="Removal time">
                    <input id="f-rem-t" className="input" value={removalTime} onChange={e => setRemovalTime(e.target.value)} placeholder="e.g. Sun Dec 13, 11:00 PM" />
                  </Field>
                </div>
              ) : (
                <>
                  <Field label="How should we hand it over?">
                    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                      {(Object.keys(FULFILL_LABELS) as Fulfillment[]).map(f => (
                        <Chip key={f} on={fulfillment === f} onClick={() => setFulfillment(f)}>{FULFILL_LABELS[f]}</Chip>
                      ))}
                    </div>
                  </Field>
                  {fulfillment !== 'pickup' && (
                    <div className="grid2">
                      <Field id="f-addr" label={fulfillment === 'install' ? 'Install address' : 'Delivery address'} error={errors.setupLocation}>
                        <input id="f-addr" className="input" autoComplete="street-address" value={setupLocation} onChange={e => setSetupLocation(e.target.value)} placeholder="Street, city" aria-invalid={!!errors.setupLocation} />
                      </Field>
                      <Field id="f-when" label={fulfillment === 'install' ? 'Install time' : 'Delivery window'}>
                        <input id="f-when" className="input" value={setupTime} onChange={e => setSetupTime(e.target.value)} placeholder="e.g. Thu Nov 26, morning" />
                      </Field>
                    </div>
                  )}
                </>
              )}

              <Field label="Files for the whole job" error={errors.files}>
                {uploads.length < MAX_FILES && (
                  <div
                    className="drop" role="button" tabIndex={0}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current?.click() } }}
                    onDragOver={e => { e.preventDefault(); setDropOver(true) }}
                    onDragLeave={() => setDropOver(false)}
                    onDrop={e => { e.preventDefault(); setDropOver(false); validateAndAddFiles(e.dataTransfer.files) }}
                    onClick={() => fileInputRef.current?.click()}
                    style={dropOver ? { borderColor: 'var(--mauve-deep)', background: 'var(--mauve-wash)' } : undefined}
                  >
                    <input ref={fileInputRef} type="file" multiple hidden accept={ALLOWED_EXTS.join(',')} onChange={e => { validateAndAddFiles(e.target.files); e.target.value = '' }} />
                    <UploadCloud size={26} color="var(--mauve-deep)" />
                    <b style={{ fontWeight: 500 }}>Drop {submitMode === 'design' ? 'inspiration photos, logos or files' : 'your print-ready files'} here</b>
                    <span className="tiny muted">JPG, PNG, PDF, AI, EPS, SVG or DXF · up to {MAX_FILES} files · {MAX_FILE_MB} MB each</span>
                    <span className="btn btn-quiet btn-sm" style={{ marginTop: 6 }}>Choose files</span>
                  </div>
                )}
                {uploads.map(u => (
                  <FileRow key={u.path} name={u.file.name} size={fmtBytes(u.file.size)} progress={u.progress} error={u.error} onRemove={() => removeUpload(u.path)} />
                ))}
              </Field>
              <p className="tiny muted" style={{ margin: 0 }}>Bigger than {MAX_FILE_MB} MB? Put a WeTransfer or Google Drive link in the notes.</p>

              <Field id="f-notes" label="Anything else?">
                <textarea id="f-notes" className="input" value={notes} onChange={e => setNotes(e.target.value)}
                  placeholder={isEvent ? 'Finishing, access at the venue, timing…' : 'Finishing, packaging, delivery instructions…'} />
              </Field>
            </div>
          </section>
        </div>

        {/* Summary card + send */}
        <aside ref={el => { sectionRefs.current[3] = el }} className="sticky stack" style={{ gap: 14 }}>
          <div className="ticket">
            <div className="t-label">Your brief</div>
            <div className="display" style={{ fontSize: 30, marginTop: 10, color: '#fff' }}>
              {eventName.trim() || companyName.trim() || (isEvent ? 'Your event' : 'Your order')}
            </div>
            <div className="small" style={{ color: 'rgba(243,238,241,.7)', marginTop: 4 }}>{placeLine}</div>
            <div className="tear" />
            <div className="grid2" style={{ gap: 14 }}>
              <TicketStat label={isEvent ? 'Event' : 'Needed by'} value={dateRequired ? prettyDate(dateRequired) : '—'} />
              <TicketStat label="Countdown" value={days === null ? '—' : countdownLabel(days)} />
              <TicketStat label="Pieces" value={`${items.length} · ${units} unit${units === 1 ? '' : 's'}`} />
              <TicketStat label="Files" value={String(fileCount)} />
            </div>
            {named.length > 0 && (
              <>
                <div className="tear" />
                <ul className="small" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4, color: 'rgba(243,238,241,.82)' }}>
                  {named.slice(0, 6).map(i => <li key={i.id}>{parseInt(i.quantity) || 1} × {i.name.trim()}</li>)}
                  {named.length > 6 && <li>+{named.length - 6} more</li>}
                </ul>
              </>
            )}
            <div className="tear" />
            <div className="small" style={{ color: 'rgba(243,238,241,.82)' }}>
              {submitMode === 'design' ? 'First proofs within 2–3 business days. You approve each design online.' : 'Your files go to production once we confirm sizing.'}
            </div>
          </div>

          <label className="check-row">
            <input type="checkbox" checked={confirmed} onChange={e => { setConfirmed(e.target.checked); if (e.target.checked) setErrors(p => { const er = { ...p }; delete er.confirmed; return er }) }} />
            <span>I confirm these details are correct and that I own or have permission to use the artwork I’ve supplied.</span>
          </label>
          {errors.confirmed && <p className="err" data-error={errors.confirmed}>{errors.confirmed}</p>}
          {submitError && <div className="alert" role="alert">{submitError}</div>}

          {/* Honeypot */}
          <div className="hp" aria-hidden="true"><input name="_hp" tabIndex={-1} autoComplete="off" /></div>

          <button type="submit" className="btn btn-ink btn-block" disabled={submitting}>{submitting ? 'Sending…' : 'Send brief'}</button>
          <p className="tiny muted" style={{ margin: 0, textAlign: 'center' }}>No payment now. We quote first.</p>
        </aside>
      </form>

      <SiteFoot brand={branding} />
    </Page>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function KindCard({ on, onClick, title, body, icon }: { on: boolean; onClick: () => void; title: string; body: string; icon: React.ReactNode }) {
  return (
    <button type="button" className="mode" aria-pressed={on} onClick={onClick}>
      <span className="check">{on && <Check size={13} />}</span>
      <span className="kind-icon">{icon}</span>
      <span style={{ fontSize: 20, fontWeight: 400, letterSpacing: '-0.02em', paddingRight: 30 }}>{title}</span>
      <span className="small muted">{body}</span>
    </button>
  )
}

function TicketStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="t-label">{label}</div>
      <div className="num" style={{ fontWeight: 500, marginTop: 4 }}>{value}</div>
    </div>
  )
}
```

- [ ] **Step 2: Remove the leftovers.** `scrollToSection` stays. Delete the `useCallback` import if `tsc` reports it unused.

- [ ] **Step 3: Type-check, lint, build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: all clean. (`next build` fails on a type error, so the build is the real gate.)

- [ ] **Step 4: Compare with the mockup.** Start the app (`npm run dev`, with the dev database from Phase 1 running) and open `/` next to `docs/design/client-experience-v2/mockup.html` (Intake tab):
  1. At 1360 px wide: hero, step bar, two-column layout with the dark summary card on the right, sticky while scrolling.
  2. At 390 px wide (browser dev tools, iPhone 14): single column, no step bar, summary card after section 04, buttons full width.
  3. Toggle **Products & fabrication**: date label becomes "Needed by", hand-over chips appear, "Deliver" shows the address fields, the summary card's place line updates.
  4. Add 30 pieces: the add button disables at 30 ("30 of 30").
  5. Upload a 60 MB PDF to "Files for the whole job" (progress bar fills, then green). Upload a `.dxf`.
  6. Submit an empty form: the page scrolls to the first error; errors show in rose under each field.
  7. Submit a real brief (event, one piece, one image). Success screen shows "Thank you, <first name>." with the reference and Copy.
  8. `/s/<another-tenant-slug>` (if a second tenant exists): accent colour follows that shop's brand colour.

Fix any difference, then:

- [ ] **Step 5: Commit**

```bash
git add src/components/IntakeForm.tsx
git commit -m "feat(intake): soft-glass intake form with events vs products, 30 pieces, 95 MB files"
```

---

### Task 7: Store the job type on submit

Requires Plan B Task 1 (`job_type` / `fulfillment` columns and `NewJob` fields). Check: `grep -n "job_type" src/lib/jobs-repo.ts` must print lines. If it doesn't, stop and merge Plan B first.

**Files:** Modify `src/app/api/submit/route.ts`

- [ ] **Step 1: Pass the fields to `insertJob`.** In the `insertJob({ … })` call, after `status: 'pending',` add:

```ts
    job_type: data.jobType,
    fulfillment: data.jobType === 'product' ? data.fulfillment ?? null : null,
```

- [ ] **Step 2: Verify end to end** (app running locally)

Submit one product brief from `/` (Products & fabrication → Deliver → address), then:

```bash
docker compose exec -T db psql -U ddf -d ddf_dev -c \
  "select reference_number, job_type, fulfillment, setup_location from jobs order by id desc limit 1"
```
Expected: `product | delivery | <the address you typed>`.

Then submit an event brief and check the same query shows `event` with an empty `fulfillment`. Delete only these two test jobs, by their exact ids, from the admin page.

- [ ] **Step 3: Type-check and test** — `npx tsc --noEmit && npx vitest run` → all green.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/submit/route.ts
git commit -m "feat(submit): store job_type and fulfillment"
```

---

### Task 8: Admin login restyle

**Files:** Modify `src/app/login/page.tsx`

- [ ] **Step 1: Replace the `input` / `label` style constants and the whole `return (…)`** (keep the imports, state, `useEffect` and `handleSubmit` from Phase 1 exactly as they are) with:

```tsx
  return (
    <main className="cx">
      <div className="paper-grain" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 20 }}>
        <div className="panel" style={{ width: '100%', maxWidth: 420, padding: '40px 34px', display: 'grid', gap: 22 }}>
          <div style={{ display: 'grid', gap: 14 }}>
            <img src="/logo-ddfpixel.png" alt="DDF x Pixel" className="logo" style={{ height: 40 }} />
            <h1 className="display" style={{ margin: 0, fontSize: 40 }}>Welcome <span className="serif">back.</span></h1>
            <p className="muted" style={{ margin: 0 }}>Sign in to manage jobs.</p>
          </div>
          <form onSubmit={handleSubmit} className="stack" style={{ gap: 16 }}>
            <div className="field">
              <label className="label" htmlFor="l-email">Email</label>
              <input id="l-email" className="input" type="email" required autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} placeholder="admin@ddfevents.ca" />
            </div>
            <div className="field">
              <label className="label" htmlFor="l-pass">Password</label>
              <input id="l-pass" className="input" type="password" required autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" />
            </div>
            {error && <div className="alert" role="alert">{error}</div>}
            <button type="submit" className="btn btn-ink btn-block" disabled={loading}>{loading ? 'Signing in…' : 'Sign in'}</button>
          </form>
          <a className="link tiny" href="/portal" style={{ justifySelf: 'center' }}>Looking for your job? Open the client portal</a>
        </div>
      </div>
    </main>
  )
```
(`.panel` is the white rounded card from `ui.css`.)

- [ ] **Step 2: Check** — `npx tsc --noEmit && npm run build`, then open `/login` at 390 px and 1360 px: centred white card on the mauve/stone wash, black pill button. Sign in with your admin user and confirm you land on `/admin`.

- [ ] **Step 3: Commit**

```bash
git add src/app/login/page.tsx
git commit -m "feat(login): soft-glass admin sign-in"
```

---

### Task 9: Verify and hand off

- [ ] **Step 1: Full checks**

```bash
docker compose up -d db
npx tsc --noEmit
npm run lint
npx vitest run
npm run build
```
Expected: all green.

- [ ] **Step 2: Phase 1 smoke script** — run it the way `SYSTEM_STATE.md` describes (it submits a brief through the API). Expected: passes. The smoke brief is an event; its job type must show as `event`.

- [ ] **Step 3: Screenshots for the owner.** Take four screenshots of `/` (desktop + phone, event + products) and one of `/login`, and attach them to the PR description so the owner can compare against the mockup.

- [ ] **Step 4: Finish the branch** — use superpowers:finishing-a-development-branch (PR into `main`, owner merges).
