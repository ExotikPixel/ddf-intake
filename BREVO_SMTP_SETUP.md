# Brevo SMTP → Supabase Auth setup

Goal: stop the portal "email rate limit exceeded" error by sending sign-in
(magic-link) emails through Brevo instead of Supabase's throttled built-in SMTP.

> Note: production `SENDER_EMAIL` is currently **blank**, so Brevo isn't wired
> for the app's transactional emails yet either. Doing this also lets you fix
> that (Step 4) so confirmation / notification emails work too.

---

## Step 1 — Verify a sender in Brevo
1. Log in to **Brevo** (app.brevo.com).
2. Go to **Settings → Senders, Domains & Dedicated IPs → Senders**.
3. Add and verify the address you want emails to come **from**, e.g.
   `hello@ddfevents.ca` or `noreply@ddfpixel.com`.
   - Best: verify the whole **domain** (adds SPF/DKIM DNS records) so deliverability is good and you can send from any address on it.
   - Minimum: verify the single sender address (Brevo emails a confirmation link).
4. Note the exact verified address — call it **SENDER**.

## Step 2 — Get Brevo SMTP credentials
1. In Brevo go to **SMTP & API → SMTP** tab.
2. Note the **SMTP server**: `smtp-relay.brevo.com`, **Port**: `587`.
3. **Login**: shown on that page (usually your Brevo account email / a long login id).
4. Click **Generate a new SMTP key** → copy it. This is the **password**.
   - ⚠️ This SMTP key is NOT the same as the REST `BREVO_API_KEY`. You need the SMTP key.

## Step 3 — Configure Supabase custom SMTP
1. Supabase Dashboard → your project → **Authentication → Emails → SMTP Settings**.
2. Toggle **Enable Custom SMTP** on.
3. Fill in:

   | Field | Value |
   |-------|-------|
   | Sender email | **SENDER** (from Step 1) |
   | Sender name | `DDF x Pixel` |
   | Host | `smtp-relay.brevo.com` |
   | Port | `587` |
   | Username | Brevo SMTP **Login** (Step 2.3) |
   | Password | Brevo **SMTP key** (Step 2.4) |
   | Minimum interval between emails | leave default (e.g. 60s) |

4. **Save**.
5. Still in Supabase: **Authentication → Rate Limits** → raise **"Emails per hour"**
   to ~30–50 (the built-in cap is what was throttling sign-ins; this only takes
   real effect once custom SMTP is on).

## Step 4 — (Recommended) wire the same sender into the app
So the app's own Brevo transactional emails (intake confirmation, change-request
alerts, add-to-job alerts) also work. In **Vercel → ddf-intake → Settings →
Environment Variables (Production)** set:

- `SENDER_EMAIL` = **SENDER** (same verified address)
- `SENDER_NAME` = `DDF x Pixel`
- `NOTIFICATION_EMAIL` = the inbox that should receive job alerts (e.g. `jobs@ddfevents.ca`)
- `BREVO_API_KEY` = a Brevo **API v3 key** (SMTP & API → **API Keys** tab) — only if not already set

Then redeploy (any push to `main`, or Vercel → Deployments → Redeploy).

## Step 5 — Test
1. Go to **jobs.ddfpixel.com/login**, enter a client email, **Send Sign-in Link**.
2. The email should arrive from **SENDER** within a few seconds.
3. Send several in a row — you should no longer hit "email rate limit exceeded".

---

### Troubleshooting
- **Still rate limited:** custom SMTP didn't save, or you only raised the limit
  without enabling custom SMTP. Re-check Step 3 toggle is ON.
- **Email not arriving:** sender not verified in Brevo (Step 1), or wrong SMTP
  key. Check Brevo → **Transactional → Logs / Statistics** for the attempt.
- **"Sender not allowed":** the Supabase "Sender email" isn't a verified Brevo sender.
