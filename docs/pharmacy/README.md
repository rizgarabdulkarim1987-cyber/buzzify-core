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
- `AppPlan` with branch and user limits, edited on the Studio billing plans page.
- Branch isolation in the tenant client (`src/server/data/tenant-db.ts`, `PHARMACY_BRANCH_SCOPED_MODELS`). Pharmacy
  actions and queries get `ctx.scoped`, a client confined to the business and to the actor's branches. Enforcement
  tests refuse direct `db.ph*` access in pharmacy folders.
- Pharmacy roles and permissions, separate from Studio and cashier roles: `OWNER`, `BRANCH_MANAGER`,
  `PHARMACIST_IN_CHARGE`, `PHARMACIST`, `CASHIER`, `STOCK`, `ACCOUNTANT` (`src/server/domain/pharmacy/permissions.ts`).
- Support access through `SupportAccessGrant` (see the policy below), with a permanent support banner in the UI.
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
  edited in place. A start may be up to 90 days ahead, and bulk price changes are previewed first.
- Search (`src/server/pharmacy/search.ts`) by barcode, name, Arabic name, ingredient or several words. The local p95
  is about 18 ms on 50,000 products (`npm run test:load`).
- Excel/CSV import with a preview (`/pharmacy/catalog/import`). Every row is checked and stored with its issues, and
  nothing changes until apply. Apply is one transaction (60 s timeout). Limits: 10,000 rows and 5 MB per file. A
  committed file uploaded again is flagged `DUPLICATE_IMPORT`. Export writes CSV (UTF-8 BOM) or XLSX that re-imports
  as is, and cells starting with `= + - @` are escaped. Cost columns are shown only to holders of `cost.view`.
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
- Smaller gaps: stale PREVIEW import or price batches are never marked cancelled. Browser Back is not caught by the
  leave guard (the draft stays on the device). There is no image picker and no category creation screen. The
  category and shelf location columns are not imported. The ar and ckb strings are machine drafts awaiting native review.

## Policies

**Support access.** A Super Admin has no pharmacy rights by being a Super Admin: without a grant they are refused
like a stranger. A grant (`SupportAccessGrant`) is given by the pharmacy owner (`support.grant`), or recorded by a
Super Admin from the owner's written consent (`support.recordConsent`, needs `people.manage`). Every grant has:

- scopes: `catalog.read`, `stock.read`, `sales.read`, plus `rx.read` and `patients.read`, which need an explicit
  confirmation;
- a reason of at least 10 characters;
- a window of at most 72 hours;
- immediate revocation.

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

## Before any deploy

- Run a read-only check that no production menu uses the slug `pharmacy`, which is now reserved and shadowed by `/pharmacy`.
- On Neon, verify that `CREATE EXTENSION pg_trgm` works and that the database ctype is UTF-8. Locally it is C, which
  gives Arabic no trigrams. Then re-measure search p95 there.
- Run `migrate deploy` only with the owner's explicit approval and after a backup (spec section 13).
