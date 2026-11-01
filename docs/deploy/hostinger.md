# Going live on Hostinger (buzzify-menu.online)

Public menus are served at `https://buzzify-menu.online/<menu-address>` and the Studio at
`https://studio.buzzify-menu.online/studio`. Both are the same Node.js app on the Hostinger website
`buzzify-menu.online`; `studio.buzzify-menu.online` is an alias (parked domain) of it. The database is Neon
(PostgreSQL) and email goes through Resend, because the hosting plan only offers MySQL databases. Pictures, logos and
downloads are kept in Cloudflare R2, and a cron job calls the scheduler that makes scheduled publishes live.

`docs/deploy/production.md` describes the Vercel setup. Its sections on Neon, Resend, the first Super Admin, the
optional demo seed, R2 (step 3b), backups and changing the auth secret apply here too.

## How a deploy works

Hostinger clones `main` from GitHub, runs `npm install`, then `npm run build:host`:

1. `tsx scripts/check-env.ts` stops the deploy and names every missing or wrong setting.
2. `prisma migrate deploy` updates the database (it uses `DIRECT_DATABASE_URL`).
3. `BUILD_TARGET=standalone next build --webpack` builds Next.js's self-contained server, which Hostinger runs on its own
   port. It uses webpack, not Turbopack: Turbopack runs PostCSS in helper Node processes that connect back to it over
   127.0.0.1, and on Hostinger's build machines they exit before connecting (`node process exited before we could
   connect to it`), which failed every build. Local development and `npm run build` still use Turbopack.

Build settings on Hostinger: Node.js 22, framework Next.js, output directory `.next`, build script `build:host`,
package manager npm, source GitHub `rizgarabdulkarim1987-cyber/buzzify-core` (renamed from `buzzify-menu`; the website domain stays `buzzify-menu.online`), branch `main`.

## Settings (Hostinger → Websites → buzzify-menu.online → Node.js → Environment variables)

Already set (not secret):

| Name | Value |
|---|---|
| `PUBLIC_MENU_HOST` | `buzzify-menu.online` |
| `STUDIO_HOST` | `studio.buzzify-menu.online` |
| `PUBLIC_MENU_ORIGIN` | `https://buzzify-menu.online` |
| `PUBLIC_ROOT_REDIRECT` | `https://buzzify.me` (where `buzzify-menu.online/` sends visitors) |
| `BETTER_AUTH_URL` | `https://studio.buzzify-menu.online` |
| `EMAIL_FROM` | `Buzzify Core <studio@buzzify-menu.online>` |

You add these four yourself in hPanel (and the six of "Pictures and scheduled publishing" below) (never paste them into a chat, an email or a file in the repository):

| Name | Where it comes from |
|---|---|
| `DATABASE_URL` | Neon → your project → Connect → **Pooled** connection string (its host contains `-pooler`) |
| `DIRECT_DATABASE_URL` | Neon → the same screen with pooling switched off (the host without `-pooler`) |
| `BETTER_AUTH_SECRET` | Run this on your computer and copy the output: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `RESEND_API_KEY` | Resend → API Keys → Create (sending access) |

Never add `DEV_SEED_PASSWORD` or `ALLOW_REMOTE_DEV_SEED` here. If a Neon address ends with `&channel_binding=require` and
the build cannot connect, remove that part.

## Your steps

1. **Neon:** create a free account and a project in **AWS Europe Central (Frankfurt)**. Keep both connection strings
   for the table above.
2. **Resend:** create a free account, add the domain `buzzify-menu.online`, and share the DNS records Resend shows
   (they are not secret) so they can be added in Hostinger's DNS; then press Verify in Resend. Create an API key.
3. **R2 and the scheduler:** follow "Pictures and scheduled publishing" below.
4. **Hostinger:** add the four variables above and the six from that section.
5. **Deploy:** start the Node.js build from GitHub (`main`, build script `build:host`). Watch the log: it must show the
   settings check passing, `prisma migrate deploy`, and `next build`.
