# Buzzify Pharmacy: phases 0 to 3

The pharmacy module runs a pharmacy business (sector `PHARMACY`) inside this repository, next to the menu and the
cashier, which stay as they were. Design: `docs/superpowers/specs/2026-10-27-pharmacy-design.md` (Arabic). Plans:
`docs/superpowers/plans/2026-10-27-pharmacy-phase-0-1.md`, `docs/superpowers/plans/2026-10-27-pharmacy-phase-2.md` and
`docs/superpowers/plans/2026-10-28-pharmacy-phase-3.md`.
This file covers what phases 0, 1, 2 and 3 built, what they did not build, and the policies in force.

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
  measured** and must be done before phase 3 (sales). `invokePh` and `invokePhQuery` now pass the actor and gate that
  `getPhAccess` resolved for the request to the framework (`phAccess` option), so `admit` does not resolve them again:
  9 fewer queries per call (a search 34 to 25, a stock list 28 to 19, counted in `tests/pharmacy/request-reuse.test.ts`
  with `cache()` standing in for one request). The framework uses them only for the same person and pharmacy and still
  runs the gate, permission and branch checks. Pages that call `query()` directly do not use it yet.
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

**Phase 2: stock, receiving, counts and expiry**

Quantities are whole numbers in the product's base unit. Money is `BigInt` minor units with a currency beside it.

- **Stock ledger** (`PhBatch`, `PhStockBalance`, `PhStockMovement`; one writer, `src/server/pharmacy/stock.ts`). A batch is
  a lot with an expiry (day or month precision) of one product. Each branch holds four buckets per batch: available,
  reserved, quarantine, damaged. A database CHECK refuses a negative bucket even for a direct write, and the service
  refuses first (`INSUFFICIENT_STOCK`, nothing written). A trigger makes movements append-only (update and delete are
  refused; deleting a whole business still works). A correction is a **reversing entry**: the original row stays, a new
  row with the opposite deltas points to it (`reversesId`), a second reversal of the same movement and a reversal of a
  reversal are refused. Enforcement tests allow only `stock.ts` to write the stock tables.
- **Batch identity** is business, product, lot and expiry. The supplier is not part of it: the same lot received twice
  (even from another supplier, even written `lot-1` and `LOT-1`) adds to one batch. A batch keeps the cost of its first
  receipt; a receipt line with another cost raises a `COST_DIFFERS` warning and keeps its own cost on the line.
- **Manual receiving** (`ph.stock.receipt.*`, screen `/pharmacy/stock/receive`): a draft with lines (pack, quantity, bonus
  quantity, lot, expiry as `MM/YYYY`, `DD/MM/YYYY` or ISO, cost, free-of-charge flag), kept on the device while typing.
  Confirm creates or finds the batches, writes one RECEIPT movement per line, and gives the receipt a number (`R-000001`,
  per branch, no gaps because only confirmed receipts get one). Create is idempotent by client key; the same key with
  other content is refused. A past expiry is refused unless the line is marked "accept although expired", and then the
  stock goes straight to quarantine. A draft can be voided; a confirmed receipt is corrected by reversing its stock.
- **Manual stock changes** (`ph.stock.adjust`, `damage`, `quarantineRelease`, `reverse`): add, remove, move between
  buckets, write off as damaged, release quarantine (restock or damage). A reason of 3 to 300 characters is required.
  Adding to available is refused for an expired, recalled or blocked batch. Confirming a receipt line into an
  **existing** batch is refused (`CONFLICT`, `BATCH_NOT_ACTIVE`, naming product and lot, the whole confirm rolls back)
  when that batch is RECALLED, or BLOCKED; the one exception is an expired line accepted into quarantine, which may
  join a BLOCKED batch (it stays unsellable) but never a RECALLED one. Confirm also re-checks each line against the
  catalog as it is now: an archived product is refused (`PRODUCT_ARCHIVED`), and if the unit's size changed since the
  draft the base quantity no longer matches (`LINE_STALE`, save the receipt again).
