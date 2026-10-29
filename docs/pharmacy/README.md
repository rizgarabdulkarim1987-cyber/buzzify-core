# Buzzify Pharmacy: phases 0 to 4

The pharmacy module runs a pharmacy business (sector `PHARMACY`) inside this repository, next to the menu and the
cashier, which stay as they were. Design: `docs/superpowers/specs/2026-10-27-pharmacy-design.md` (Arabic). Plans:
`docs/superpowers/plans/2026-10-27-pharmacy-phase-0-1.md`, `docs/superpowers/plans/2026-10-27-pharmacy-phase-2.md` and
`docs/superpowers/plans/2026-10-28-pharmacy-phase-3.md` and `docs/superpowers/plans/2026-10-29-pharmacy-phase-4.md`.
This file covers what phases 0, 1, 2, 3 and 4 built, what they did not build, and the policies in force.

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


## Phase 4: purchasing

Plan: `docs/superpowers/plans/2026-10-29-pharmacy-phase-4.md`. Rulings R4-1 to R4-15 and the later ones are in section 16
of the spec, each with its cost if wrong. Money is `BigInt` minor units with a currency beside it (IQD or USD, never
mixed, never converted); quantities are whole numbers. Every create takes a `clientKey` and is idempotent: a repeat from
the same person with the same request returns the stored record (`replayed: true`), anything else is `CLIENT_KEY_MISMATCH`.
Audit `changes` carry ids, counts, statuses, amounts and currency, never a note, a phone number or an invoice number's text.

**What exists**

- **Suppliers** (`PhSupplier`, business-wide): name (unique per business, case, spacing, invisible and bidi marks ignored),
  phone, contact, address note, default currency, payment terms in days, active flag. Archive, never delete; an archived
  supplier can still be paid and its credit still recorded, but takes no new order or invoice.
- **Purchase orders** (`PhPurchaseOrder`, per branch): one supplier, one currency, lines of `qtyOrdered`, `bonusOrdered`
  and an agreed unit cost. DRAFT, ORDERED, PARTIAL, RECEIVED, CLOSED, CANCELLED. The number `PO-YYYYMMDD-000123` is per
  branch per UTC day, given when ordered. Editing is DRAFT only; later a change is a close or a new order. `ph.po.suggest`
  lists products below their minimum (narrowed to the supplier's earlier deliveries when a supplier is chosen;
  `supplierHasHistory` tells a new supplier from an established one).
- **Receiving against an order** reuses the phase 2 receipt (no second path): `PhReceipt.purchaseOrderId`/`supplierId` and
  `PhReceiptLine.purchaseOrderLineId`. Confirming raises the order line's `receivedQty` and `receivedBonus` (only
  `purchase-orders.ts` writes them) and moves the order to PARTIAL or RECEIVED. More than ordered is `OVER_RECEIPT`
  (bonus counted on its own), a product not on the order `NOT_ON_ORDER`, a cancelled or closed order `ORDER_NOT_OPEN`. A
  different cost on the receipt than on the order is stored as received and shown, never refused.
- **Supplier invoices** (`PhSupplierInvoice`, business-wide): the supplier's number, invoice date, due date (default date
  plus the supplier's terms), currency, lines that bill CONFIRMED receipt lines of that supplier (`qtyInvoiced` at most
  quantity plus bonus received, less what other invoices took: `INVOICE_EXCEEDS_RECEIVED`), and a signed adjustment with a
  reason (freight, discount). `total = sum of lines + adjustment`, checked by the database at commit. **Duplicate
  detection**: the supplier's number as normalised (invisible marks out, Arabic digits to Latin, upper case, spaces
  collapsed) is unique per supplier, and a fingerprint of supplier, number, date, currency and total is unique per
  business; a second entry is refused `DUPLICATE_INVOICE` and names the first (`existingInvoiceId`). A receipt line can be
  on an invoice once, so a bonus is billed by spreading the price over quantity plus bonus. The invoice cost never rewrites
  a batch's cost; the variance (order against receipt against invoice) is a read. **Void** needs nothing paid or credited;
  it releases the invoiced quantities and renames the invoice's number and fingerprint (`#void-<id>`) so the supplier's
  real number can be entered again.
