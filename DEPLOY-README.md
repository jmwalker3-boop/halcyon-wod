# Deploying this to Vercel (no terminal needed)

**This section is out of date** — it describes the original Vercel Drop setup, which can't update an existing project (every drop creates a brand-new one). Once real env vars and a real Supabase project existed, the actual working pipeline became: push this folder's contents to the `bam-app` GitHub repo via GitHub's own web "Upload files" page, which auto-redeploys the existing `halcyon-wod` Vercel project. Keeping the original steps below only for the env-var reference table, which is still accurate.

## Current deploy process (as of 2026-09-04)

1. Unzip this folder on your computer.
2. Go to `github.com/jmwalker3-boop/bam-app` and click into the repo.
3. Click **Add file → Upload files**, then drag in **everything from inside the unzipped folder** (so you're dragging the *contents* — `app`, `lib`, `vendor`, `package.json`, etc. — not the folder itself as one item).
4. As of this update, the whole folder is **68 files** — under GitHub's ~100-file-per-upload limit for the web uploader, so it should go in as one batch. If a future update grows past that again, upload by clean top-level groups instead of an arbitrary split (e.g. all of `vendor/` in one go, then everything else in a second) — a straddled, arbitrary chunk is what silently dropped `app/settings/page.tsx` and the updated `app/dashboard/page.tsx` last time.
5. Scroll down and click **Commit changes**.
6. Vercel picks up the push automatically and redeploys — no action needed there, just wait a minute or two, then refresh the site.

**How to check the upload actually took**, since GitHub's uploader doesn't clearly warn about a partial upload: browse to `github.com/jmwalker3-boop/bam-app/tree/main/app` in the browser afterward and confirm you see a `settings` folder there alongside `dashboard`, `login`, etc. If `settings` isn't listed, that upload didn't fully go through — re-drag just the `app` folder's contents and re-commit.

## One-time setup (already done — for reference only)

Once it's up, open the new project in your Vercel dashboard → **Settings → Environment Variables**, and add these three:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `DATABASE_URL`

After adding the variables, use the **Redeploy** button on the latest deployment so the app picks them up. This step is already done for the live project — only relevant again if a brand-new Vercel project ever gets created.

## Where to get each value, in Supabase's current dashboard UI

Supabase changed their settings UI recently, so if you've been here before it'll look different.

- **`NEXT_PUBLIC_SUPABASE_URL`** and **`NEXT_PUBLIC_SUPABASE_ANON_KEY`**: in your Supabase project, go to **Settings → API Keys**. That page now defaults to a "Publishable and secret API keys" tab. Use the **Publishable key** (starts with `sb_publishable_...`) for `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase built it as a direct replacement for the old "anon" key (same low-privilege access, same RLS behavior), and there's no need to dig into the "Legacy anon, service_role API keys" tab. The Project URL is on that same settings page, usually near the top — it looks like `https://xxxxxxxx.supabase.co`.
- **`DATABASE_URL`**: click the **Connect** button at the top of your Supabase project's dashboard (not under Settings — it's its own button on the main project page). That opens a panel with connection strings. Use the **URI** under the direct connection (not the pooled/transaction one), and it'll have `[YOUR-PASSWORD]` as a placeholder in it — you'll need to swap in your actual database password there before pasting it into Vercel.

Without step 4 done correctly, every page on the site — including the homepage — will show "Internal Server Error." That's not a bug in the app; the app checks the login session on every page load, and it can't do that without these three values. Once they're set and you redeploy, that error should clear.

The 20 migration files that build the actual database (movements, workouts, rules, RLS policies, etc.) are already confirmed live on your Supabase project — that part's done, nothing further needed there.
