# Buzzify Pharmacy: phases 0 and 1

The pharmacy module runs a pharmacy business (sector `PHARMACY`) inside this repository, next to the menu and the
cashier, which stay as they were. Design: `docs/superpowers/specs/2026-10-27-pharmacy-design.md` (Arabic). Plan:
`docs/superpowers/plans/2026-10-27-pharmacy-phase-0-1.md`. This file covers what phases 0 and 1 built, what they did
not build, and the policies in force.

Nothing here is deployed. No migration has been run on production.

## What exists

**Phase 0: the safe base**

- `Restaurant.sector` (`FOOD` or `PHARMACY`) and the `pharmacy` application. FOOD behaviour is pinned by golden tests
  (`tests/pharmacy/golden-food.test.ts`): permissions, Studio navigation, and a public menu loader that runs no query
  on any `Ph*` table.
- A Super Admin creates a pharmacy in Studio with its branches (at least 1, at most 20), its currencies (IQD, USD) and
  an owner email. Business, branches, `PhSettings` and the invitation are written in one transaction
  (`src/server/pharmacy/provision.ts`). The invited owner becomes the business's Studio `OWNER` member, which makes
  them pharmacy `OWNER` of every branch. The pharmacy subscription is started from the billing screens.
- `AppPlan` with branch and user limits, edited on the Studio billing plans page. Billing checks the sector: a FOOD
  business cannot start or change a pharmacy plan, and a pharmacy cannot start or change a menu or cashier plan.
- The cashier is unchanged for FOOD. A till resolves its actor and gate in the same number of queries as before this
  plan (golden test), and a pharmacy business never gets a till.
- Branch isolation in the tenant client (`src/server/data/tenant-db.ts`, `PHARMACY_BRANCH_SCOPED_MODELS`). Pharmacy
  actions and queries get `ctx.scoped`, a client confined to the business and to the actor's branches. Enforcement
  tests refuse direct `db.ph*` access in pharmacy folders.
- Pharmacy roles and permissions, separate from Studio and cashier roles: `OWNER`, `BRANCH_MANAGER`,
  `PHARMACIST_IN_CHARGE`, `PHARMACIST`, `CASHIER`, `STOCK`, `ACCOUNTANT` (`src/server/domain/pharmacy/permissions.ts`).
- Support access through `SupportAccessGrant` (see the policy below), with a permanent support banner in the UI.
  Granting, revoking, recording consent and listing grants are **server only: no Server Action and no screen yet**
  (actions and tests only). Today a grant can be made only from code or tests.
- The audit allow-list: audit `changes` that carry a patient or prescription field fail the action.
- The `/pharmacy` route group: sign-in, choosing a pharmacy and branch (`/pharmacy/select`), and the shell (`/pharmacy/home`).

**Phase 1: catalog and units**

- Products (`PhProduct`) with an identity key built from trade name, strength, form, manufacturer and pack. A second
  product with the same identity is refused (`DUPLICATE_PRODUCT`, naming the existing product). A different strength,
  form or pack is a different product. Case, Arabic-Indic digits, spacing and unit spelling are ignored.
- Pack ladders (`PhProductUnit`): whole base quantities, each level a whole multiple of the one below.
- Barcodes (`PhBarcode`) stored as text: leading zeros are kept end to end (form, import, scan, export), and Arabic
  digits are read as Latin. A code belongs to one product unless it is marked shared, in which case a scan offers a choice.
- Dated prices (`PhPrice`), held per unit level and currency, business-wide or per branch. History is kept and never
  edited in place. A start may be up to 90 days ahead. Bulk price changes (`ph.prices.previewBulk` / `applyBulk`,
  previewed first) are **server only: no Server Action and no screen yet**.
- Search (`src/server/pharmacy/search.ts`) by barcode, name, Arabic name, ingredient or several words. On 50,000
  products the load test (`npm run test:load`) measures a p95 of about 20 ms. That figure is for **the service alone
  on localhost** (`searchProducts` called directly), not for a request end to end. One keystroke in the app also
  pays for access checks before the search runs:
  - `getPhAccess`: about 6 to 7 sequential reads;
  - the framework's `admit`, which resolves the actor and the gate again: 4 to 5 more;
  - then the search itself: one wave of 5 parallel queries, then `pricesAt`.

  That is roughly **12 to 14 sequential round trips per search** (estimated from the code by the final review, not measured). The parallel wave holds 5 of the default 10 pool
  connections at once, so two concurrent tills fill one process's pool. End-to-end timing on Neon is **not
  measured** and must be done before phase 3 (sales). Reusing the resolved actor and gate within a request
  (`cache()` or passing them from `invokePh*`) is a recorded follow-up.
