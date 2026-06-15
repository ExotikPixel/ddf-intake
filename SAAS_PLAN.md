# Turning DDF Intake into a SaaS Product

A complete plan to take the current single-tenant intake/proofing/approval app and sell it
to other businesses as a subscription product.

---

## 1. What you already have (the asset)

The app today is a working, opinionated workflow tool:

- **Client intake** — branded submission form (`/api/submit`) that captures job details.
- **File uploads** — direct-to-Supabase signed uploads (`/api/upload-url`), handles large art files.
- **Admin dashboard** — manage jobs and files (`/admin`, `/api/admin/*`).
- **Proofing & approval** — review-token links (`/review/[token]`), client portal approval
  (`/portal`, `/api/portal/jobs/[id]/approve`), and an admin "Approved for Print" action.
- **Production output** — cross-job Production Sheet and Approved Designs sheet grouped by event date.
- **Notifications** — ntfy phone push + Brevo email on new jobs and approvals.
- **Billing handoff** — webhook that drafts invoices in a separate Command Centre app.

Stack: Next.js 16, React 19, Supabase (Postgres + Storage + Auth), Tailwind 4, deployed on Vercel.

**This is already 70% of a vertical SaaS.** The missing 30% is multi-tenancy, self-serve
onboarding, billing, and the commercial wrapper.

---

## 2. Positioning — who you sell to

Pick ONE beachhead vertical first. Do not sell "intake software" to everyone.

| Candidate vertical | Why it fits | Pain you remove |
|---|---|---|
| **Event decor / balloon & backdrop studios** (your origin) | You know the workflow cold | Chasing approvals over text/DM, lost art files, no proof trail |
| Custom print shops (signage, apparel, DTG) | Same proof→approve→produce loop | Reprints from unapproved art = lost margin |
| Small design agencies / freelancers | Client revisions chaos | "Did the client actually sign off?" |

**Recommended beachhead:** event decor + small print shops. You have lived the workflow,
the production-sheet-by-event-date feature is a wedge competitors don't have, and these
buyers are underserved by generic tools (Trello, Google Forms, email).

**One-line positioning:**
> "The client intake-to-approval system for print & event shops. Collect the brief, send the
> proof, get a signed-off approval, and print the production sheet — without the group chat."

---

## 3. The core productization work (single-tenant → multi-tenant)

This is the engineering spine. Do it in this order.

### Phase A — Multi-tenancy (non-negotiable)
1. Add a `tenants` (workspaces/orgs) table. Every domain row (`jobs`, `files`, `submissions`,
   `approvals`) gets a `tenant_id`.
2. Enforce isolation with **Supabase Row Level Security** keyed on `tenant_id` from the JWT —
   not just app-layer filtering. This is your security boundary; get it right early.
3. Scope Storage buckets/paths per tenant (`tenant_id/job_id/...`).
4. Make review/portal tokens tenant-aware so links can't cross workspaces.

### Phase B — Tenant configuration (replace hardcoded DDF branding)
- Per-tenant settings: business name, logo, brand colors, reply-to email, ntfy topic, custom
  intake fields. The current rebrand-to-DDF work proves this is needed — generalize it into a
  settings table instead of constants.
- Custom subdomain or `app.yourdomain.com/{slug}` for each tenant's intake form.
- Optional custom domain for the client-facing intake/proof pages (premium tier).

### Phase C — Onboarding & auth
- Self-serve signup → creates tenant + first admin user (Supabase Auth).
- Team invites (multiple staff per workspace, roles: owner/admin/staff).
- Guided first-run: create first job, send first proof, see the approval land.

### Phase D — Billing (Square)
- **Square** for subscriptions — the business already runs on Square, so keep payments,
  payouts, and reconciliation in one place. **Reuse the Command Centre integration**: it already
  calls Square via raw REST `fetch` (no SDK) and has a working webhook signature verifier — copy
  that pattern. Net-new here vs Command Centre (which does one-time invoice payments): create
  **Catalog subscription Plans** per tier and use the **Subscriptions API** for recurring billing.
- Store the Square `customer_id` and `subscription_id` on the tenant row.
- Listen for Square **webhooks** (`subscription.updated`, `invoice.payment_made`,
  `invoice.payment_failed`) to flip plan status and drive dunning.
- Plan gating middleware: enforce limits (jobs/month, storage, team seats, custom domain).
- Trials (14-day, no card) + failed-payment recovery via the invoice webhooks.

### Phase E — Operational hardening
- Per-tenant usage metering (jobs, storage GB, emails sent).
- Audit log of approvals (legal value: "client approved at this timestamp from this IP").
- Backups, soft-delete + data export (so churned customers can leave with their data — trust).
- Rate limiting on public intake/upload endpoints (abuse + cost control).