6. **First Super Admin:** on your computer, in the project folder, follow step 7 of `docs/deploy/production.md`
   (`npm run studio:create-admin` with `DATABASE_URL` set to the Neon **direct** address for that one command).
7. **The demo menus (once):** follow step 9 of `docs/deploy/production.md` (`npm run db:seed` with the direct address
   and `DEV_SEED_PASSWORD` not set). It loads ATELIER, Riverlight Coffee and Hot Brick Burgers, each published.
8. **Sign in:** open `https://studio.buzzify-menu.online/studio`, sign in, and set up the authenticator app.
9. **Check:** `https://buzzify-menu.online/atelier`, `/riverlight` and `/hot-brick` show the demo menus; `https://buzzify-menu.online/` goes to
   buzzify.me; `https://buzzify-menu.online/studio` answers 404 (the Studio lives only on the studio address).

## Pictures and scheduled publishing (needed from the menu workspace on)

The menu workspace keeps pictures, logos, QR code downloads and spreadsheets in **Cloudflare R2**, and makes scheduled
publishes live when a scheduler calls the app every minute. From the release that brings the workspace, **a build stops
at the settings check until the six settings below are in hPanel**, so add them before you deploy that release.

### R2: the bucket

Follow step 3b of `docs/deploy/production.md` with these differences:

- **The files' address.** R2 serves a bucket on your own address only for a domain whose DNS Cloudflare holds, and
  `buzzify-menu.online`'s DNS is at Hostinger. Choose one before you start:
  1. move the domain's nameservers to Cloudflare (free plan; check that every record Hostinger had, the site's and
     Resend's included, came across before switching), then connect `media.buzzify-menu.online` to the bucket; or
  2. keep the DNS at Hostinger and serve the files from a domain whose DNS is on Cloudflare (a second domain, or
     `buzzify.me` if it is there), such as `media.buzzify.me`.

  R2's own `r2.dev` address is rate-limited and meant for testing; do not use it for guests. Whatever address you choose
  is `MEDIA_PUBLIC_URL`.
- **CORS:** the allowed origin is the Studio's address here, `https://studio.buzzify-menu.online`.

### The scheduler

Hostinger has no Vercel Cron, so something else calls `https://studio.buzzify-menu.online/api/cron/publish` every minute
with the secret. Either:

- **hPanel → Advanced → Cron Jobs → Custom**, every minute (`* * * * *`), with this command, your secret in place of
  `SECRET` (the command is kept in your hPanel, not in the repository):

  ```bash
  curl -fsS -H "Authorization: Bearer SECRET" https://studio.buzzify-menu.online/api/cron/publish
  ```

- or an external scheduler that can send a header (cron-job.org, for example): a GET of the same address every minute
  with the header `Authorization: Bearer SECRET`.

Each call answers `{"activated":0}` when nothing was due, and `401` when the secret is missing or wrong.

### The six settings

| Name | Value |
|---|---|
| `R2_ACCOUNT_ID` | Cloudflare → R2 overview → Account ID |
| `R2_ACCESS_KEY_ID` | the R2 API token's access key (limited to the bucket) |
| `R2_SECRET_ACCESS_KEY` | that token's secret (shown once) |
| `R2_BUCKET` | `buzzify-media` |
| `MEDIA_PUBLIC_URL` | the files' address chosen above, such as `https://media.buzzify-menu.online` |
| `CRON_SECRET` | run `openssl rand -base64 32` on your computer (a different value from `BETTER_AUTH_SECRET`) |

Then deploy, and run checks 12 and 13 of step 10 in `docs/deploy/production.md` (a 15 MB photo uploaded in Media, and a
publish scheduled two minutes ahead going live), on this site's addresses.

## Billing: the subscription sweep (cron) and payments

Buzzify Core keeps each restaurant's subscriptions (per product) and the payments the owner records by hand. There is **no
payment gateway and no provider key**: a payment is recorded in the Studio (cash by default; the other methods are only
labels).