- **Stock counts** (`ph.stock.count.*`, screens `/pharmacy/stock/counts`): open a count of a branch, a category or a
  shelf-location prefix (at most 5,000 lines), optionally blind (expected quantities are not sent to the browser until
  submit). Counted values are saved, submitted, then approved. Each counted line is stamped with `countedAt`, and its
  `expectedAtCount` is the quantity at open plus the available movements of that batch between open and `countedAt`
  (this count's own movements excluded): a sale or receipt made while counting is already in the number the shelf is
  compared with, and movements after `countedAt` stay on top of the correction. The difference applied is
  `counted - expectedAtCount`. Count lines also show the batch's quarantine and reserved stock (they are not on the
  shelf and not part of the expected quantity). More counted than expected is refused (`NOT_SELLABLE_HOME`) for an
  expired, recalled or blocked batch. Cancel needs ownership: an OPEN count is cancelled by whoever opened it or a
  holder of `stock.adjust`, a SUBMITTED one also by whoever counted it (`NOT_YOUR_COUNT` otherwise). A count with differences needs a reason and an approval,
  and the differences are applied **once**, as COUNT movements added to the current stock (a sale made while counting is
  kept). Rules in force: one counter per count (`COUNT_OWNED`); the approver may not be the counter when another holder
  of `stock.adjust` exists in the branch (`SELF_APPROVAL`; a lone holder may approve and the result says
  `selfApproved`); a count is refused at approve if another count changed the same batch since it opened
  (`STALE_COUNT`, recount); a result below zero refuses the whole approve and rolls everything back.
- **Expiry alerts** (`ph.stock.expiry`, screen `/pharmacy/stock/expiry`): horizons 30, 60, 90, 180 days, bands with
  totals, only batches with sellable, reserved or quarantine stock. Month-precision batches alert from the first of the
  month. The 90-day list equals an independent computation (acceptance test). A follow-up status per batch and branch
  (new, in progress, disposed, moved, returned) with an assignee and a note; DISPOSED writes the remaining stock off as
  damaged and needs the exact quantity left.
- **Screens**: stock overview with batches in FEFO order and the change forms, stock movements with reverse, receiving,
  expiry, counts. en, ar and ckb, RTL, no motion (a scan test enforces it), states shown with icon and text, 375/768/1280
  without horizontal scroll and axe-clean in the Playwright runs of each screen.
- **What a blind count hides.** Blind hides the expected quantities **only in the count screens and the count query**.
  The stock overview and the expiry list show `available` to every role that can open them, so a counter who looks
  there can see the expected figure. Blind is a convenience against anchoring, not a control.
- **Cost** appears only for holders of `cost.view`: balances, expiry and receipt reads omit the cost keys otherwise.
- **Kill switch**: `Application(pharmacy).status = DISABLED` closes `/pharmacy` (see Policies).
- **Second-person consent rule** for support access: the Super Admin who records a consent may not be the grantee
  (`CONSENT_SELF`), checked by user id after the grantee is found by email, and by email before.
- **Subscription row choice.** Billing can start a new `pharmacy` subscription row after a lapse, so a business can
  hold several. The gate reads them in one query and uses a live row (TRIAL, ACTIVE, GRACE) if there is one, else the
  newest by `createdAt`, `id`. `posGate` (`src/server/pos/actor.ts`) still uses an unordered `findFirst` on the
  `cashier` subscription with the same weakness; it was reported and left unchanged on purpose.
- **Stale batches**: a PREVIEW price batch or PREVIEWED import batch older than 7 days is cancelled when the next
  preview of that business is stored; bulk price changes leave archived products out unless `includeArchived`.
- **Isolation sweep** (`tests/pharmacy/isolation.test.ts`): every phase 2 definition is tried against another business,
  another branch and a branch-limited person; a new `ph.*` definition without an entry fails the test.
- **Request-level reuse** (search latency): `invokePh` and `invokePhQuery` hand the actor and gate that
  `getPhAccess` resolved to the framework, so it does not resolve them again. Queries counted by
  `tests/pharmacy/request-reuse.test.ts`: product search 34 to 25, stock balances 28 to 19 (9 fewer per call). A
  query count, not a time measurement.

**Phase 3: selling, shifts and cash, returns, receipts, scanner**

Money is `BigInt` minor units with a currency beside it; a sale and all its payments are in one currency (IQD or USD).
Every write below is one transaction, idempotent by `clientKey`, and audited with ids, numbers, totals and counts only
(no customer field, no cost).