---

## 4. Packaging & pricing

Value metric = **active jobs/month** (tracks the customer's own revenue, scales naturally).

| Plan | Price/mo | For | Limits |
|---|---|---|---|
| **Free / Trial** | $0 (14 days) | Try it | 5 jobs, 1 seat, your branding |
| **Solo** | $19–29 | Freelancer / 1-person shop | 30 jobs, 2 seats, own logo |
| **Studio** | $49–79 | Small shop | Unlimited jobs, 5 seats, custom branding, production sheets |
| **Pro** | $129–199 | Multi-staff / multi-location | Custom domain, invoice integrations, audit export, priority support |

Notes:
- Anchor on the **cost of one reprint or one lost client** — that's $100s, dwarfing the subscription.
- Annual billing at ~2 months free to fund CAC.
- The Command Centre invoice integration becomes a Pro-tier upsell ("connect your invoicing").

---

## 5. Go-to-market

### Channels (ranked for this buyer)
1. **Direct / founder-led** — you already are the customer. Sell to 10 shops you can reach
   (local event-decor groups, print forums, Facebook groups). Hand-onboard them.
2. **Content / SEO** — "client approval form for print shops", "balloon decor proofing template".
   Programmatic comparison pages ("vs Google Forms", "vs email proofs").
3. **Marketplaces / communities** — Reddit (r/smallbusiness, r/printing), Facebook decor groups,
   Etsy-seller communities, trade shows.
4. **Referral loop** — every client who approves a proof sees "Powered by {YourBrand}" (free tier)
   → built-in viral surface. Make removing it a paid feature.

### Launch sequence
1. **Design partners (now → 4 weeks):** convert DDF + 3–5 friendly shops to the multi-tenant
   beta, free, in exchange for feedback and testimonials.
2. **Public beta (weeks 4–10):** open signup, paid plans live, founder onboards each.
3. **Public launch:** Product Hunt + the communities above + a launch-week content push.

### Proof to collect early
- Testimonials with a number ("cut approval time from 3 days to 3 hours").
- A before/after case study from DDF itself.

---

## 6. Differentiation / moat

- **Vertical depth:** production sheets grouped by event date, decor-specific intake fields —
  generic form tools will never build this.
- **Approval as a legal artifact:** timestamped, IP-logged sign-off trail.
- **Whole loop in one place:** intake → proof → approval → production → invoice. Competitors
  cover one slice (Typeform = intake; Approval.studio = proofing; QuickBooks = invoice).
- **Speed to value:** a shop is collecting briefs in 10 minutes, not configuring a CRM.

---

## 7. Risks & how to handle them

| Risk | Mitigation |
|---|---|
| Tenant data leakage | RLS-first, pen-test the isolation, audit log every cross-tenant query path |
| Vercel/Supabase cost on free tier | Usage caps, signed-upload size limits, rate limiting, archive cold files |
| "Why not just Google Forms?" | Lead with the approval trail + production sheet, not the form |
| Churn after one busy season | Annual plans, off-season pause tier, keep their data warm |
| Support load (you're solo) | Self-serve onboarding, in-app help, templates; raise price before adding humans |
| Email deliverability (Brevo) | Per-tenant verified sender domains on paid tiers; monitor bounce/spam |

---

## 8. Roadmap (phased, ~3–4 months to paid GA)

**Month 1 — Foundation**
- Multi-tenancy + RLS (Phase A)
- Tenant settings/branding (Phase B)
- Self-serve signup + invites (Phase C)

**Month 2 — Commercialize**
- Stripe billing + plan gating (Phase D)
- Usage metering + limits
- Marketing site + pricing page + first comparison pages

**Month 3 — Harden & launch beta**
- Audit log, data export, rate limiting (Phase E)
- Custom domain support (Pro)
- Onboard 5–10 design partners, collect testimonials

**Month 4 — Public launch**
- Product Hunt + community launch
- Referral / "powered by" loop
- First case study live

---

## 9. First 5 concrete next steps

1. **Decide the beachhead vertical** and write the one-line positioning (above) on the landing page.
2. **Add `tenant_id` + Supabase RLS** to the data model — the single most important technical step.
3. **Extract DDF-specific branding into a per-tenant settings table** (kills all hardcoded constants).
4. **Stand up Square subscriptions + a 14-day trial** behind a feature-gate middleware.
5. **Recruit 3 design-partner shops** this week and migrate them onto the multi-tenant beta.

---

*Bottom line: you don't need to build a new product — you need to wrap the one you have in
multi-tenancy, billing, and onboarding, then sell the workflow you personally know better than
any competitor. The fastest path to revenue is RLS + Square + 5 design partners.*