A second scheduler call moves overdue subscriptions on: a `GET` (only `GET`; a `POST` is answered `405`) of
`https://studio.buzzify-menu.online/api/cron/subscriptions` every 15 minutes, with the same `CRON_SECRET` and the same
`Authorization: Bearer` header as the publish scheduler above (no new setting). It answers `401` when the secret is
missing or wrong.

- **hPanel -> Advanced -> Cron Jobs -> Custom**, every 15 minutes (`*/15 * * * *`), your secret in place of `SECRET` (type
  it in hPanel yourself; never in a chat or the repository):

  ```bash
  curl -fsS -H "Authorization: Bearer SECRET" https://studio.buzzify-menu.online/api/cron/subscriptions
  ```

- or an external scheduler that can send a header: a `GET` of the same address every 15 minutes with
  `Authorization: Bearer SECRET`.

The sweep moves subscriptions past their end to the grace period and then to expired, and records the matching events.
Access is judged when a request arrives, so a missed run only delays the stored status and its events; nothing is lost
and the next run catches up. Add the job after the deploy that brings billing.

## The production migration for billing (once, with the owner's approval)

The release that brings billing includes two migrations (the folders in `prisma/migrations/` ending `_billing`, which
adds the tables, and `_billing_applications`, which adds the Menu and Cashier products; never run the demo seed on
production for them), and the Hostinger build runs `prisma migrate deploy` on production. Rehearse it first; do
not let the first run happen on production.

1. **Snapshot:** in Neon, project `buzzify-menu`, take a snapshot of the `production` branch. This is the way back.
2. **Rehearse on a branch:** create a Neon branch from `production` (or from that snapshot). With `DIRECT_DATABASE_URL`
   set to the **branch's** direct address for that one command, run `npx prisma migrate deploy`, then check that it
   applied cleanly (`npx prisma migrate status`) and that the Studio's restaurants, plans and menus read normally against
   the branch. Delete the branch afterwards.
3. **Only then, with the owner's explicit approval:** merge into `main` and let the Hostinger build run
   `prisma migrate deploy` on production. If the rehearsal failed, do not merge; fix the migration first.
4. **After the deploy:** add the cron job above, then open Restaurants and check a restaurant's subscriptions.

Never run migrations against the production address from a computer by hand for this release.

## Buzzify Retail link (optional, with the owner's approval)

"Linking Buzzify Retail" in `docs/deploy/production.md` explains the link: what each side sends, the secrets and how to
change them. On this site:

**Before the merge.** The release that brings the link adds migrations, and the Hostinger build runs
`prisma migrate deploy` on production. One of them (`ALTER TYPE ... ADD VALUE 'RETAIL'`) cannot be undone. Take a fresh
Neon snapshot of `production`, rehearse on a branch as in "The production migration for billing" above, and merge only in
a window the owner approved.

**The settings** (hPanel, Node.js, Environment variables; type each value yourself, never in a chat or the repository).
Leave `RETAIL_URL` out and the link stays off: the build check ignores the others. With it, the build stops until the three
secrets are right. Each value is the same as its twin in Retails:

| Here | In Retails | Value |
|---|---|---|
| `RETAIL_URL` | `APP_URL` | Retails' address, written identically on both sides: `https://`, lowercase, no path, no trailing slash, no port |
| `RETAIL_SYNC_SECRET` | `CORE_SYNC_SECRET` | `openssl rand -base64 32` |
| `RETAIL_CALLER_SECRET` | `CORE_OUT_SECRET` | `openssl rand -base64 32` |
| `RETAIL_CALLER_SECRET_PREVIOUS` | | empty, except while `RETAIL_CALLER_SECRET` is being changed |
| `RETAIL_HANDOFF_SECRET` | `CORE_HANDOFF_SECRET` | `openssl rand -base64 32` |
| | `CORE_BASE_URL` | `https://studio.buzzify-menu.online`, the Studio address. Not `buzzify-menu.online`: there `/api/retail/...` is a 404, which Retails reads as "no AI key" |