- **Sale** (`ph.sales.create`, screen `/pharmacy/sell`): needs the seller's OPEN shift in the sale's currency. Each line
  stores its own price (`unitPriceMinor`, `unitId`, `priceId`) at sale time, so a later price change never rewrites
  history. A unit with no open price in the sale's currency at that branch cannot be sold (`NO_PRICE`), even by an
  override. Stock is taken FEFO from available stock of ACTIVE, not-expired batches, under row locks (one SALE movement per
  allocation); expired, recalled, quarantine, reserved and damaged stock is never allocated. `batch.override` plus a
  reason picks a specific batch, `price.change` plus a reason overrides a price. The number is per branch per UTC day
  (`YYYYMMDD-000123`). Lock order: sale key, shift (FOR SHARE), stock rows (batch ascending), number.
- **Discounts and rounding.** Per line and per invoice (amount or percent), judged on the combined discount: up to
  `PhSettings.maxDiscountPercent` (default 5) with `discount.apply`, above it `discount.over_limit` plus a reason.
  Invoice rounding is an IQD-only setting (`roundingStepMinor`, 0 = none), applied to the total and never to a line; the
  signed difference is stored (`roundingMinor`); it never turns a positive total into 0. USD is never rounded.
- **Payments.** CASH (with change), CARD_MANUAL and TRANSFER_MANUAL (exact, recorded by hand, no gateway). A sale is
  created paid in full. Mixed payments are allowed. Credit sales are not built.
- **Rx levels.** OTC sells to any holder of `shift.use`; RX needs `rx.dispense` on the seller (the pharmacist id is stored
  on the line); RESTRICTED (controlled) cannot be sold at all (`RESTRICTED_NOT_AVAILABLE`).
- **Holds** (`ph.sales.hold/resume/discardHold/holds`): a cart stored for 24 hours with no stock, no payment and no number.
  Completing it is `ph.sales.create` with `fromHoldId`, which consumes the hold in the same transaction (one winner).
  Holds belong to the branch, not the holder; a hold needs the holder's open shift in the cart's currency.
- **Shifts and cash** (`ph.shifts.open/close/current/report/list`, `ph.cash.paidIn/paidOut`, screen `/pharmacy/shifts`):
  one OPEN shift per user and branch (partial unique index); the shift's currency is tied by composite foreign keys; a
  trigger refuses a sale or return on a closed shift. Expected cash = opening float + cash payments - cash change - cash
  refunds + paid in - paid out. Close stores counted, expected and variance. When the variance exceeds
  `PhSettings.shiftVarianceLimitMinor` (0 = any difference), a reason is needed and a `report.view` holder must close it.
  The shift report is checked against independent sums of the rows.
- **Returns and cancel** (`ph.returns.create/preview/get/list/returnable`, `ph.sales.cancel`, screens `/pharmacy/returns`,
  `/pharmacy/sales`): `return.approve` is needed and the approver's own OPEN shift receives the refund. A return is
  limited to what was sold minus what was returned, per allocation; the units go to **QUARANTINE** of the same batch and
  branch (movement RETURN_QUARANTINE) and sell again only after the phase 2 quarantine release. The refund is what was
  paid net of change, pro rata; the final return takes the rounding difference. A sale older than `returnWindowDays`
  (default 30) needs OWNER or BRANCH_MANAGER. A cancel is a full return of what remains. Nothing is deleted or edited.
- **Receipts** (`ph.receipts.get/returnReceipt/reprint`, `src/server/pharmacy/receipt-print.ts`, pure builder and
  renderers in `src/server/domain/pharmacy/receipt.ts`): HTML (with `@page`) and plain text for 80 mm and 58 mm, English,
  Arabic and Kurdish, RTL aware, rendered from the stored rows and never from the screen. Golden files cover 58 and 80.
  The first print is read-only and unlogged. A reprint carries a copy marker and writes one `PhReceiptReprint` row per
  `clientKey` (user, width, reason, copy number); a repeated key returns the same copy. **A print failure is a screen state
  only: nothing in the sale, payments, stock or shift changes** (acceptance test).