- **Payables**: the invoice is the payable (`paidMinor`, `creditedMinor` counters; status OPEN, PARTIAL, PAID, VOID).
  `ph.payables.list` (open invoices with due bands NOT_DUE, DUE_7 = today through 7 days ahead, OVERDUE_1_30, OVERDUE_31_60,
  OVERDUE_60_PLUS) and `ph.suppliers.balances` (one row per supplier and currency: open, overdue, unused credit).
- **Supplier payments**: CASH, TRANSFER_MANUAL, CHEQUE_MANUAL, CARD_MANUAL, recorded by hand (no gateway), dated no earlier
  than 2000-01-01 and no later than tomorrow. The amount must be placed in full on invoices of the same supplier and
  currency, as told or oldest due first (no advances, no cross-currency: `UNALLOCATED`, `CURRENCY_MISMATCH`). A payment is
  never edited: a mistake is a reversal row, once, which takes the original's allocations off again. Payments do not touch
  the cashier drawer or a shift.
- **Credit notes** (`PhCreditNote`): the supplier's own document (supplier, currency, their number, amount, date,
  optionally the supplier return it answers). Applied to invoices of the same supplier and currency, as told or oldest due
  first; a note can sit on a given invoice **once** (`CREDIT_ALREADY_ON_INVOICE`). A note is not un-applied in v1, and no
  cash refund from the supplier is built.
- **Supplier returns** (`PhSupplierReturn`, per branch): stock sent back from the AVAILABLE or QUARANTINE bucket of a
  batch (movement `SUPPLIER_RETURN` through `applyMovement`, the only stock writer), one transaction, a short line fails
  the whole return. Recalled, blocked and expired batches can go back. The return's value uses the one line-cost rule
  `costOfBaseQty` (unit cost x quantity / cost unit size, floored), the same as the sale cost snapshot; when a returned line
  has no cost the value says `incomplete: true` (a floor, not a total).
- **Supplier statement** (`ph.suppliers.statement`): one supplier, one currency, a date range of at most 366 days:
  opening balance, rows in day order with a running balance (INVOICE +, INVOICE_VOID -, PAYMENT -, PAYMENT_REVERSAL +,
  CREDIT_NOTE -), closing balance. A credit note reduces the balance when recorded; applying it only maps it to invoices.
  When the range reaches today the closing balance is checked against the open invoices less the unused credit
  (`invariant`). The acceptance test builds the ledger by hand and recomputes it from the raw rows with SQL of its own.
- **Screens** (`/pharmacy/purchasing/...`, nav entries in the pharmacy shell only): hub, `suppliers` (list, new, `[id]`,
  `[id]/statement`), `orders` (list, new, `[id]`, `[id]/edit`), `invoices` (list, new, `[id]`), `payables`, `payments`
  (list, `new`, `[id]`), `credits` (list, new, `[id]`), `returns` (list, new, `[id]`), and the receive screen's "against an
  order" mode. en, ar, ckb (ar and ckb machine drafts, unreviewed), RTL, no motion, 375/768/1280, axe.
- **Locks** (header comment of every service that locks): client key (advisory, namespace 7201) -> order row FOR UPDATE ->
  draft receipt row -> order lines -> receipt line counters (id order) -> credit note row -> invoice rows FOR UPDATE (id
  order; an existing invoice is locked before its receipt lines on void) -> stock rows (batch id, `COLLATE "C"`) -> number
  lock (7202, per branch and series). The phase 4 locks are two-int advisory keys; the older receipt confirm (and count confirm) take a one-int lock, `hashtext('ph-receipt:<branch>')`.
- **Who writes what** (rule 8 in `tests/studio/enforcement.test.ts`): only `suppliers.ts`, `purchase-orders.ts`,
  `supplier-invoices.ts`, `supplier-payments.ts`, `credit-notes.ts` and `supplier-returns.ts` write the purchasing tables
  (payments also write the credit allocations); `PhReceiptLine.invoicedQty` only by `supplier-invoices.ts`; the order line
  counters only by `purchase-orders.ts`; the stock tables still only by `stock.ts`. Scan limits: it recognises
  delegates, `updateWithVersion(delegate, ...)`, destructured delegates and raw SQL; it does not follow a nested write
  through a relation (`lines: { create }`).
