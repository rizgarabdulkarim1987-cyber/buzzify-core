# Retail as three products: Supermarket, Electronics, Clothing

Branch `retail-three-products` (worktree `buzzify-core-three-products`, from `origin/main`). Local commits only: nothing
pushed, merged or deployed.

## What changed

The single Retail tile on the Super Admin hub is now three products, each a closed space of its own with its own icon,
name (ar, ckb, en), list, overview, billing, people, announcements, activity and settings, and no link to the others:

| Product | Hub icon | Space | Stored as `RetailLink.activity` | Sent to Retails as `activityType` |
|---|---|---|---|---|
| Supermarket | cart | `/studio/supermarket` | `SUPERMARKET` (the default) | `MARKET` |
| Electronics | smartphone | `/studio/electronics` | `ELECTRONICS` | `ELECTRONICS` |
| Clothing | shirt | `/studio/clothing` | `CLOTHING` | `CLOTHING` |

- **Hub.** Five large tiles (Menu and Cashier, Pharmacy, Supermarket, Electronics, Clothing) plus the small Platform
  entry. Two tiles to a row on a phone (an odd last one centred), five in one row on a desktop, project tokens only,
  touch-sized targets, press feedback that honours `prefers-reduced-motion`, RTL by logical properties.
- **Spaces.** All three are served by one dynamic route, `src/app/studio/(studio)/(app)/[product]/`. Any other slug gets the
  Studio's not-found page, and every page is for Super Admins only. A product's list shows only its own shops
  (`sectorWhere`: RETAIL plus `RetailLink.activity`; a RETAIL business with no link counts as a Supermarket). Writes
  through the wrong product's space are refused as not found (`assertSameSector`).
- **Creation.** "New supermarket", "New electronics shop" and "New clothing shop" each create a shop of that product. The
  product is written to the audit row (`changes.activity`). The UI offers no way to change it. The product is shown in
  the shop's header (product icon and name) and in lists through `SectorBadge`.
- **Words.** Each product speaks its own words: `<space>.as.<key>` for the texts in `PRODUCT_WORDS`, on top of the
  shared Retail twins. The word guard (`tests/studio/space-words.test.ts`) checks, for each product and in every language,
  that no other product's name appears, nor "retail shop", nor any restaurant, menu, till or pharmacy word. A screen
  inside a product that only knows the sector keeps the product's words (`spaceT` does not re-wrap a product translator).
- **Old addresses.** `/studio/retail` and `/studio/retail/<anything>` redirect to the same page under
  `/studio/supermarket`, keeping the query. A shop opened under the wrong product moves to the same page of its own
  product. `/studio/retail/open/[id]`, `/studio/retail/continue` and `/studio/retail/choose` behave as before.
  `/studio/billing/plans?app=retail` now goes to `/studio/supermarket/settings`. Announcements stored with the old space
  value `retail` show in the Supermarket.
- **Billing (out of scope, unchanged).** The three products share the one `retail` billing product and its plans. Each
  product's settings page shows them, and plan audit rows show in all three spaces. Per-product plans would need: one
  `Application` row per product (an INSERT, which the additive guard allows), `APPLICATIONS_OF` and `applicationsOfSector`
  per product, the snapshot's plan lookup by the shop's product, `bumpRetailForPlan` per application, and the settings
  page split per product.

## The migration (runs on production through the Docker build)

`prisma/migrations/20261104100000_retail_activity/migration.sql`:

```sql
CREATE TYPE "RetailActivity" AS ENUM ('SUPERMARKET', 'ELECTRONICS', 'CLOTHING');
ALTER TABLE "RetailLink" ADD COLUMN "activity" "RetailActivity" NOT NULL DEFAULT 'SUPERMARKET';
```

The migration is additive. It creates one type and adds one column with a default. It has no UPDATE, DELETE, DROP or
RENAME, and the `BusinessSector` enum is untouched. Every existing retail shop, including the test shop "Rizgar", reads as
`SUPERMARKET` through the default. `tests/retail/activity-migration.test.ts` builds a scratch database with every earlier
migration, inserts retail rows the way production has them, applies this migration, and checks that every row is kept
and is now `SUPERMARKET`. `tests/pharmacy/migration-additive.test.ts` passes on it. **Take a Neon snapshot of
`production` before the merge.**

## Environment variables

| Variable | Required | Value |
|---|---|---|
| `RETAIL_URL_SUPERMARKET` | no (needs `RETAIL_URL`) | The Supermarket's Retails address, planned `https://supermarket.buzzify.tech` |
| `RETAIL_URL_ELECTRONICS` | no (needs `RETAIL_URL`) | planned `https://electronics.buzzify.tech` |
| `RETAIL_URL_CLOTHING` | no (needs `RETAIL_URL`) | planned `https://clothing.buzzify.tech` |