- Excel/CSV import with a preview (`/pharmacy/catalog/import`). Every row is checked and stored with its issues, and
  nothing changes until apply. Apply is one transaction (60 s timeout). Limits: 10,000 rows and 5 MB per file. A
  committed file uploaded again is flagged `DUPLICATE_IMPORT`. Export writes CSV (UTF-8 BOM) or XLSX, and cells
  starting with `= + - @` are escaped. Cost columns are shown only to holders of `cost.view`. An export re-imports as
  is **only for two-level ladders**:
  - it writes the top pack alone (`packLabel`, with `unitsPerPack` as the top level's base quantity), so a
    box/strip/tablet ladder comes back as two levels;
  - with more than one branch in view it writes one `minQty <branch name>` column per branch, and those columns do
    not map back on import.
- Catalog screens: list and search, product editor (ladder, barcodes, price history), new product, and the import
  wizard. Unsaved drafts are kept on the device and leaving the page asks first.

## What is NOT built

- **Row-level security.** The RLS spike decided DEFER: the safety properties held, but product search lost +137% p95
  from the policy alone (`docs/superpowers/specs/2026-10-27-pharmacy-rls-spike.md`). Isolation is application-level
  only (`ctx.scoped` plus enforcement tests). The spike script was deleted. It can be recovered from git at
  `7d25a6d` and should be re-run on a Neon branch before launch if RLS is wanted.
- **A kill switch through the application record.** `phGate` ignores `Application(pharmacy).status`, so disabling the
  pharmacy application does **not** close `/pharmacy`. To stop a pharmacy today, suspend the business, end its
  `pharmacy` subscription, or deploy without the route.
- **Typo-tolerant search.** Search matches each word as a substring. `panadl` finds nothing. Trigram similarity needs
  raw SQL on a tenant table, and that exception to tenant scoping is an owner decision.
- **Cancelling a scheduled price.** A future price (up to 90 days ahead) cannot be cancelled before it starts.
- **Retail price caps.** No official maximum price is enforced anywhere, and the price actions have no cap hook yet
  (open owner question A).
- Stock, batches, receiving, counts (phase 2). Sales, shifts, receipts, scanner and printer support (phase 3).
  Purchasing (4), AI intake (5), transfers and chain reports (6), assistant, prescriptions, credit, advanced printing (7).
  Offline selling.
- **Screens for support access and bulk prices.** Granting, revoking, recording consent and listing support grants,
  and the bulk price preview and apply, exist as server actions with tests. None of them has a Server Action wrapper
  or a screen yet.
- **Deleting a pharmacy or one of its branches from Studio.** Both are refused with a clear message (a pharmacy is
  suspended, never deleted). FOOD restaurants and their branches are deleted as before.
- Smaller gaps: stale PREVIEW import or price batches are never marked cancelled. Browser Back is not caught by the
  leave guard (the draft stays on the device). There is no image picker and no category creation screen. The
  category and shelf location columns are not imported. The ar and ckb strings are machine drafts awaiting native review.

## Policies

**Support access.** A Super Admin has no pharmacy rights by being a Super Admin: without a grant they are refused
like a stranger. A grant (`SupportAccessGrant`) is given by the pharmacy owner (`support.grant`), or recorded by a
Super Admin from the owner's written consent (`support.recordConsent`, needs `people.manage`). These are server only
for now: there is no Server Action and no screen for granting, revoking or recording consent. Every grant has:

- scopes: `catalog.read`, `stock.read`, `sales.read`, plus `rx.read` and `patients.read`, which need an explicit
  confirmation;
- a reason of at least 10 characters;
- a window of at most 72 hours;
- immediate revocation. This also works while the pharmacy is read-only. A closed (archived) pharmacy refuses the
  revoke, but it also refuses every support read, so an unrevoked grant there reads nothing.

A support actor only reads: today `catalog.read` covers `catalog.view` and `sales.read` covers `report.view`. Cost,
profit and prescription attachments are never covered by a grant. Every support read writes a `support.read` audit row
naming the grant before the read runs, and the read fails if the audit cannot be written. Open for the owner: a Super
Admin may record consent naming themselves as the grantee.

**Retention after a subscription ends.** While a `pharmacy` subscription is TRIAL, ACTIVE or GRACE, everything works.
After it lapses (EXPIRED, or CANCELLED), the pharmacy is **read-only for 90 days**. Reads and exports still work, and
every write is refused. After that it is closed (archived). Nothing is deleted automatically. The window is the
platform setting `pharmacyRetentionDays` (default 90). It is measured from the end of grace, or from the cancellation
date. For an expired trial it is measured from the end of grace, not the trial end, which is noted for review.

## How to run

Use a private embedded database. Never run tests against the shared 54329 database, Neon, or production.

```sh
npm ci
BUZZIFY_DB_PORT=<port> npm run db:up        # this worktree used 54381
npm run typecheck
npx eslint src tests
BUZZIFY_DB_PORT=<port> npm test              # tests/pharmacy/** plus the whole suite
BUZZIFY_DB_PORT=<port> npm run test:load     # seeds 50,000 products in the test DB itself, then wipes them
E2E_PORT=<free port> BUZZIFY_DB_PORT=<port> npx playwright test tests/e2e/pharmacy-shell.spec.ts tests/e2e/pharmacy-catalog.spec.ts
```

The phase 0 and 1 acceptance scenarios are in `tests/pharmacy/acceptance-phase-0-1.test.ts`. The standard
`npm run test:e2e` setup needs the seeded ATELIER menu (`prisma db seed`) in the database it runs against.

For a local catalog to browse, `npx tsx prisma/seed-load-pharmacy.ts` seeds 50,000 products. It refuses any database
other than 127.0.0.1:54381, and `--clear` removes them. Pass `DATABASE_URL` explicitly: one-off `tsx` scripts do not
read `.env`.

## Before merging or deploying

**Merging is deploying.** The host build `build:host` (`package.json` line 37) runs `prisma migrate deploy` before
`next build`, and so does `vercel-build`. Merging this branch into the branch the host builds from therefore runs all
six pharmacy migrations on production unattended (`20261027100000` to `20261027150000`).

Do not merge until these steps are done, in this order, or merge with the deploy pipeline paused:

1. **Slug check (read-only).** Confirm that no production menu uses the slug `pharmacy`. It is now reserved and shadowed
   by `/pharmacy`, so such a menu's public address would stop working the moment the build goes out.
2. **Neon check, on a branch of production.** Run `CREATE EXTENSION IF NOT EXISTS pg_trgm` and confirm the database
   ctype is UTF-8 (`SELECT datctype FROM pg_database ...`). Locally the ctype is C, which gives Arabic no trigrams.
   If migration `20261027140000` (which creates the extension) fails on production, `migrate deploy` leaves it in
   the failed state, and **every later build fails, FOOD included**, until someone runs `prisma migrate resolve`.
3. **Backup** of the production database.
4. **Deploy** with the owner's explicit approval (spec section 13). Record the results of steps 1 to 3 in the ledger.

`lock_timeout` is **not set** in the foundation migration `20261027100000`. Its `ALTER TABLE "Restaurant"` takes an
`ACCESS EXCLUSIVE` lock, which can queue behind a long query and stall menu traffic. Consider adding
`SET lock_timeout = '5s'` at its top before the first production deploy.

## Open items

- **Support consent:** the Task 11 ruling lets a Super Admin record consent naming themselves as the grantee, and
  confirm `rx.read` / `patients.read` alone. A second-person rule must be decided **before phase 3**, when
  prescription and patient data exist.
- **Before phases 2 and 3:** re-test the isolation layer. That means `ctx.scoped`, the composite foreign keys and the
  regex-based rule 8 in `tests/studio/enforcement.test.ts`, which only recognises the receivers `db`, `prisma`,
  `prisma()` and `getPrisma()`. Re-run the RLS spike, and time a search end to end on Neon.
- **Support revoke screen:** it must ship with the grant screen or before it. A grant without a visible revoke
  button is worse than no grant screen.
- **Typo-tolerant search, kill switch, scheduled-price cancellation, price caps:** see "What is NOT built".