- **Isolation**: the sweep names all 34 phase 4 definitions (no entry in `COVERED_ELSEWHERE`): other business, other
  branch, branch-limited person, support grant, roles that may not.
- **Migrations** (additive, four): `20261029100000_pharmacy_purchasing`, `110000_pharmacy_purchasing_receipt_supplier_link`,
  `120000_pharmacy_supplier_payload_hash`, `130000_pharmacy_credit_allocation_replay`.

**Permissions matrix (who may do what in phase 4)**

| Action | Needs | Roles that hold it |
|---|---|---|
| Suppliers, orders, receiving against an order, entering and reading invoices, payables, statement | `purchase.manage` | OWNER, BRANCH_MANAGER, PHARMACIST_IN_CHARGE, ACCOUNTANT, STOCK |
| Record or reverse a supplier payment, void an invoice, record a credit note, apply credit (R4-9a) | `purchase.manage` and `report.view` | OWNER, BRANCH_MANAGER, PHARMACIST_IN_CHARGE, ACCOUNTANT (not STOCK) |
| Return stock to a supplier (R4-7a) | `purchase.manage` and `stock.adjust` | OWNER, BRANCH_MANAGER, PHARMACIST_IN_CHARGE (not STOCK, not ACCOUNTANT) |
| See any amount, cost or balance | `cost.view` (money keys are absent otherwise; counts stay) | OWNER, BRANCH_MANAGER, PHARMACIST_IN_CHARGE, ACCOUNTANT, STOCK |

A cashier, a pharmacist and a support actor do none of it and read none of it. Suppliers, invoices, payments and credit
notes are business-wide (any branch of the business sees the same figures); orders and supplier returns are per branch,
and a branch-limited person sees and uses only their branches (an invoice that bills lines of a branch they lack shows
those lines without receipt detail and cannot be voided by them: `INVOICE_OTHER_BRANCH`).

**What phase 4 does NOT build**: invoice scanning or any AI intake (phase 5); a payment gateway (all methods are recorded
by hand); a cashier drawer link (payments are made from the office); advance payments and cross-currency payments or
conversion; tax; amending an order after it is ordered; a cash refund from a supplier; un-applying a credit note (a note
goes on a given invoice once); editing a payment or an invoice (void and enter again; reverse and pay again); a
dedicated `payable.manage` permission; a second approver for void or reversal; automatic reorder (phase 7). A voided
invoice's number can be entered again, and its row keeps a `#void-<id>` suffix in the raw data.

## Phase 5: invoice by photo (AI intake)

Plan: `docs/superpowers/plans/2026-10-29-pharmacy-phase-5.md`. Rulings R5-1 to R5-17 and the later ones are in section 16 of
the spec, each with its cost if wrong. The owner's checklist for real invoices is `docs/pharmacy/intake-uat.md`. The central
rule: **a value the model cannot see is null, and stays null until a person types it.** Intake never writes stock, price or
supplier invoices; an approval makes one DRAFT receipt, which a person confirms on the ordinary receive screen.

**What exists**

- **Upload** (`/pharmacy/purchasing/intake/new`, camera or files; the multipart route is `POST /api/pharmacy/intake/files`,
  Studio host only): JPEG, PNG, WebP or PDF, up to 8 MB, a PDF up to 10 pages (counted by a small parser: a linearised,
  incrementally saved or object-stream PDF is refused `PDF_UNREADABLE`, the person uses a photo or types it), up to 20 files
  per batch, the business's stored bytes counted against `limits.storageMb`. The type is read from the bytes. An image goes
  through the **quality gate before any AI call** (sharpness, short side, brightness, contrast; reasons `BLURRY`, `TOO_SMALL`,
  `TOO_DARK`, `LOW_CONTRAST`, with a "retake" hint). The same bytes twice are one file (SHA-256), with no second object and no
  second charge. Objects live in a **private R2 bucket** under `intake/<restaurantId>/<fileId>`; the object is written outside
  any transaction.
