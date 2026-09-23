# Getting the dashboard onto Supabase + a real URL

Two accounts to create yourself (I can't sign up for external services on your behalf). Everything
after that — schema, code, wiring it together — I can do once you hand me the two values called out
below.

## 1. Create the Supabase project

1. Go to https://supabase.com, sign up (or sign in), click **New project**.
2. Pick an organization, name it (e.g. `dst-dashboard`), set a database password — **save that
   password somewhere** (a password manager), you likely won't need it day-to-day but it's the
   master Postgres credential.
3. Pick the region closest to your team, click **Create new project** (takes ~2 minutes to spin up).
4. Once it's ready: **SQL Editor** (left sidebar) -> **New query** -> paste in the contents of
   `supabase/schema.sql` from this project -> **Run**. That creates all the tables and locks them
   down so only logged-in users can read/write.
5. **Authentication** (left sidebar) -> **Providers** -> make sure **Email** is enabled. Under
   **Authentication -> Users**, click **Add user** once for yourself and once per coach you want to
   have access (or turn on self-serve **sign-ups** under **Authentication -> Settings** if you'd
   rather people set their own password via a sign-up screen). Since this is a shared workspace
   (anyone logged in sees everything), there's no per-user setup beyond "does this person have a
   login" — no roles/teams to configure.
6. **Settings -> API**: copy two values and send them to me —
   - **Project URL** (looks like `https://xxxxx.supabase.co`)
   - **anon public** key (long string starting `eyJ...`)

   These two are safe to share and safe to have visible in the app's client-side code — Supabase
   is designed around the anon key being public; the RLS policies in `schema.sql` are what actually
   keep the data locked to logged-in users, not secrecy of this key.

   **Do not** send me the **service_role** key (also under Settings -> API) — that one bypasses
   RLS entirely and should never leave the Supabase dashboard or end up in any file we commit.

## 2. Create the Vercel project (for hosting)

1. Go to https://vercel.com, sign up — easiest is "Continue with GitHub" if you have (or make) a
   GitHub account, since that gives you auto-deploys on every push later.
2. Once this project is pushed to a GitHub repo (I'll help with that step when we get here — this
   folder isn't a git repo yet), **Add New -> Project** in Vercel, pick that repo, leave the build
   settings as "Other / no build step" (this app is plain static HTML/JS, nothing to compile),
   **Deploy**.
3. Vercel gives you a URL like `dst-dashboard.vercel.app` immediately; a custom domain can be added
   later under the project's **Settings -> Domains** if you want one.

## What happens once I have the URL + anon key

- I'll add the Supabase JS client and a small config file with those two values.
- I'll add a simple login screen (email + password) gating the dashboard.
- I'll change `store.js` to load from Supabase on startup and sync writes to it in the background,
  keeping the rest of the app (`index.html`, `periodization.js`, `assessment.js`) untouched — they
  don't talk to storage directly, only through `AthleteStore`.
- I'll test the whole flow live (sign in, add data, confirm it round-trips through Supabase) before
  calling it done.
- Anything currently sitting in your browser's localStorage (existing athletes/assessments) gets a
  one-time export/import into Supabase so you don't lose what's already entered.