- **Scanner** (`src/app/pharmacy/_ui/scanner.ts` plus a hook): keyboard-wedge capture (fast burst of characters then
  Enter or Tab), a barcode is always a string so leading zeros survive, Arabic digits are read as Latin, duplicates and
  stray characters are ignored. Camera scanning is not built.
- **Sale screen**: central search and scan, results with strength, form and pack, cart with quantity, unit and discount,
  FEFO batch strip, hold and resume, pay dialog, receipt view, shortcuts, an offline state that keeps the cart on the
  device. The attempt keys are kept with the draft, so a reload after a lost answer replays the same sale instead of
  selling twice. en, ar, ckb, RTL, no motion, 375/768/1280.
- **Names, not ids.** `ph.people.names` returns the names of the business's own people for the ids shown on shift, sale and
  return screens (name only; needs a till or report role; at most 50 ids).
- **Isolation.** The sweep covers every phase 3 definition (other business, other branch, branch-limited person, the
  STOCK role, a support grant, an accountant, a cashier). Enforcement allows only the sales, shifts, returns and receipt
  services to write the sale, shift, cash, return and reprint tables.
- **Migrations** (additive, eight): `20261028100000_pharmacy_sales`, `110000_pharmacy_sales_integrity`,
  `120000_pharmacy_sale_payload_hash`, `130000_pharmacy_shift_closed_guard`, `140000_pharmacy_return_payload_hash`,
  `150000_pharmacy_sale_hold_payload`, `160000_pharmacy_receipt_reprint_key`, `161000_pharmacy_receipt_reprint_reason`.

**Permissions matrix (who may do what in phase 3)**

| Action | Needs | Roles that hold it |
|---|---|---|
| Open a shift, sell, hold, paid in/out | `shift.use` | OWNER, BRANCH_MANAGER, PHARMACIST_IN_CHARGE, PHARMACIST, CASHIER |
| Close own shift | `shift.use` | the same |
| Close another person's shift, read every shift report | `report.view` | OWNER, BRANCH_MANAGER, PHARMACIST_IN_CHARGE, ACCOUNTANT |
| Close a shift whose variance is over the limit | `report.view` | the same (no named approver; the actor is recorded) |
| Sell a prescription (RX) line | `rx.dispense` | OWNER, BRANCH_MANAGER, PHARMACIST_IN_CHARGE, PHARMACIST |
| Discount up to the limit / above it | `discount.apply` / `discount.over_limit` | all sellers / OWNER, BRANCH_MANAGER, PHARMACIST_IN_CHARGE |
| Override a price | `price.change` | OWNER, BRANCH_MANAGER, PHARMACIST_IN_CHARGE |
| Pick a batch by hand | `batch.override` | OWNER, BRANCH_MANAGER, PHARMACIST_IN_CHARGE |
| Return or cancel a sale | `return.approve` | OWNER, BRANCH_MANAGER, PHARMACIST_IN_CHARGE (a CASHIER cannot) |
| Release quarantine | `stock.adjust` | OWNER, BRANCH_MANAGER, PHARMACIST_IN_CHARGE |
| Print and reprint a receipt | `shift.use` or `report.view` | all of the above plus ACCOUNTANT |
| Sell a controlled (RESTRICTED) drug | nobody in phase 3 | none |

The STOCK role and a support actor sell nothing and read no shift. The matrix lives in
`src/server/domain/pharmacy/permissions.ts`; the isolation sweep pins the refusals.

## What is NOT built

- **Phase 4 onward**: purchasing (4); AI intake (5); transfers and chain reports (6); assistant, prescriptions, credit,
  controlled-drug register, advanced printing (7). Offline selling (the sale is not queued; the screen says so and keeps
  the cart).
