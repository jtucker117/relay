# Relay — SiteStac agency CRM

Production rebuild of the Relay CRM prototype (the `.dc.html` design files live in
`../SiteStac/RELAY/`). Free AI website preview before the client pays; pipeline → preview →
client review → build queue → branded invoice → launch.

**Stack:** React + Vite + TypeScript + Tailwind v4 · Supabase (Postgres/Auth/RLS/Storage/Edge
Functions) · Resend (email) · Stripe (later) · Cloudflare Workers static hosting at
**relay.sitestac.com**.

## Launch build order — the 4 criticals
1. **Auth + shared DB (Supabase).** ✅ scaffolded — schema, RLS, auth, org bootstrap, Pipeline reads real deals.
2. **Server-side preview hosting + real email lock** — Edge Function at `preview.sitestac.com/<slug>`, signed cookie, 403 on email mismatch, honor active/expiry.
3. **Transactional email (Resend)** — every "Emailed" tag = one real send.
4. **Payments (Stripe)** — after 1–3; keep manual "Mark as paid" until connected.

## Local setup
> Requires Node 20+. (This machine has no local Node — build/verify via CI or a machine with Node.)

```bash
npm install
cp .env.example .env.local   # then fill in the two VITE_ vars
npm run dev
```

### 1. Supabase
- Project: `hifuypelxeryqqrfhapx` (`https://hifuypelxeryqqrfhapx.supabase.co`).
- Apply the schema: open **SQL Editor** → paste `supabase/schema.sql` → run.
- Auth: enable Email provider (and Email OTP / magic links) in **Authentication → Providers**.
- Storage: create a `previews` bucket (private) for generated preview HTML (Critical 2).
- Copy the **anon public key** (Settings → API) into `.env.local` as `VITE_SUPABASE_ANON_KEY`.

### 2. First run
- `npm run dev`, sign up, then create your workspace on the onboarding screen (calls the
  `bootstrap_org` RPC → you become Owner). Add a few `deals` rows in Supabase to see the Pipeline populate.

## Deploy (Cloudflare Workers)
Pushing to `main` runs `.github/workflows/deploy.yml`. Set these **repo secrets**
(Settings → Secrets and variables → Actions):

| Secret | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://hifuypelxeryqqrfhapx.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon public key |
| `CLOUDFLARE_API_TOKEN` | same token used by the sitestac marketing site |
| `CLOUDFLARE_ACCOUNT_ID` | same account id |

Then in the Cloudflare dashboard, add **relay.sitestac.com** as a custom domain on the `relay`
Worker (DNS is already on Cloudflare for sitestac.com).

## Layout
```
supabase/schema.sql      Postgres schema + RLS + org bootstrap
src/lib/                 supabase client, types, catalog (packages/addons/stages), money math
src/auth/                AuthProvider (session + profile)
src/pages/               Login, Onboarding, Pipeline (wired), Dashboard/Activities/BuildQueue/Settings (stubs)
src/components/          AppShell (sidebar), Screen (header frame)
```

Money math (`src/lib/money.ts`) is ported verbatim from the prototype: `acv = setup + monthly*12`,
weighted pipeline excludes won, tax applies to setup only.