Each secret differs from the others and from `CRON_SECRET` and `BETTER_AUTH_SECRET`. A changed variable needs a new build.

**Two more cron jobs** (hPanel -> Advanced -> Cron Jobs -> Custom), with the same `CRON_SECRET` and header as the jobs
above:

```bash
# every minute (* * * * *), never more often: Retails allows 120 calls a minute from the Studio
curl -fsS -H "Authorization: Bearer SECRET" https://studio.buzzify-menu.online/api/cron/retail-sync
# every hour (0 * * * *)
curl -fsS -H "Authorization: Bearer SECRET" https://studio.buzzify-menu.online/api/cron/retail-reconcile
```

They answer `{"disabled":true}` while `RETAIL_URL` is not set, so they can be added before the link is switched on. Do
not add a second retail-sync job.

**Access logs.** Sign-in tokens pass in the query string of `/api/retail/v1/handoff` here and of
`/api/core/v1/handoff/start` and `/api/core/v1/handoff/callback` on Retails. If Hostinger, Cloudflare or another proxy in
front of either site keeps access logs with query strings, turn that off for those paths (or for the site), and never
share such logs.

**After the deploy.** On the billing screens, make the retail plans and their prices, then turn the `retail` product on (it
starts off). Create a retail business, start its trial, and once its owner has accepted the invitation its Retail tab
shows **synced** within a minute. A shop that shows **failed** (Retails refused it) is not retried automatically: fix the
cause, then press **Resync** on that tab (the next change to the shop also sends it again).

## Neon from the command line

The project is linked to the Neon project `buzzify-menu` (`delicate-pond-39271154`, Frankfurt), branch `production`.
`neon.ts` declares what the branches get (Postgres only, and a 7-day expiry for new development branches); the link
itself is in the git-ignored `.neon` file. After `npm i -g neon` and `neon login`:

- `neon deploy --no-env-pull` applies `neon.ts`. Leave out `--no-env-pull` only if you want your local `.env` to point
  at Neon instead of the embedded development database.
- `neon env pull --file <somewhere outside the repository> -e DATABASE_URL,DATABASE_URL_UNPOOLED` fetches the two
  connection strings: `DATABASE_URL` is the pooled one, `DATABASE_URL_UNPOOLED` the direct one that goes into
  `DIRECT_DATABASE_URL` here.

## Plans (once, after the deploy that brings them)

That deploy's migration puts every restaurant, the demos included, on **Premium**, so guests see no change, and makes
your Super Admin account (the oldest active one) the **platform owner**: the only account that changes plans.

1. **Your WhatsApp number:** open `https://studio.buzzify-menu.online/studio/settings/plans`, type your number with the
   country code under **Your WhatsApp number** (for example `+964 750 123 4567`), and press **Save plans**. Until it is
   set, a locked feature shows which plan has it but no WhatsApp button.
2. **What each plan includes** is on the same page: names in three languages, and a switch per feature and plan.
   "Coming later" lists the features of the next projects, so you can decide now where each will start.
3. **A restaurant's plan:** Restaurants → the restaurant → **Plan** tab → choose the plan → **Save plan**. When it takes
   features away, a window lists what guests stop seeing; confirm it. Guests see the change at once, without a publish,
   and nothing is deleted: moving back brings everything back.
4. **Handing the business over** (or getting it back when the owner's account is lost): on your computer, in the project
   folder, run `npm run studio:set-platform-owner` with `DATABASE_URL` set to the Neon **direct** address for that one
   command, like the first Super Admin. It asks for the new owner's email and changes nothing until you type `yes`.

## Later deploys

Push to `main`, then start a new build in Hostinger (or turn on automatic deployment for the repository). Changing a
variable in hPanel needs a new build, because some values are read while building.
