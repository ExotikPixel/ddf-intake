# Step 3 — Closing the gaps to "sellable"

Turning the multi-tenant foundation into a product a second shop can sign up for,
brand as their own, and (later) pay for. Ordered into shippable chunks; each is
deployed and verified before the next.

Product brand: **ProofDeck** (white-label). DDF = customer #1.
URL scheme: **path-based** (`/s/{slug}`) to start — works with no new domain/DNS.
Upgrade to subdomains (`{slug}.useproofdeck.com`) at launch once the domain is live.

---

## Chunk 1 — Per-shop intake URL + white-label intake page
- Extract the intake form (`src/app/page.tsx`) into a reusable component that takes
  `branding` (name, logo, colour, contact) + a tenant `slug`.
- Root `/` keeps rendering DDF (default tenant) — unchanged for existing clients.
- New route `/s/[slug]` renders the same form themed for that shop, resolved from
  `tenants` + `tenant_settings` server-side.
- `/api/submit` accepts the tenant slug and assigns that tenant_id (falls back to DDF).
- 404 a slug that doesn't exist.

## Chunk 2 — White-label the proof + portal pages
- `/review/[token]` (the page clients use to approve) themes from the job's tenant.
- `/portal` themes from the signed-in client's job tenant.
- `/login` shows neutral/ProofDeck branding (it's the admin shell).
- Add a small "Powered by ProofDeck" line on client pages (the free-tier growth loop;
  removable on paid tiers later).

## Chunk 3 — Self-serve signup
- `/signup` page: business name → creates `tenants` + `tenant_settings` (trial) +
  `tenant_members` (owner) + the Supabase Auth user, then drops them into `/admin`.
- Slug generated from the business name (unique, URL-safe).
- A simple "workspace settings" screen so an owner can set their logo/colour/contact.

## Chunk 4 — Verify isolation (SAFETY GATE) ⚠️
- With a real second tenant from signup, confirm end-to-end there is zero data bleed:
  admin list, job-by-id, files/proofs signing, portal, review links, emails.
- Do this BEFORE any outside shop touches real client data.

## Chunk 5 — Table stakes for going live
- Staff invites (more than the owner per workspace).
- Basic plan limits + rate limiting on signup/upload (abuse + cost control).
- Terms of Service + Privacy Policy pages.
- Data export for a workspace (trust / leaving).

## Chunk 6 — Billing (Square) — Step 4
- Reuse Command Centre's raw-fetch Square pattern. Catalog subscription Plans +
  Subscriptions API; webhook flips plan status; gate features by plan.
- Defer until 1–2 design-partner shops have validated the product for free.

---

## Recommended milestone order
1. Chunks 1–3 → a second shop can sign up, brand it, and collect/approve jobs.
2. Chunk 4 → prove isolation with that real second tenant.
3. Onboard 1–2 **free design-partner shops**; collect feedback + a testimonial.
4. Chunk 5 → table stakes.
5. Chunk 6 → turn on Square billing once validated.

Billing comes last on purpose: get real shops using it free first, then charge.