- **Reading** (`ph.intake.extract`, `ph.intake.retry`): the file is claimed with a 10-minute lease, a worst-case cost is
  RESERVED against the month's budget, the model is called once with the invoice as the only document (no tools, a strict JSON
  schema, invoice text only as data), the answer is re-validated, and one transaction saves the rows, merges the header and
  frees the claim. At most 200 lines per file (`TOO_MANY_LINES`), a flat output cap (`EXTRACTION_TRUNCATED`), at most 5
  readings per file (`EXTRACTION_ATTEMPTS_EXHAUSTED`). Any failure leaves the file `FAILED` with a code, the batch open and the
  manual receive screen one tap away.
- **Matching** (automatic after a reading, and "Match products again"): exact barcode, then exact identity (name, strength,
  form, pack), then name similarity through the trigram index. Any doubt is `AMBIGUOUS` and a person chooses; a product with
  several units is matched only when the invoice's pack text names one. Nothing is merged across strengths or packs.
- **Review** (`/pharmacy/purchasing/intake/<batch>`): header card and one card per line beside the original picture. Flags
  (each with an icon and a sentence): `MISSING`, `MATH_MISMATCH`, `MODEL_UNCLEAR`, `AMBIGUOUS_MATCH`, `EXPIRED`,
  `DUPLICATE_LINE`, all derived from the stored values at read time. A person clears a flag by typing the value, choosing the
  match, or marking the line reviewed with a note (a printed total that does not add up needs its own reason). A scan field
  fills lot and expiry from a GS1 barcode only where the line has none. "Only lines with open items" is on by default.
- **Approval** (`ph.intake.approve`): `purchase.manage`. Everything is decided from stored values under the batch lock: the
  version and the **verdict token** the screen last read (`APPROVAL_STALE` when anything changed), the open flags recomputed,
  the header arithmetic, the supplier, the currency, the invoice number (`INVOICE_NUMBER_REQUIRED`), and a **business-wide
  duplicate guard** by the supplier's number (spelling-insensitive) or fingerprint against supplier invoices and approved
  batches of every branch, ignoring batches whose receipt was voided (`DUPLICATE_INVOICE`, naming the earlier one). Then one
  `createDraft` receipt with key `intake-approve:<batchId>` (a reserved key). Replay by `clientKey` returns the same receipt.
- **Cancel and expiry**: cancel deletes the batch's objects first, then closes it; `expireOpenBatches` cancels batches left
  open 30 days; the purge script deletes files older than 30 days. Lines read stay as history.
- **Usage card** on the list: calls, tokens, and (with `cost.view`) spent, reserved and remaining USD for the Baghdad month.

**Permissions** (read from `permissions.ts`, not changed by this phase)

| Action | OWNER | BRANCH_MANAGER | PHARMACIST_IN_CHARGE | PHARMACIST | STOCK | ACCOUNTANT | CASHIER |
|---|---|---|---|---|---|---|---|
| Upload, read, retry, edit lines and header, match, scan (`purchase.manage` AND `ai.use`) | yes | yes | yes | no | no | no | no |
| View batches, list, original picture (`purchase.manage`) | yes | yes | yes | no | yes | yes | no |
| Approve and cancel (`purchase.manage`) | yes | yes | yes | no | yes | yes | no |
| Usage card (`purchase.manage` and `report.view`; money with `cost.view`) | yes | yes | yes | no | no | yes | no |

**Owner decision D4:** STOCK and ACCOUNTANT can approve a fully clean batch but every edit control is disabled for them with
the reason. A support grant reads none of it. Branch confinement: a person sees and acts only on batches of their own
branches; another branch's or business's ids behave as not found.

**Pipeline and statuses.** Batch: `OPEN` -> `APPROVED` (with `receiptId`) or `CANCELLED`. File: `UPLOADED` -> `EXTRACTING` ->
`EXTRACTED` | `FAILED` (code), or `REJECTED_QUALITY` (never stored), later `PURGED`. A line has no status of its own: its
state is its flags, `reviewed`, its acknowledgement and its match (`UNMATCHED`, `MATCHED`, `AMBIGUOUS`, `CHOSEN`).