- Same rules as `RETAIL_URL`: an origin only, lowercase, no default port, and https in production.
- Unset, a product uses `RETAIL_URL` (the legacy host `retail.buzzify-menu.online` stays as `RETAIL_URL`).
- There is still one set of secrets, and every server-to-server call still goes to `RETAIL_URL`.
- A product address without `RETAIL_URL`, or one written badly, fails the deploy check (`checkProductionEnv`) and answers
  503 at run time.
- Documented in `docs/deploy/hostinger.md`, `docs/deploy/production.md` and `.env.example`.

## What the Retails side must expect

- **`activityType` values:** `MARKET`, `ELECTRONICS`, `CLOTHING`, and nothing else. They come in two places:
  - The provision body, as before: `{ coreBusinessId, name, activityType, capabilities, branches, currencies, state }`.
  - The state, a new key: `{ coreBusinessId, version, status, plan, subscription, aiIntake, activityType, owner }`.
- **Existing shops:** they were provisioned with `MIXED`. A repeat provision does not change `activityType` in Retails, so
  Retails must read it from the state to update them. Adding the key changes each shop's state hash, so the reconcile's
  drift check resends every provisioned shop on its next pass, with no SQL bump.
- **Handoff allow-list:** the `return` is accepted only when it equals, exactly, `<address>/api/core/v1/handoff/callback`
  for `RETAIL_URL` or a configured product address. Anything else is a 400 with no redirect: another host, a lookalike
  suffix, http, a different case or port, a trailing slash, a query, or another path.
- **Per-product redirect:**
  - "Open Retails" (`/studio/retail/open/[id]`) sends the owner to `<product address>/api/core/v1/handoff/start` for the
    shop's product.
  - A handoff for an owner's shop that arrived with another configured return is sent once to that product's
    `/api/core/v1/handoff/start`, with the shop picked (`studio_retail_pick`) and a one-bounce guard
    (`studio_retail_hop`), so Retails can start the handoff on the product's own host.
  - If Retails then comes back with the same "other" return again, the token goes to that return, so there is no loop.
  - A parked handoff (no session yet) resumes to the return it came with.
- **Hosts:** Studio reads no Host or X-Forwarded-Host header for this. The addresses come only from the environment.

## Files

- Data: `prisma/schema.prisma`, `prisma/migrations/20261104100000_retail_activity/`, `src/server/domain/retail/activity.ts`.
- Server: `src/server/studio/services/space-scope.ts`, the queries `billing`, `announcements`, `people`, `restaurants`
  and `retail`, `src/server/studio/actions/restaurants.ts`, `src/server/retail/{snapshot,provision,config,handoff,handoff-http}.ts`,
  `src/server/env.ts`.
- Studio: `src/studio/{spaces,space-words,space-icons,nav,pickers}.ts`, `src/studio/shell/{ProjectHub,Sidebar,JumpTo}.tsx`,
  `src/studio/messages/retail/products/{en,ar,ckb}.ts`, the routes `src/app/studio/(studio)/(app)/[product]/**` (moved
  from `retail/(space)`), `(app)/retail/{page.tsx,[...legacy]/page.tsx,legacy.ts}`, and the shared screens that take a
  space.
- Tests: `tests/studio/{spaces,nav,hub,retail-space,space-words,space-scope,team-space,billing,cross-tenant}.test.ts`,
  `tests/retail/{activity-migration,product-config,handoff-route,snapshot,acceptance,screens,create,plans}.test.ts`,
  `tests/server/production-env.test.ts`.

## Verified, and what is not

- `tsc` is clean except `src/ui/menu/rail/DishIcon.tsx`, an error that is already on `origin/main` and in a file this
  branch does not touch. ESLint shows no errors in the changed files.
- Vitest for `tests/studio`, `tests/retail`, the env test and the additive guard: every failure that remains also fails on
  a clean checkout of `origin/main`. Those failures are in activity labels, cross-tenant motions and content, enforcement,
  intro, invoke, messages, overview, public-action and scene-files, and none is in code this branch touches. The test
  database ran on `BUZZIFY_DB_PORT=54439`, because 54339 was taken by another worktree's database.
- Browser, with a local test Super Admin on the dev database:
  - The hub at phone width (375) and desktop width (1366), in English and Arabic (RTL).
  - The Electronics list in Arabic on a phone: only its own shop is listed.
  - The New clothing shop page in English on a desktop.
  - A Supermarket address of an Electronics shop moves to `/studio/electronics/...`.
  - `/studio/retail/new?x=1` lands on `/studio/supermarket/new?x=1`.
- **Not verified:**
  - Kurdish (ckb) in the browser.
  - Creating a shop through the browser form end to end (covered by `tests/retail/create.test.ts`).
  - The handoff against the real Retails and the real product hosts (covered against the contract oracle).
  - The production Docker build.
  - The migration on a copy of production data (only on a scratch database with representative rows).
