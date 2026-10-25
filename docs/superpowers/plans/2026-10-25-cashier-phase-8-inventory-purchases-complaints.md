# Cashier phase 8: inventory, suppliers, purchases, cost report and complaints (inside Core)

> Steps use checkbox syntax. Executed inline, TDD per task.

**Goal:** Port cashier plans 8 (inventory, suppliers, purchase invoices, recipes, honest cost report) and 9 (complaints box) into Core as till features behind the already-reserved permissions `inventory.view`, `inventory.manage`, `purchase.manage`, `complaint.view`, `complaint.manage`.

**Behaviour source:** `buzzify-restaurant/docs/superpowers/plans/2026-10-24-cashier-8-inventory-suppliers.md` and `...-9-complaints.md` (rulings kept unless changed below). **Pattern source:** phase 7 plan and code.

## Core-specific rulings (what changes in the port)

1. **Names.** All tables are `Pos*` and carry `restaurantId` (listed in `RESTAURANT_SCOPED_MODELS`): `PosInventoryItem`, `PosSupplier`, `PosPurchaseInvoice`, `PosPurchaseLine`, `PosStockCount`, `PosStockMovement`, `PosRecipeLine`, `PosComplaint`, `PosComplaintNote`. One migration `20261026100000_pos_inventory_complaints` (after phase 7's `20261025200000`).
2. **Layers.** Pure domain in `src/server/domain/pos/stock.ts` (units, `costOf`, `nameKey`) and `complaint-rules.ts`; services in `src/server/pos/{inventory,suppliers,purchases,recipes,complaints,complaints-guest,range-report}.ts` taking `(db, restaurantId, …)`; actions/queries in `src/server/studio/{actions,queries}/pos-inventory.ts` and `pos-complaints.ts` with `permission: null, pos: '<perm>', target: () => ({kind:'pos'})`, audit through `ctx.audit` inside `ctx.transaction`.
3. **Ledger.** Append-only `PosStockMovement`; `PosInventoryItem.onHand` changes only with a movement, by the same delta (single writer `applyMovement` in `inventory.ts`). Stock may go negative (flagged "count needed", never refused). A count is conflict-checked (`updateMany where onHand = observed`, else refusal `Stock changed while you counted`).
4. **Units and integers.** `StockUnit GRAM|MILLILITER|PIECE`, quantities `Int` in the smallest unit, money integer IQD; the parser accepts Arabic-Indic digits and `. ٫ ,` as decimal mark, refuses thousands separators and excess decimals; no `parseFloat`.
5. **Purchases.** Posted on save (no drafts); lines immutable; wrong invoice is voided (`PURCHASE_VOID`); `clientKey` unique per restaurant plus unique `(restaurantId, supplierId, number)`; paid/unpaid is a record only (never touches a shift). Last cost = latest non-voided line, kept as two ints, frozen on each `SALE`/`WASTE` movement.
6. **Recipes and sales.** Optional per product (`PosRecipeLine`, plain-valid `productId` with relation to `Product`). `payOrderIn` (shared by the online action and the offline `payCash` replay, so exactly-once is inherited) calls `consumeForPayment` right after the payment row is created: one `SALE` movement per (line, ingredient), `costTotal` frozen (null when unknown). A refund does not return stock. **No `OP_KINDS` change**: every new action is online only.
7. **Permissions.** Matrix already pins them (CASHIER holds `inventory.view`, no costs). Costs and the range report need `report.view` (inventory) / `purchase.manage`.
8. **Cost report** (`pos.rangeReport`, `report.view`): ≤92 Baghdad days; per-day gross/refunds/net by *payment date* (stated on the page), purchases by invoice day, waste cost, coverage panel (known/unknown/no-recipe lines), margin only on lines with every ingredient costed. Never one margin for the period unless coverage is complete; unknown cost is `null`, never 0.
9. **Complaints.** Opt-in: `PosSettings.complaintsEnabled` (default false, `settings.manage`). Public side is the Menu's own host route, like QR ordering: `POST /api/[tenant]/complaint` (strict zod, per-IP limit via `handleTenantRequest`, DB-counted limits per table/hour/restaurant, honeypot, `clientKey` idempotency) and the public page `/{tenant}/{locale}/complaint?table=N`. Gate = live cashier subscription + `complaintsEnabled` + `catalogMenuId === tenant.id` + table exists. Links are resolved by the server (table id, number, live order id when one exists); the body carries no ids. Contact name/phone only on `PosComplaint`, removable, never in audit rows. Notes append-only. Statuses NEW→IN_PROGRESS→RESOLVED (+reopen) conflict-checked. List rows never carry contact. Badge count in the till nav. **Dropped from the old plan:** receipt QR / `receiptToken` (descoped: table QR only; cost: one more column and route later).
10. **Menu-only restaurants run no cashier code.** The public complaint route reads the subscription first and touches no till table otherwise.
11. **Audit names** (3-language labels): `pos.inventory.item.create|update`, `pos.stock.adjust|waste|count|consume`, `pos.supplier.create|update`, `pos.purchase.create|void|paid`, `pos.recipe.set`, `pos.complaints.setting`, `pos.complaint.submit|status|note|contact.remove`.

## Constraints

Own DB port (`BUZZIFY_DB_PORT` ≠ 54329/54397); no push/PR/merge/production; ar/ckb/en trees identical; RTL logical CSS; 48px targets; user text `dir="auto"`, numbers LTR; every new action/query in the `TILL` list of `tests/studio/cross-tenant.test.ts`; refusal sentences in `POS_TEXT`; LF endings; trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Tasks

1. **Schema/registries**: models, enums, migration, tenant registry, `tests/helpers/db.ts` reset, audit actions, nav keys `inventory`, `purchases`, `complaints`; schema tests.
2. **Stock domain** (`stock.ts`) tests-first.
3. **Inventory service** (items, ledger, adjust, waste, count, low stock) + actions/queries.
4. **Suppliers + purchases** service + actions/queries.
5. **Recipes + consumption in `payOrderIn`**; sync replay test.
6. **Range/cost report** service + query.
7. **Complaints**: guest service + route, staff service + actions/queries, settings switch, badge.
8. **Screens** `/pos/inventory`, `/pos/purchases`, `/pos/recipes`, `/pos/complaints`, report range page, public complaint page; messages ar/ckb/en.
9. Cross-tenant TILL list, isolation, full vitest/tsc/eslint, browser check (ar, ckb, en, 375px), independent review + fixes, CRLF check, commit.

## Review focus

Negative stock and count races; double invoice save; offline replay of a recipe sale decrementing once; unknown costs never shown as 0; complaint flood/honeypot/duplicate key; phone number never in audit/list payload; cashier cannot reach purchase/complaint/cost data; cross-tenant.