**The approval gate.** An approval is refused (`NOT_APPROVABLE`, with row ids and flag codes only) while any line has an open
flag, there are no lines, or the header total differs from the lines and is not acknowledged. Every acknowledgement is
**bound to what the person was shown**: a note covers exactly the flags the line raised then (`ACK_STALE` otherwise), a
mismatch reason is bound to that difference and currency, and an edit that changes the difference reopens it. Every write to a
line or the header names the version the person read (`VERSION_CONFLICT`).

**Locks** (written in the header comments): client key (7201) -> upload lock (7210) -> batch row FOR UPDATE -> file rows by id
-> line rows by id; approval: its key (7301) -> batch -> files -> lines -> the invoice guard (7302, supplier and number) ->
the receipt service. The AI usage row is locked first in the runner, then the file's reservation, then the file.

**Storage, retention, environment**

- `PH_INTAKE_R2_ACCOUNT_ID`, `PH_INTAKE_R2_ACCESS_KEY_ID`, `PH_INTAKE_R2_SECRET_ACCESS_KEY`, `PH_INTAKE_R2_BUCKET`: all or none,
  the bucket different from `R2_BUCKET`. Without them upload answers `INTAKE_STORAGE_NOT_CONFIGURED`; it never uses the public
  bucket. Outside production a temp folder adapter is used (never in production).
- Signed picture links live at most 5 minutes and are minted per request after the access check.
- Retention is 30 days. `npx tsx scripts/pharmacy-intake-purge.ts [--limit N]` deletes expired objects from the bucket first,
  then marks the files `PURGED`; `npx tsx scripts/pharmacy-intake-expire.ts [--days N]` cancels stale open batches. Both print
  counts only and exit 1 when a deletion failed. **Scheduling both daily is a launch step**; nothing schedules them yet.
- `AI_PRICE_INPUT_USD_MICRO_PER_MTOK` and `AI_PRICE_OUTPUT_USD_MICRO_PER_MTOK`: no default; unset means `AI_PRICING_NOT_SET`.
  `AI_PROVIDER=fake` or `scripted` is refused in production and on a deployment, and the deploy check fails on it.

**AI budget unit.** The plan limit `aiMonthlyBudgetMinor` is read as **USD cents** (one cent = 10,000 micro-dollars); spend is
stored in micro-dollars per Baghdad month. A reading reserves its worst case (bounded input plus every output token allowed) in
one conditional update (`spent + reserved + worst <= budget`), calls the model, then settles to the real cost (never above the
reservation; an overrun is audited, an answer paid for is never thrown away). A reservation whose worker died is booked as
**spend** at the reserved amount by the sweeper (it runs at every upload and reading): the month can under-use its budget after
a crash, never overspend. A timeout bills the input side; a plain provider error bills nothing. `PhAiCall` keeps metadata only.

**Audit.** Ids, counts, statuses, flag codes, tokens and cost; never a name, lot, amount, number, note, reason or picture.

**What is NOT built (phase 5)**

- Barcode decoding from the picture (zxing): the model does not read barcodes; GS1 text typed or scanned fills lot and expiry.
  Decide on real photos (UAT D3).
- Restore of a removed line (there is no server action; removal asks first).
- Line and header discounts and tax are **not folded into the receipt cost**: a discounted line is `MATH_MISMATCH`, accepted with a
  reason at the printed pre-discount cost (UAT D5).
- A catalog index for 50k+ products in matching beyond the trigram search; the two matching statements disable sequential scans
  for their own transaction as a planner workaround.
- Scheduling of the purge, the expiry sweep and the bucket lifecycle rule (launch steps).
- Real-invoice evaluation: the 50 invoices of the acceptance test are synthetic; run `docs/pharmacy/intake-uat.md`.
- The server exposes one value per conflicting header field, not both values the files disagreed on.
- Sorani Kurdish is not a declared supported language of the reading (Arabic, English and mixed are).
- Trigram matching finds nothing for Arabic and Kurdish names under a database ctype of C (exact barcode and exact identity
  still match); the Neon database must be UTF-8 (UAT D2).
- ar and ckb strings are machine drafts.

**How to run the phase 5 tests** (always `BUZZIFY_DB_PORT=<port>`, one database test file at a time)