- **Phase 3 known limits.**
  - Silent printing, ESC/POS and the cash drawer are not built: browser print only. Receipts print the date and time in the business zone `PhSettings.timeZone` (IANA name, default `Asia/Baghdad`; there is no settings screen for it yet, so it is set in the database, and an unknown name falls back to the default). Stored instants stay UTC. **Sale and return numbers still use the UTC day** (`20261028-...`), so the number series rolls over at 03:00 Baghdad time and a sale at 01:30 local carries the previous day's number. The receipt footer is omitted (no field). Digits on paper are Latin.
  - Mixed currency payment is not built (one currency per sale). A user selling in both currencies must close and reopen a shift (one OPEN shift per user and branch).
  - A refund method is not capped per payment method: a mixed-payment sale can be refunded wholly in one method, so the drawer can pay cash it never received.
  - `ph.sales.create` is not constant in queries: 29 fixed + 5 per stock allocation (59 for 3 lines, 149 for 12). The search is constant at 25. **Latency on Neon is not measured**; batching the ledger writes is the fix.
  - `fromHoldId` is only a consumption token: the submitted cart is trusted. Expired holds are never purged; any seller can discard another's hold; the holds list shows 100 with a "more" flag and no cursor.
  - Reprint reasons are free text and may contain a patient name: the UI says so. An accountant can reprint and close another person's drawer by the matrix.
  - Payment order on a receipt follows the payment id. The shift report's held count may include holds that expired but were not yet flipped.
  - The pharmacy end-to-end specs must run with `--workers=1` (the Application row is switched ACTIVE and back, and parallel workers race). `pharmacy-create.spec` needs the Super Admin setup. The sale screen and scanner hook were verified with Playwright, not in the in-app Browser pane; the print iframe is skipped by axe.
  - ar and ckb strings of phase 3 are machine drafts, unreviewed by a native speaker.
- **A supplier link for receipts.** A receipt carries a supplier name as text; there is no supplier record, and the
  supplier is not part of batch identity.
- **Expiry MOVED and RETURNED are labels.** They record a decision and move no stock. Only DISPOSED changes stock.
- **Opening a count is not idempotent.** There is no client key on a count: a double click or two tabs can open two
  counts (the result reports how many others are open). Overlap is caught later, at approve (`STALE_COUNT`).
- **The STOCK role cannot adjust or damage stock.** It holds `stock.count` and `purchase.manage` but not `stock.adjust`;
  the pharmacist in charge, manager and owner adjust. This is a ruling awaiting the owner.
- **Quantities are in base units only in the screens.** The server accepts a pack and a quantity for adjustments, but
  the balances payload carries no ladder, so the forms, counts and expiry disposal ask for base units.
- **Assignee choice is limited.** The expiry follow-up offers Me, Nobody or keep; assigning someone else needs a branch
  staff list. People are shown as "You" and "Someone else".
- **A 5,000-line count is not windowed.** All lines are rendered; this was not exercised with 5,000 lines in a browser.
- **`/pharmacy` is closed until it is switched on.** `Application(pharmacy)` ships `DISABLED` (phase 0 migration), and
  the kill switch built in phase 2 honours it, so every pharmacy is paused until the row is set `ACTIVE`. There is no
  Studio screen for this toggle; it is a launch step.
- **ar and ckb are machine drafts.** No native speaker has reviewed any pharmacy string, including the roughly 470 keys
  added in phase 2 (about 400 screen strings and 66 server sentences) (terms to check: lot, quarantine, blind count, surplus/shortage, write off).
- **End-to-end latency on Neon is not measured**, for search or for the stock screens. Only query counts are.
- **RLS was not re-run** for the phase 2 tables (see below).
- Smaller gaps: the movement list shows who as the start of a user id; the approval record shows time and reason, not
  the approver's name; the receipts screen has no scanner wedge (typed or pasted barcodes work); USD entry in receiving
  is unit-tested but was not exercised in a browser.
- **Row-level security.** The RLS spike decided DEFER: the safety properties held, but product search lost +137% p95
  from the policy alone (`docs/superpowers/specs/2026-10-27-pharmacy-rls-spike.md`). Isolation is application-level
  only (`ctx.scoped` plus enforcement tests). The spike script was deleted. It can be recovered from git at
  `7d25a6d` and should be re-run on a Neon branch before launch if RLS is wanted.
- **Typo-tolerant search.** Search matches each word as a substring. `panadl` finds nothing. Trigram similarity needs
  raw SQL on a tenant table, and that exception to tenant scoping is an owner decision.
- **Cancelling a scheduled price.** A future price (up to 90 days ahead) cannot be cancelled before it starts.
- **Retail price caps.** No official maximum price is enforced anywhere, and the price actions have no cap hook yet
  (open owner question A).
