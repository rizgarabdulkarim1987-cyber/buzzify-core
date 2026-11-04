# Integration report: Studio (`retail-integration`)

Branch `retail-integration` in `C:\Users\pc\Documents\GitHub\buzzify-core-integration`, cut from `origin/main`
b963ce7b (after `git fetch`). Local only: nothing pushed, no PR, nothing merged to main, nothing deployed. Its twin is
Retails' `retail-integration` (`buzzify-retails/.claude/worktrees/integration`), whose report has the same end-to-end
section with screenshots.

## Merges

1. `retail-own-signin` (c2130799, already rebased on b963ce7b): fast, no conflict.
2. `retail-three-products` (871568b2): no textual conflict. Checked by hand where the two meet:
   - `src/server/retail/config.ts` (three-products) and `credentials.ts` / `entry.ts` (own-signin): the credentials
     endpoints only answer Retails' server-to-server calls on `RETAIL_URL`, so the per-product addresses do not touch
     them. `retailStartUrl()` and `retailSignInUrl()` still use `RETAIL_URL` (see problem 2).
   - `handoff.ts` / `handoff-http.ts`: own-signin's shared sign-in rule and three-products' return allow-list and
     per-product bounce are both present; the e2e below exercised them together.
   - `src/server/env.ts`, `rate-limit.ts`, the retail messages: both sets of changes present.

## Fix made in the integration

| Commit | What |
| --- | --- |
| fea69e6c | `tests/studio/rate-limit.test.ts` lists own-signin's new `retail-signin:ip` rule (300 a minute); the test failed on the merge (and on the own-signin branch). |

## Tests (my own embedded Postgres, `BUZZIFY_DB_PORT=54517`, database `buzzify_test`)

- `tsc --noEmit`: only `src/ui/menu/rail/DishIcon.tsx` (pre-existing, not touched).
- `eslint .`: 4 errors, all pre-existing in `src/ui/cart/SendToWaiter.tsx` (1) and `src/ui/cart/table-basket.tsx` (3).
- Vitest `tests/studio tests/retail`, full run: 2066 tests, 2047 passed, 19 failed in 12 files.
  - Pre-existing on `origin/main` (the same list the three-products report found on a clean main): `activity` 2,
    `cross-tenant` 4 (motions), `enforcement` 1, `intro` 1, `invoke` 2, `messages` 1, `overview` 1, `public-action` 1,
    `scene-files` 1.
  - Load timeouts (10 s hooks): `qr.test.ts` 4 and `activity-migration.test.ts` (afterAll). Rerun alone with
    `rate-limit.test.ts` after the fix: 23 of 23 pass.
  - Real: `rate-limit.test.ts` 1, fixed in fea69e6c.
- The words guards and the link tests together (gap 3): `tests/studio/space-words.test.ts`,
  `tests/studio/retail-entry.test.ts`, `tests/retail/credentials-route.test.ts`, `credentials-hosts.test.ts`,
  `handoff-route.test.ts`, `product-config.test.ts`, `snapshot.test.ts`: 7 files, 97 of 97 pass.

## End-to-end with the Retails integration app

Both integration apps ran together for the first time (Studio `next dev` on 3300, Retails `next dev` on 3400, my own
Postgres on 54517, random test secrets). Studio env: `RETAIL_URL=http://localhost:3400`,
`RETAIL_URL_SUPERMARKET=http://supermarket.localhost:3400`, `RETAIL_URL_ELECTRONICS=http://electronics.localhost:3400`,
`RETAIL_SYNC_SECRET`, `RETAIL_CALLER_SECRET`, `RETAIL_HANDOFF_SECRET`, `CRON_SECRET`, `BETTER_AUTH_URL=http://localhost:3300`.

- Seeded Super Admin signed in and set up 2FA; made Retail plan "starter", priced and offered it; created the
  Supermarket shop "Int Market" with an owner email; started its trial.
- The owner accepted the invitation; the shop was provisioned in Retails at once (`activityType` MARKET, from
  `RetailLink.activity` SUPERMARKET).
- Retails' own form on the Supermarket address signed the owner in through `/api/retail/v1/credentials`, also with
  2FA on (wrong code refused, TOTP accepted).
- The handoff from `supermarket.localhost` came back to `supermarket.localhost` (allow-listed return) and into the till;
  a sale was made.
- `/api/retail/v1/handoff` refused returns on `evil.localhost`, with a trailing slash, and on the unconfigured
  `clothing.localhost` (400 each).
- A shop set to MIXED in Retails became MARKET when a newer snapshot was sent by `/api/cron/retail-sync` (run by hand).

## Problems found, not fixed here

1. After accepting a Retail shop's invitation the owner lands on `/studio/restaurants/<id>/menus` ("No menus yet. The
   menus you create for this restaurant are listed here.") instead of Retails: `isRetailOnly` needs no memberships,
   and a Retail owner has an OWNER membership. The invitation mail says "You are invited to Buzzify Core". The Studio
   account page and 2FA setup are reachable for them (that is how 2FA was turned on in the test).
2. `retailSignInUrl()` (the way back after a password reset started in Retails) and `retailStartUrl()` use
   `RETAIL_URL`, not the shop's product address.
3. `next dev` logs server action arguments including the sign-in password. Development only.

## Not verified

- Clothing end to end, "Open Retails" from the shop page, a multi-shop owner across products in the browser.
- Production build, Docker image, the migration on a copy of production data.

## Production deploy order and env

1. **Back up the Studio database first** (Neon snapshot of `production`): the Docker build runs `prisma migrate deploy`,
   which applies the additive `20261104100000_retail_activity` (enum `RetailActivity`, column `RetailLink.activity`
   NOT NULL DEFAULT 'SUPERMARKET'; no UPDATE/DELETE/DROP).
2. **Deploy Studio** with, optionally, `RETAIL_URL_SUPERMARKET=https://supermarket.buzzify.tech`,
   `RETAIL_URL_ELECTRONICS=https://electronics.buzzify.tech`, `RETAIL_URL_CLOTHING=https://clothing.buzzify.tech`
   (origins only, https, lowercase, no default port; they need `RETAIL_URL`, which stays the shared address). No new
   secret. Studio goes first: Retails' own form needs `/api/retail/v1/credentials`.
3. **Caddy**: one site block for the three product hosts to the Retails upstream, no Host rewrite.
4. **Deploy Retails** with `PACK_HOSTS=supermarket.buzzify.tech=SUPERMARKET,electronics.buzzify.tech=ELECTRONICS,clothing.buzzify.tech=CLOTHING`
   and `TRUSTED_PROXY_HOPS=1` (2 only with a CDN in front of Caddy).
5. Run `/api/cron/retail-reconcile` once (the snapshot's hash changed with `activityType`, so every shop is resent and
   existing MIXED shops such as "Rizgar" become MARKET), then sign in once on the form and once through the Studio.
