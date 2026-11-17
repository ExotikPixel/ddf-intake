# Bringing the old jobs back (Phase 2)

The new system at jobs.ddfpixel.com started empty on Nov 16, 2026. Every job,
file and design from before then is still safe in the old Supabase project
(`pbgyekhyoihietqjrfpb`). Supabase has locked it because it's over the free
storage limit. This guide copies everything across. Jobs keep their old
numbers, so review links already emailed to clients start working again.

**Time:** about 10 minutes of your attention. The file copy itself can run for
an hour or more and needs no watching.

---

## 1. Get read access to the old project (you)

Nothing is lost while you wait. Supabase keeps locked projects.

**Route A (free): ask Supabase support.** Go to supabase.com/dashboard/support,
choose project `pbgyekhyoihietqjrfpb`, and send:

> This project is restricted for exceed_storage_size_quota. We're migrating off
> Supabase and need either a temporary lift (24–48 h) to export our database and
> the job-files bucket, or an export of both. We won't add new data.

**Route B (free): wait for the monthly reset, around Dec 1, 2026.** Check the
exact date under Organization → Billing → "Upcoming invoice". When the project
page shows healthy again, do steps 2 and 3 **the same day**. It will go over the
limit again quickly.

Whichever comes first wins. When the project opens up, carry on below.

## 2. Put three values in a private file on the shop PC (you)

In Ubuntu on the shop PC:

```bash
mkdir -p ~/DDF-Data/legacy-supabase && nano ~/DDF-Data/legacy-supabase/export.env
```

Paste these three lines and fill in the blanks. Then press Ctrl+O, Enter,
Ctrl+X to save.

```
SUPABASE_URL=https://pbgyekhyoihietqjrfpb.supabase.co
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_DB_URL=
```

- **SUPABASE_SERVICE_ROLE_KEY**: on the MacBook, open
  `~/DDF-Data/legacy-supabase/env.local.supabase-backup` and copy the value after
  `SUPABASE_SERVICE_ROLE_KEY=`.
- **SUPABASE_DB_URL**: Supabase dashboard → the project → **Connect** →
  "Session pooler" → copy the URI and put the database password where it says
  `[YOUR-PASSWORD]`. Forgot the password? Project Settings → Database →
  **Reset database password**. That's safe: nothing uses it any more.

## 3. Export (copies the old data onto the PC)

```bash
cd ~/ddf-intake && git pull && ./scripts/export-supabase.sh
```

You should see the database saved, then `N files in Supabase`, and finally
`✅ Export done`. If it says some files failed, run the same command again. It
carries on from where it stopped. **After this, your data is safe on the PC,
even if Supabase locks the project again.**

## 4. Practice run (changes nothing)

```bash
cd ~/ddf-intake && ./scripts/import-legacy.sh --dry-run
```

It reports how many jobs, designs and files it *would* copy. If it stops with
"old columns that don't fit the new schema", send the output to Claude. That
needs a small fix first.

## 5. The real import (only when the ONYX print RIP is idle)

```bash
cd ~/ddf-intake && ./scripts/import-legacy.sh
```

It backs up the live database first (`~/DDF-Data/backups/db-before-legacy-import-…`).
Then it copies the jobs and files and checks the result. Never-overwrite rules
protect everything added since Nov 16. The last line should read
`✅ Import verified`. If it shows ⚠️ lines instead, send the whole output to Claude.

Then check by eye: open three old jobs in the admin (pictures show), look one up
in the client portal, and open an old review link from a real client email.

## 6. Finish up

Hide the "older jobs are being restored" message clients currently see:

```bash
cd ~/ddf-intake && sed -i 's/^LEGACY_RESTORE_NOTICE=.*/LEGACY_RESTORE_NOTICE=0/' .env && docker compose up -d --force-recreate app
```

Start a fresh off-site backup of the newly added files:

```bash
rm -f ~/DDF-Data/ops-state/offsite ~/DDF-Data/ops-state/digest && docker compose restart ops
```

**A few days later**, once you're happy the old jobs look right:

```bash
cd ~/ddf-intake && docker compose exec -T db psql -U ddf -d postgres -c "drop database legacy"
```

Keep the `~/DDF-Data/legacy-supabase/` folder as the permanent archive. Then,
and only then:

- Supabase → project `pbgyekhyoihietqjrfpb` → Settings → General → **Delete
  project**. This can't be undone. Leave Command Centre's Supabase project
  alone.
- Delete `~/DDF-Data/legacy-supabase/export.env` on the PC and
  `env.local.supabase-backup` on the MacBook. They hold a master key.

---

**What the scripts do, for the curious:** `export-supabase.sh` runs `pg_dump`
and downloads the `job-files` bucket. `restore-legacy.sh` loads the dump into a
scratch database `legacy`, next to the live one. `db/import-legacy.sql` copies
rows across in one all-or-nothing transaction, keeping ids. It stops before
changing anything if the old schema has a column the new one lacks. Files are
copied with `rsync --ignore-existing`. `verify-legacy-import.ts` checks row
counts, files on disk and live review links.