```sh
BUZZIFY_DB_PORT=<port> npx vitest run tests/pharmacy/acceptance-phase-5.test.ts     # 50 synthetic invoices end to end, outage, budget (about a minute)
BUZZIFY_DB_PORT=<port> npx vitest run tests/pharmacy/intake-eval.test.ts            # the evaluation script's comparison and its safety guard (no database use)
# one file at a time: intake-schema, intake-domain, intake-storage, intake-quality, intake-files, intake-upload-request, intake-purge-guard,
# intake-ai, intake-extract-schema, intake-extract, intake-review, intake-scan-domain, intake-approve, intake-scripted-env, intake-dev-route,
# ui-intake-logic, ui-intake-review-logic, ui-intake-review-fixes, isolation, receipts, supplier-invoices, purchase-orders
E2E_PORT=<free port> BUZZIFY_DB_PORT=<port> npx playwright test -c playwright.intake.config.ts --workers=1   # pharmacy-intake.spec.ts, pharmacy-intake-review.spec.ts (own server, AI_PROVIDER=scripted)
```

The e2e config starts its own dev server with the file-scripted provider and sets `Application(pharmacy)` ACTIVE and back.

## What is NOT built

- **Phase 6 onward**: transfers and chain reports (6); assistant, prescriptions, credit,
  controlled-drug register, advanced printing (7). Phases 4 (purchasing) and 5 (invoice by photo) are built; what phase 5 leaves out is listed at the end of its section above; what it leaves out is listed at the end of its section above. Offline selling (the sale is not queued; the screen says so and keeps
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
- **Supplier and batch identity.** Phase 4 added supplier records and a nullable `supplierId` on receipts (the free-text
  `supplierName` stays for old rows), but the supplier is still not part of a batch's identity: a batch received from one
  supplier can be returned to another (R4-7).
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
# phase 4 (one file at a time: the suites share one test database)
BUZZIFY_DB_PORT=<port> npx vitest run tests/pharmacy/acceptance-phase-4.test.ts
BUZZIFY_DB_PORT=<port> npx vitest run tests/pharmacy/suppliers.test.ts tests/pharmacy/purchase-orders.test.ts   # then receipts-against-orders, supplier-invoices, supplier-payments, supplier-returns, payables-reads, purchasing-domain, purchasing-schema
BUZZIFY_DB_PORT=<port> npx vitest run tests/pharmacy/isolation.test.ts tests/studio/enforcement.test.ts tests/studio/messages.test.ts
E2E_PORT=<free port> BUZZIFY_DB_PORT=<port> npx playwright test tests/e2e/pharmacy-purchasing.spec.ts tests/e2e/pharmacy-purchasing-money.spec.ts tests/e2e/pharmacy-receive.spec.ts --workers=1
E2E_PORT=<free port> BUZZIFY_DB_PORT=<port> npx playwright test tests/e2e/pharmacy-sell.spec.ts tests/e2e/pharmacy-shifts-returns.spec.ts --workers=1
```

Every vitest, prisma, tsx and playwright command takes `BUZZIFY_DB_PORT` (this worktree used 54503). Pharmacy e2e runs
use `--workers=1`. The kill switch is `Application(pharmacy).status`: the specs set it `ACTIVE` and restore it; setting
it `DISABLED` closes `/pharmacy` for everyone.

The phase 0 and 1 acceptance scenarios are in `tests/pharmacy/acceptance-phase-0-1.test.ts`, those of phase 2 in
`tests/pharmacy/acceptance-phase-2.test.ts`, those of phase 3 in `tests/pharmacy/acceptance-phase-3.test.ts`, those of phase 4 in `tests/pharmacy/acceptance-phase-4.test.ts`, those of phase 5 in `tests/pharmacy/acceptance-phase-5.test.ts`. Run one test file at a time: the suites share one test database. The standard
`npm run test:e2e` setup needs the seeded ATELIER menu (`prisma db seed`) in the database it runs against.

For a local catalog to browse, `npx tsx prisma/seed-load-pharmacy.ts` seeds 50,000 products. It refuses any database
other than 127.0.0.1:54381, and `--clear` removes them. Pass `DATABASE_URL` explicitly: one-off `tsx` scripts do not
read `.env`.

## Before merging or deploying

**Merging is deploying.** The host build `build:host` (`package.json` line 37) runs `prisma migrate deploy` before
`next build`, and so does `vercel-build`. Merging this branch into the branch the host builds from therefore runs all
twenty-eight pharmacy migrations on production unattended: the six of phases 0 and 1 (`20261027100000` to `20261027150000`) and
the five of phase 2, the ten of phase 3 (the eight listed under Phase 3 above, plus `20261028170000_pharmacy_shift_closed_by` and `20261028171000_pharmacy_settings_timezone`) the four of phase 4 (listed under Phase 4 above) and the three of phase 5 (`20261030100000_pharmacy_intake`: the intake tables `PhIntakeBatch`, `PhIntakeFile`, `PhIntakeRow`, `PhAiUsageMonth`, `PhAiCall`; `20261030110000_pharmacy_intake_fixes`: the reservation table, the extraction lease and a receipt/branch key; `20261030120000_pharmacy_intake_row_match`: match state, acknowledgement and version columns), all additive (new tables, columns with defaults, indexes, a trigger; nothing existing is changed):

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
`git diff --name-only main..HEAD -- prisma/migrations`; the pharmacy ones are the other twenty-eight folders). They run on
production in the same `migrate deploy`, so they need the same dry run.

Locks: the new foreign keys take `SHARE ROW EXCLUSIVE` locks on `Restaurant`, `Branch` and `PhProduct` while they
are added, which blocks writes to those tables (not reads) for the duration, and **no `lock_timeout` is set** in any
of the migrations. The old five-column batch unique index (business, product, lot, expiry, supplier) is now redundant
next to the four-column one and can be dropped in a later migration; it is left in place.

Merging **runs these on production**, and that is still blocked: the owner's Neon preview branch for the dry run
is not available yet, so none of the twenty-eight has been run against Neon.

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
- **Phase 4 owner list:** see the rulings table in section 16 of the spec: R4-4a (a void frees the supplier's number), R4-4b (only confirmed receipts of a supplier record can be invoiced), R4-7a (a supplier return needs `stock.adjust`), R4-9a (money actions need `report.view`; STOCK may enter invoices but not pay), R4-12a (branch redaction on invoices), R4-13a (the order suggestion's wording), a credit note on an invoice once, and no un-apply. Known gaps: cursor-plus-skip paging (the cursor row is looked up inside the list's own filter) exists in 9 older lists of phases 1 to 3 (counts, prices, products, receipts, returns, sales, shifts, and two in stock reads); the receipts, counts and shifts lists filter on status, so a row whose status changes between pages can drop out of the next page. Of the phase 4 lists only invoices, purchase orders, credit notes and the payables reads use a keyset; the payments, supplier returns and suppliers lists still use cursor-plus-skip. ar and ckb strings are machine drafts.
- **Open items from the whole-phase review (not fixed):** (M-3) the supplier statement and the payables reads take several reads that are not one snapshot, so a concurrent write between them can show a false non-zero invariant difference for a moment; reading again clears it. (M-7) the older receipt confirm takes row locks on lots in an order that can differ between two branches receiving the same lot, so two such confirms can deadlock; Postgres ends one with a deadlock error and a retry succeeds.
- **Phase 5 owner list:** see the rulings table in section 16 of the spec and `docs/pharmacy/intake-uat.md` (D1 to D6): month-first dates, Arabic and Kurdish search under the Neon locale, image barcode decoding, who may edit (STOCK and ACCOUNTANT approve but do not edit), discounts and tax outside the receipt cost, native review of ar and ckb. Known gaps: scheduling of the purge and expiry scripts and the bucket lifecycle rule; no restore of a removed line; the approval's request key lives in `PhIntakeBatch.header.approval` (JSON, no index); real-invoice figures (quality limits, token bounds) are synthetic until UAT. Before launch: the private bucket, its `PH_INTAKE_R2_*` variables, `AI_PRICE_*` and the plan budget.
- **Support revoke screen:** it must ship with the grant screen or before it. A grant without a visible revoke
  button is worse than no grant screen.
- **Typo-tolerant search, scheduled-price cancellation, price caps:** see "What is NOT built".