- **Screens for support access and bulk prices.** Granting, revoking, recording consent and listing support grants,
  and the bulk price preview and apply, exist as server actions with tests. None of them has a Server Action wrapper
  or a screen yet.
- **Deleting a pharmacy or one of its branches from Studio.** Both are refused with a clear message (a pharmacy is
  suspended, never deleted). FOOD restaurants and their branches are deleted as before.
- Stale previews: a PREVIEW price batch or PREVIEWED import batch older than 7 days is cancelled when the next preview of
  that business is stored (queries cannot write). Bulk price changes leave archived products out unless `includeArchived`.
- Smaller gaps: Browser Back is not caught by the
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

A support actor only reads: today `catalog.read` covers `catalog.view` and `sales.read` covers `report.view`.
**`stock.read` unlocks nothing yet**: no permission maps to it. Also, a `catalog.read` grant passes the framework for the
stock, expiry and receipt queries (they are declared with `catalog.view` or `report.view`), but those handlers refuse a
support actor (`FORBIDDEN`) **after** the `support.read` audit row is written, so such a read leaves an audit row and
returns nothing. Cost,
profit and prescription attachments are never covered by a grant. Every support read writes a `support.read` audit row
naming the grant before the read runs, and the read fails if the audit cannot be written. Recording consent needs a second
person: the grantee may not be the Super Admin who records it (`CONSENT_SELF`), and the recorder must be a Super Admin
with a consent reference of at least 10 characters (also for `rx.read` / `patients.read`).

