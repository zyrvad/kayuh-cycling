# Deploying Kayuh

## Status (22 Oct 2026)

- Live at **https://kayuh.zyrvad.workers.dev**, with D1 migrations 0001–0003 applied (routes,
  rides, accounts, crews, group rides).
- Accounts and crews are built and deployed, but nobody can sign in until Cloudflare Access is
  switched on (below). Until then everything else works on per-device ids, and the Crew tab
  explains that sign-in isn't on yet.
- Verified live: the dev-only `X-Dev-Email` header is ignored, and forged Access tokens are
  rejected.

## Switching on sign-in (Cloudflare Access): Jaden's steps

1. Cloudflare dashboard → **Zero Trust**. The first time, pick a team name (e.g. `zyrvad`, which
   gives `zyrvad.cloudflareaccess.com`) and the **Free** plan (up to 50 users; Cloudflare may ask
   for a card even though it's free).
2. **Workers & Pages → kayuh → Settings → Domains & Routes → workers.dev → Enable Cloudflare
   Access**. This creates an Access application for `kayuh.zyrvad.workers.dev`.
3. Zero Trust → **Access → Applications → kayuh → Policies**:
   - Edit the policy: **Allow**, Include → **Emails** → your email and your friends' emails.
   - Session duration: **1 month**, so the home-screen app doesn't keep asking.
   - Login method: **One-time PIN**, which is on by default.
4. From the application's **Overview**, copy the **Application Audience (AUD) tag**. Send it to
   Claude with your team domain. Neither is a secret. Claude puts them in `wrangler.toml` as
   `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` and redeploys. From then on, every request carries a
   verified email.
5. Optional: let shared route links work for people not on the list. Add a second Access
   application for the paths `/r/*` and `/api/share/*` with a **Bypass → Everyone** policy.

## Where to host: Cloudflare, not Vercel

Vercel would work in principle (its free Hobby plan allows personal, non-commercial use), but
Kayuh is already built for Cloudflare, and moving would mean rewriting the backend:

| | Cloudflare (recommended) | Vercel |
|---|---|---|
| Code changes | None: `worker/` is a Cloudflare Worker already | Port the API to Vercel Functions and replace D1 with a hosted database (Neon Postgres or Turso) |
| Database | D1 (SQLite), free 5 GB | Third-party database on its own free tier, another account |
| Static data (graph, 689 tiles, parking) | Workers Static Assets, free | Fine |
| Login for friends | **Cloudflare Access**: built in, free for up to 50 users | Password protection is a paid add-on (Pro plan); otherwise build it ourselves |
| Account | You already have one (Dispatch) | New account |
| Cost | $0 | $0 Hobby, but the login feature costs money |

## Who can get in: Cloudflare Access (email one-time codes)

Cloudflare Access sits in front of the whole site.
- A friend opens the link, types their email, and gets a 6-digit code by email.
- Only emails on your allow-list get a code.
- There are no passwords for anyone to create, leak or forget, and no credentials stored in Kayuh.
- The session lasts up to a month, so the home-screen app doesn't keep asking.

This also gives Kayuh real accounts for free. Behind Access, every request carries the
signed-in email (a signed JWT in `Cf-Access-Jwt-Assertion`). The Worker can verify it and use
the email as the user id instead of today's per-device id. Your routes and rides then follow you
across devices, and crews (Phase 5) have real identities to build on.

## What's secret and where it lives

| Secret | Needed by | Where |
|---|---|---|
| Cloudflare login | Deploying | `npx wrangler login` on your Mac (browser sign-in, by you) |
| LTA DataMall key | The data pipeline only, never the live site | `kayuh/.env` on your Mac, git-ignored |
| OneMap token | Optional; search works without one today | Worker secret, if OneMap starts requiring it |
| Friends' access | Cloudflare Access allow-list | Zero Trust dashboard |

The deployed site holds no keys at all.

## Steps

1. **You:** run `npx wrangler login` in `kayuh/worker` and approve in the browser.
2. **Claude:**
   - Upgrade Wrangler 3 → 4 (v3 is out of date).
   - Create the D1 database and put its id in `wrangler.toml`.
   - Run `npm run deploy`, which applies the migrations and publishes to `https://kayuh.<your-subdomain>.workers.dev`.
3. **Claude:** smoke-test the *deployed* site: map tiles, search, conditions, plan, save, share,
   ride log. (Lesson from Dispatch: local passes are not production passes.)
4. **You:** turn on Access in the Cloudflare dashboard. This is account security, so it stays yours, with Claude walking you through it:
   1. Zero Trust → Access → Applications → add the workers.dev hostname.
   2. Policy: allow these emails.
   3. Login method: one-time PIN.
   4. Session: 1 month.
5. **Claude:** make the Worker trust the Access identity (verify the JWT, map email → user,
   keep device ids working for anything saved before) and redeploy.
6. **Friends:** open the link, sign in with their email code, Share → Add to Home Screen.

## Things to decide

- **Shared route links.** With Access on everything, a friend who isn't on the list can't open
  a link you send. Option: let `/r/*` and `/api/share/*` bypass Access, so links stay public and
  read-only while everything else needs a login.
- **Custom domain.** Optional, about S$15 a year (e.g. kayuh.sg). workers.dev is fine to start.

## Limits to keep an eye on (free tier)

- Workers: 100k requests a day. Today every map tile goes through the Worker
  (`run_worker_first = true`), so one map session costs roughly 50–200 requests. That's plenty
  for a group of friends. With Wrangler 4 it can be narrowed to `/api/*` so tiles are free.
- D1: 5 GB storage, 5 million reads a day. Kayuh uses kilobytes.
- Static assets: 20,000 files and 25 MiB per file. Kayuh has ~700 files, the largest 12.6 MB (graph.bin).