**Kill switch.** Setting `Application(pharmacy).status` to DISABLED closes `/pharmacy` for every pharmacy (gate reason
`applicationDisabled`, no extra query: it is read with the subscription). Studio billing and provisioning do not use the gate.
The row **ships DISABLED** (phase 0 migration), so a new deployment has `/pharmacy` closed until someone sets it ACTIVE.

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
# phase 3 (serial: the specs flip Application(pharmacy) ACTIVE and back)
BUZZIFY_DB_PORT=<port> npx vitest run tests/pharmacy/acceptance-phase-3.test.ts
E2E_PORT=<free port> BUZZIFY_DB_PORT=<port> npx playwright test tests/e2e/pharmacy-sell.spec.ts tests/e2e/pharmacy-shifts-returns.spec.ts --workers=1
```

Every vitest, prisma, tsx and playwright command takes `BUZZIFY_DB_PORT` (this worktree used 54503). Pharmacy e2e runs
use `--workers=1`. The kill switch is `Application(pharmacy).status`: the specs set it `ACTIVE` and restore it; setting
it `DISABLED` closes `/pharmacy` for everyone.

The phase 0 and 1 acceptance scenarios are in `tests/pharmacy/acceptance-phase-0-1.test.ts`, those of phase 2 in
`tests/pharmacy/acceptance-phase-2.test.ts`, those of phase 3 in `tests/pharmacy/acceptance-phase-3.test.ts`. Run one test file at a time: the suites share one test database. The standard
`npm run test:e2e` setup needs the seeded ATELIER menu (`prisma db seed`) in the database it runs against.

For a local catalog to browse, `npx tsx prisma/seed-load-pharmacy.ts` seeds 50,000 products. It refuses any database
other than 127.0.0.1:54381, and `--clear` removes them. Pass `DATABASE_URL` explicitly: one-off `tsx` scripts do not
read `.env`.

## Before merging or deploying

**Merging is deploying.** The host build `build:host` (`package.json` line 37) runs `prisma migrate deploy` before
`next build`, and so does `vercel-build`. Merging this branch into the branch the host builds from therefore runs all
nineteen pharmacy migrations on production unattended: the six of phases 0 and 1 (`20261027100000` to `20261027150000`) and
the five of phase 2 and the eight of phase 3 (listed under Phase 3 above), all additive (new tables, columns with defaults, indexes, a trigger; nothing existing is changed):

- `20261027160000_pharmacy_stock`: the eight stock tables, the CHECK constraints, the reversal index and the
  append-only trigger on `PhStockMovement`.
- `20261027170000_pharmacy_receipt_fields`: receipt number and its unique key, bonus quantity, free-of-charge and
  accept-expired flags on lines.
- `20261027180000_pharmacy_batch_identity_unique`: unique index on business, product, lot and expiry.
- `20261027190000_pharmacy_movement_client_key`: partial unique index for idempotent stock changes.
- `20261027200000_pharmacy_count_counted_at`: `countedAt` on count lines.

`main..HEAD` also carries **six migrations that are not pharmacy**: `20261026203406_user_appearance`,
`20261026205851_announcements`, `20261026300000_complaint_suggestion`, `20261027100000_ai_menu_import`,
`20261027110000_import_job_photos` and `20261027120000_import_job_translations` (checked with
`git diff --name-only main..HEAD -- prisma/migrations`; the pharmacy ones are the other nineteen folders). They run on
production in the same `migrate deploy`, so they need the same dry run.

Locks: the new foreign keys take `SHARE ROW EXCLUSIVE` locks on `Restaurant`, `Branch` and `PhProduct` while they
are added, which blocks writes to those tables (not reads) for the duration, and **no `lock_timeout` is set** in any
of the migrations. The old five-column batch unique index (business, product, lot, expiry, supplier) is now redundant
next to the four-column one and can be dropped in a later migration; it is left in place.

Merging **runs these on production**, and that is still blocked: the owner's Neon preview branch for the dry run
is not available yet, so none of the nineteen has been run against Neon.

Do not merge until these steps are done, in this order, or merge with the deploy pipeline paused:

1. **Slug check (read-only).** Confirm that no production menu uses the slug `pharmacy`. It is now reserved and shadowed
   by `/pharmacy`, so such a menu's public address would stop working the moment the build goes out.
2. **Neon check, on a branch of production.** Run `CREATE EXTENSION IF NOT EXISTS pg_trgm` and confirm the database
   ctype is UTF-8 (`SELECT datctype FROM pg_database ...`). Locally the ctype is C, which gives Arabic no trigrams.
   If migration `20261027140000` (which creates the extension) fails on production, `migrate deploy` leaves it in
   the failed state, and **every later build fails, FOOD included**, until someone runs `prisma migrate resolve`.
3. **Backup** of the production database.
4. **Deploy** with the owner's explicit approval (spec section 13). Record the results of steps 1 to 3 in the ledger.

Order at launch: **enable the application before starting subscriptions.** Billing refuses to start a pharmacy
subscription while `Application(pharmacy)` is DISABLED (`PRODUCT_DISABLED`: "Turn it on before starting a trial"), and
the row ships DISABLED. So set it ACTIVE first, then start the trials, then give out the address.

`lock_timeout` is **not set** in the foundation migration `20261027100000`. Its `ALTER TABLE "Restaurant"` takes an
`ACCESS EXCLUSIVE` lock, which can queue behind a long query and stall menu traffic. Consider adding
`SET lock_timeout = '5s'` at its top before the first production deploy.

## Open items

- **Owner decisions pending from phase 2:** the STOCK role cannot adjust; receiving needs `purchase.manage` and the
  pharmacist in charge holds it; the one-counter and second-person count rules; the `STALE_COUNT` refusal instead of
  merging overlapping counts; the default DISABLED state of the application. See section 16 of the spec.
- **Phase 3 owner list:** see the rulings table in section 16 of the spec (one OPEN shift per user and branch, strict NO_PRICE, UTC receipts, refund method not capped per method, accountant may reprint and close another drawer).
- **Before phase 3 (done in phase 3):** the isolation layer was re-tested for the phase 2 stock definitions
  (`tests/pharmacy/isolation.test.ts`: other business, other branch, a branch-1-only person; it fails when a new `ph.*`
  definition has no entry). Rule 8 in `tests/studio/enforcement.test.ts` now recognises more base-client receivers and
  only `src/server/pharmacy/stock.ts` may write the stock tables. Still open: re-run the RLS spike, and time a search
  end to end on Neon.
- **Support revoke screen:** it must ship with the grant screen or before it. A grant without a visible revoke
  button is worse than no grant screen.
- **Typo-tolerant search, scheduled-price cancellation, price caps:** see "What is NOT built".
