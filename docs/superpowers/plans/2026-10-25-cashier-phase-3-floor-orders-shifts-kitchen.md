# Cashier phase 3: tables, orders, cash, shifts, kitchen, daily report (inside Core)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A cashier of a restaurant that has the Cashier subscription opens a shift, takes a dine-in order at a table (options, notes, discounts, service and tax), sends it to the kitchen, the cook marks it ready, the cashier takes cash, closes the shift, and the daily report matches — all inside this app, on `Pos*` tables.

**Architecture:** The behaviour is ported from `buzzify-restaurant` (cashier plans 1, 1-b, 2, 3; frozen reference). Pure money, order-state, table-state and cash-drawer functions move first (no database). Every service becomes a Studio-framework action or query with a `pos` permission and the `{ kind: 'pos' }` target (`{ kind: 'pos', catalog: true }` when it reads products), written as small functions over a scoped transaction in `src/server/pos/*` plus thin definitions in `src/server/studio/actions/pos.ts` / `queries/pos.ts`. Products come only from the restaurant's catalog menu (`loadTillCatalog`). Screens live under `src/app/pos/(till)`; texts live in `src/studio/messages/pos-till/{en,ar,ckb}.ts`.

**Tech Stack:** Next 16, React 19, Prisma 7 (Postgres), Zod 4, Vitest 5, the Studio framework (`defineAction`, `defineQuery`, `scopedClient`).

**Spec:** `docs/superpowers/specs/2026-10-24-single-core-backend.md` (one app, one database); the behaviour: `C:\Users\pc\Documents\GitHub\buzzify-restaurant\docs\superpowers\specs\2026-10-23-cashier-design.md` and its plans `2026-10-23-cashier-{1-foundation,1b-setup,2-shifts,3-kitchen}.md`; the order of work: `docs/superpowers/plans/2026-10-24-cashier-unified-plan.md` (phase 3).

## Rulings (the open decisions of section 6 of the unified plan, taken at the owner's recommended defaults)

1. **Draft rows at the till: keep.** The till reads the catalog menu's draft rows (`loadTillCatalog`); no publish is needed. A cashier-only restaurant has no published menu.
2. **Promotions and bundles: not at the till in v1.** Price = `basePrice` + chosen variant `priceDelta` + chosen option `priceDelta`.
3. **QR:** one QR per table opening the Menu's `/t/<n>` page (phase 4). So `PosTable.number` *is* the Menu's table number; no second numbering.
4. **Staff:** email-and-password accounts, PIN for shared tablets in phase 7 (already modelled on `PosStaff`).
5. **Freeze:** `buzzify-restaurant` is not edited by this phase.
6. **Product editor limit:** names, price, category, availability and kitchen section at the till; sizes, options and photos in the Studio (phase 2).
7. **AI package:** stays phase 9.

Rulings of this phase (made here, each with its cost if wrong):

8. **A person, not a staff row, owns a shift and a payment** (`userId`, not `PosStaff.id`): a restaurant's Studio OWNER is the cashier OWNER without a staff row, so a staff foreign key could not hold them. Cost if wrong: a join to `User` for names.
9. **Line names are frozen in the menu's default language** (falling back to any language), with the chosen variant and options as `{ id, name, priceDelta }` in `optionsSnapshot` (the variant first). A required rule is the group's `minSelect`/`maxSelect`; a product with variants needs exactly one (its default if none is named). Cost if wrong: receipts show the menu's default language, not the viewer's.
10. **Cash only in this phase.** `PosPayment.method` keeps all four values; `payOrder` accepts `CASH` only (terminal methods and refunds are phase 7). Cost if wrong: none (phase 7 widens one enum check).
11. **Lapsed subscription:** the whole till is closed (phase 1 gate) *except* closing and reading an open shift and the shift/daily report, so a shift can always be counted. New shifts, orders and payments are refused. Cost if wrong: a cashier mid-service sees the closed page; the owner extends the subscription.
12. **Takeaway/delivery columns and customer orders are not in this phase's tables**; `PosOrder.kind` exists (`DINE_IN` only is opened) so phase 5 adds columns, not a rewrite. Offline `operationId` is phase 6: services take plain arguments, so an idempotency key is added at the action layer later.
13. **Money everywhere is integer IQD** (`Number.isSafeInteger`, Postgres `Int`); the board and report read `totalsSnapshot` of payments, never recomputed from current rates.

## Global Constraints

- No push, deploy or migration on production or on the shared database (54329). Private database: `BUZZIFY_DB_PORT=54371`. The migration is applied to the private database only.
- `ar`, `ckb`, `en` message trees identical (`tests/studio/messages.test.ts`); RTL logical CSS (`ms-/me-/ps-/pe-/start-/end-`, never `left/right`); touch targets at least 48px at the till; Latin digits (0-9) for numbers in every language, comma thousands.
- A menu-only restaurant runs no cashier code: no `Pos*` query on public pages, the quote route or the Studio overview (`tests/pos/isolation.test.ts` grows).
- Every new table carries `restaurantId`, is in `RESTAURANT_SCOPED_MODELS`, and every new definition is listed in the TILL table of `tests/studio/cross-tenant.test.ts`.
- Commit only own files; trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; commit per task on branch `claude/kind-mahavira-89df94`.
- Server refusals are English `StudioError` messages that must also exist in `SERVER_TEXT` (`src/studio/errors.ts`) with the three-language message.

## Review Focus

1. A payment taken twice (double tap): one payment, the second answers a conflict (`PosPayment.orderId` unique + version guard) — Task 6.
2. An order paid while the subscription lapses: the open shift can be closed and reported, new shifts cannot open — Task 5 and Task 10.
3. A 200-table floor and a 1,000-product catalog: the board reads a constant number of queries; the order screen does not load 1,000 products per keystroke — Task 7.
4. A cashier of restaurant A and a designer of restaurant B: no leak either way; a KITCHEN member tied to one section sees only that section — Tasks 3, 8, 11.
5. An empty order, a comped order (total 0), an order whose rates changed between the screen and the tap (`TOTAL_CHANGED`), a cancelled order's table freed, cash short of the total — Tasks 4 and 6.

---

## File structure

| File | Responsibility |
|---|---|
| `prisma/schema.prisma`, migration `…_pos_floor_orders` | enums + `PosArea`, `PosTable`, `PosOrder`, `PosOrderLine`, `PosPayment`, `PosShift`, `PosCashExpense`; raw-SQL partial unique indexes |
| `src/server/domain/pos/{totals,order-state,table-status,cash-drawer,cash}.ts`, `src/lib/baghdad.ts`, `src/lib/pos-format.ts` | pure functions, ported with their tests |
| `src/server/pos/floor.ts` | areas and tables: create, rename, delete (guarded), move; `readFloor` |
| `src/server/pos/orders.ts` | order lifecycle services over a scoped tx; `loadOrderView` (order + lines + totals) |
| `src/server/pos/order-lines.ts` | `chooseForLine` (variant + options validation from the catalog), line add/update/cancel |
| `src/server/pos/payments.ts` | `payOrderIn` (cash), `readReceipt` |
| `src/server/pos/shifts.ts` | open, close, expense, summary, list; `lockOpenShiftOf` |
| `src/server/pos/board.ts` | `readBoard` (tables with status, total, seatedAt; today's sales) |
| `src/server/pos/kitchen.ts` | send, queue, ready, acknowledge, ticket, scope |
| `src/server/pos/report.ts` | `readDailyReport` |
| `src/server/pos/errors.ts` | the till's refusal texts (one table) and `refuse(code,text)` helper |
| `src/server/studio/actions/pos.ts`, `queries/pos.ts`, `src/app/studio/_actions/pos.ts` | definitions (extended) and Server Action wrappers |
| `src/server/studio/framework/access.ts` | `allowLapsed` flag on pos definitions (Task 10) |
| `src/app/pos/(till)/**`, `src/ui/pos/**` | screens and components |
| `src/studio/messages/pos-till/{en,ar,ckb}.ts`, `src/studio/errors.ts` | texts |
| `tests/pos/*.test.ts` | one file per service + `phase3-exit.test.ts` |

## Task 1: Schema, migration, tenant registry

**Files:** Modify `prisma/schema.prisma`, `src/server/data/tenant-db.ts`; Create `prisma/migrations/<ts>_pos_floor_orders/migration.sql`; Test `tests/pos/schema.test.ts` (extend), `tests/data/tenant-registry.test.ts` (already generic).

**Interfaces — Produces:** Prisma models (all with `restaurantId`, relation `onDelete: Cascade` from `Restaurant`):
- `enum PosOrderStatus { PENDING_APPROVAL OPEN READY BILL_REQUESTED PAID CANCELLED REJECTED }`, `enum PosOrderKind { DINE_IN TAKEAWAY DELIVERY }`, `enum PosDiscountKind { AMOUNT PERCENT }`.
- `PosArea(id, restaurantId, name, sortOrder)`; `PosTable(id, restaurantId, areaId→PosArea cascade, number, @@unique([restaurantId, number]))`.
- `PosOrder(id, restaurantId, tableId? →PosTable SetNull, number, kind=DINE_IN, status=OPEN, seatedAt, invoiceDiscountKind?, invoiceDiscountValue?, version=1, createdAt, updatedAt, @@unique([restaurantId, number]))`.
- `PosOrderLine(id, restaurantId, orderId→cascade, productId? →Product SetNull, nameSnapshot, unitPriceSnapshot, quantity=1, note="", optionsSnapshot Json=[], discountKind?, discountValue?, cancelledAt?, cancelReason?, sectionId?, sectionNameSnapshot="", sentAt?, batch?, readyAt?, cancelAckAt?, createdAt)`.
- `PosPayment(id, restaurantId, orderId @unique, method PosPaymentMethod, amountReceived, reference?, totalsSnapshot Json, userId?→User SetNull, shiftId?→PosShift SetNull, paidAt)`.
- `PosShift(id, restaurantId, userId→User NoAction, openedAt, openingFloat, closedAt?, closedByUserId? (plain id), countedCash?, expectedCashAtClose?, difference?, note="")`; `PosCashExpense(id, restaurantId, shiftId→cascade, userId→User NoAction, amount, reason, createdAt)`.
- Raw SQL in the migration: `CREATE UNIQUE INDEX "PosOrder_one_live_per_table" ON "PosOrder"("tableId") WHERE "tableId" IS NOT NULL AND "status" NOT IN ('PAID','CANCELLED','REJECTED')` and `CREATE UNIQUE INDEX "PosShift_one_open_per_user" ON "PosShift"("restaurantId","userId") WHERE "closedAt" IS NULL`.

- [ ] **Step 1: Failing test** in `tests/pos/schema.test.ts`: creating two live orders on one table raises a unique violation (`P2002`); a PAID order and a new OPEN one on the same table is allowed; two open shifts of one user in one restaurant raise `P2002`, a closed one plus an open one does not; a second payment on one order raises `P2002`; the models appear in `RESTAURANT_SCOPED_MODELS`.
- [ ] **Step 2: Run** `BUZZIFY_DB_PORT=54371 npx vitest run tests/pos/schema.test.ts tests/data/tenant-registry.test.ts` → FAIL (models missing).
- [ ] **Step 3: Add the models; add the seven names to `RESTAURANT_SCOPED_MODELS`; run `npx prisma migrate dev --name pos_floor_orders --create-only` against the private database, append the two raw indexes, apply with `npx prisma migrate deploy` (private DB only), `npx prisma generate`.**
- [ ] **Step 4: Run both test files → PASS.**
- [ ] **Step 5: Commit** `feat(pos): tables, orders, payments and shifts schema`.

## Task 2: Pure domain, time and number helpers

**Files:** Create `src/server/domain/pos/{totals,order-state,table-status,cash-drawer,cash}.ts`, `src/lib/baghdad.ts`, `src/lib/pos-format.ts`; Test `tests/pos/domain/*.test.ts` — the cashier's `tests/domain/{money,order-state,table-status,cash-drawer}.test.ts` moved with imports changed.

**Interfaces — Produces** (signatures unchanged from the cashier): `computeTotals(lines: PricedLine[], invoiceDiscount: Discount|undefined, rates: Rates, deliveryFee=0): Totals`, `lineTotal`, `lineDiscount`, `cashChange(total, received): number|null`; `canTransition(from: OrderStatus, to: OrderStatus): boolean`; `tableStatus(order|null, {hasPendingRequest?}): TableStatus`, `ringProgress(seatedAt, now, maxMinutes)`; `expectedCash`, `cashDifference`; `quickCashAmounts(total, max=5)`, `parseAmount(text): number|null`, `differenceKind`, `OPENING_FLOAT_AMOUNTS`; `baghdadDayRange`, `baghdadDay`, `baghdadDayOf`, `baghdadClock`, `isCalendarDay`; `formatNumber`, `elapsedMinutes`, `elapsedLabel`, `ltr`.

- [ ] **Step 1: Move the four cashier domain tests, adapted to the new paths, plus these new assertions:** `parseAmount('٤٥٬٠٠٠') === 45000`, `parseAmount('1e5') === null`, `quickCashAmounts(10395)` starts `[10395, 11000, 15000, 20000, 25000]`, `computeTotals` of a comped order (100% line discount) is `total 0`, `baghdadDayOf(new Date('2026-10-24T21:30:00Z')) === '2026-10-25'`.
- [ ] **Step 2: Run → FAIL. Step 3: copy the files (the cashier's `money.ts` becomes `totals.ts` because `domain/money.ts` exists). Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `feat(pos): the cashier's pure money, order-state, table and cash-drawer rules`.

## Task 3: Floor (areas and tables)

**Files:** Create `src/server/pos/floor.ts`, `src/server/pos/errors.ts`; Modify `actions/pos.ts`, `queries/pos.ts`, `_actions/pos.ts`, `src/studio/errors.ts`; Test `tests/pos/floor.test.ts`.

**Interfaces — Produces:**
- `createAreaIn(tx, name): Promise<{id}>`, `renameAreaIn(tx, areaId, name)`, `deleteAreaIn(tx, areaId)` and `deleteTableIn(tx, tableId)` (refused `CONFLICT` "A table has an open order" while a live order exists), `createTablesIn(tx, {areaId, from, to}): Promise<{count}>` (all-or-nothing, max 200 per call, numbers unique per restaurant → `CONFLICT` "Table numbers already in use"), `moveTableToAreaIn(tx, tableId, areaId)`.
- Actions (`pos: 'settings.manage'`, `TILL` target): `pos.createArea`, `pos.renameArea`, `pos.deleteArea`, `pos.createTables`, `pos.deleteTable`, `pos.moveTable`. Query `pos.floor` (`pos: 'order.handle'` — and settings.manage reads the same; a definition names one permission, so the query is named for `order.handle` and the setup page uses `pos.floorSetup` with `settings.manage`): returns `{ areas: [{id,name,sortOrder,tables:[{id,number}]}] }`.
- `refuse(code, text)` in `errors.ts` throws `StudioError`; `POS_TEXT` is the table of this phase's English texts that `SERVER_TEXT` spreads.

- [ ] **Step 1: Failing tests** (`tests/pos/floor.test.ts`): manager creates area + tables 1..20 (OK, audit rows `pos.area.create`, `pos.tables.create`); numbers 15..25 afterwards → `CONFLICT` and nothing created; a CASHIER gets `FORBIDDEN` on every floor action; another restaurant's area id → `NOT_FOUND` (cross-tenant); deleting a table with a live order → `CONFLICT`, after the order is cancelled → OK; 201 tables in one call → `INVALID`; `pos.floor` for restaurant A never lists B's tables.
- [ ] **Step 2: Run → FAIL. Step 3: Implement the services and definitions** (locks as in the cashier's `lockArea`/`lockTables` are needed only for the delete-vs-open race: do the delete as `deleteMany({ where: { id, orders: { none: live } } })`, check count). **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `feat(pos): the floor — areas and tables`.

## Task 4: Orders and lines

**Files:** Create `src/server/pos/orders.ts`, `src/server/pos/order-lines.ts`; Modify definitions; Test `tests/pos/orders.test.ts`, `tests/pos/order-lines.test.ts`.

**Interfaces — Produces:**
- `openOrderIn(tx, tableId): Promise<{orderId, number, version}>` (table must exist and be free → `CONFLICT` "The table already has an open order"; number = max+1; retries 3× on `P2002`).
- `chooseForLine(product, variantId|undefined, optionIds): OptionSnapshot[]` pure: product shape from `tx.product` with `variants` and `groups.options`; enforces Ruling 9; `OptionSnapshot = { id, name, priceDelta }`.
- `addLineIn(tx, {orderId, productId, quantity 1..999, note ≤300, variantId?, optionIds[], expectedVersion})` → `{lineId, version}`: product must be in the target's catalog menu (the `catalog: true` client), `isAvailable` and not sold out at the till (else `CONFLICT` "This product is not available"), bumps the order version, reopens a READY/BILL_REQUESTED order to OPEN.
- `updateLineIn` (quantity/note only while unsent, else `CONFLICT` "The line was sent to the kitchen and can no longer change"; discount needs `order.discount`; amount discount larger than the line → `INVALID`), `cancelLineIn` (reason required, `order.cancel`), `setInvoiceDiscountIn` (`order.discount`), `requestBillIn`, `cancelOrderIn` (reason required if live lines, frees the table), `moveToTableIn` (`CONFLICT` if target occupied).
- `bumpOrder(tx, restaurantId, orderId, expected, data)`: `updateMany` guarded by `version` and `status notIn locked`; zero rows → `CONFLICT` "The order was changed by someone else. Reload it and try again." (stale) or "The order is {status} and can no longer change" (locked) or `NOT_FOUND`.
- `loadOrderView(tx, orderId): Promise<OrderView>` = `{ order, lines (with parsed options), totals, rates }` priced by `computeTotals` with the restaurant's `PosSettings` rates (service charge applies to `DINE_IN` only).
- Actions: `pos.openOrder`, `pos.addLine`, `pos.updateLine`, `pos.cancelLine`, `pos.setInvoiceDiscount`, `pos.requestBill`, `pos.cancelOrder`, `pos.moveOrderToTable` (permissions as the cashier's: `order.handle`, `order.discount`, `order.cancel`), all `CATALOG` target when they read products, else `TILL`; query `pos.order` (`order.handle`).

- [ ] **Step 1: Failing tests** — port the cashier's `tests/services/orders.test.ts` and `order-actions.test.ts` cases to the framework: open → add line with a variant and two options prices `(base+delta+options)×qty`; a required group left empty → `INVALID`; stale `expectedVersion` → `CONFLICT` and the line is not added; discount (line AMOUNT larger than line → `INVALID`; invoice PERCENT 10 with service 10 and tax 5 → exact IQD totals equal to `computeTotals`); cancel line without reason → `INVALID`; cancel order with lines and no reason → `INVALID`, empty order cancel without reason → OK, table free again; two concurrent `openOrder` on one table → exactly one OK; a product from another restaurant's menu → `NOT_FOUND`; a KITCHEN member → `FORBIDDEN`; sold-out override → `CONFLICT`; `isHidden` product (hidden from guests) is sellable (Ruling: till shows every non-archived product).
- [ ] **Step 2: Run → FAIL. Step 3: Implement. Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `feat(pos): orders and lines with options, notes and discounts`.

## Task 5: Shifts and the cash drawer

**Files:** Create `src/server/pos/shifts.ts`; Modify definitions/queries; Test `tests/pos/shifts.test.ts`.

**Interfaces — Produces:**
- `openShiftIn(tx, {userId, openingFloat})` → `{shiftId}`; `CONFLICT` "You already have an open shift" (also on the unique index race); refuses a deactivated staff row.
- `lockOpenShiftOf(tx, userId): Promise<string>` (row-locks via `updateMany` no-op, `CONFLICT` "Open a shift before taking payments" when none).
- `addExpenseIn(tx, {shiftId, amount 1..INT32, reason ≤200, actor})`, `closeShiftIn(tx, {shiftId, countedCash, note?, actor})` → freezes `expectedCashAtClose` (`expectedCash` of opening float + cash payment totals from snapshots − expenses) and `difference`; a cashier closes/adds to only their own shift, OWNER/MANAGER any (`FORBIDDEN` otherwise); a closed shift → `CONFLICT` "The shift is closed".
- `readShiftSummary(db, restaurantId, shiftId)` → `{ shift, cashierName, closedByName|null, cashSales, expenses, expensesTotal, expectedCash, openOrdersCount }`; `listOpenShifts(db, restaurantId)`.
- Actions `pos.openShift` (`shift.use`), `pos.addExpense` (`shift.use`), `pos.closeShift` (`shift.use`, `allowLapsed`); queries `pos.myShift` (`shift.use`), `pos.shift` (`shift.use`, `allowLapsed`), `pos.openShifts` (`report.view`, `allowLapsed`).

- [ ] **Step 1: Failing tests** (port `tests/services/shifts.test.ts`): open with float 50,000; second open → `CONFLICT`; owner via membership (no staff row) opens one; expense then close with count short by 2,000 → `difference -2000`, frozen; add expense to a closed shift → `CONFLICT`; a CASHIER closing another's shift → `FORBIDDEN`, a MANAGER may; a deactivated staff cannot open; payment totals feed `expectedCash` (after Task 6; here with an inserted `PosPayment` row); a lapsed subscription: `pos.openShift` → `FORBIDDEN`, `pos.closeShift` and `pos.shift` → OK (needs Task 10's flag; this test is added in Task 10).
- [ ] **Step 2: Run → FAIL. Step 3: Implement. Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `feat(pos): shifts, cash expenses and the drawer count`.

## Task 6: Cash payment and receipt

**Files:** Create `src/server/pos/payments.ts`; Test `tests/pos/payments.test.ts`.

**Interfaces — Produces:**
- `payOrderIn(tx, {orderId, expectedVersion, expectedTotal, amountReceived, reference?, actor})` → `{ paymentId, change, total }`: order must be payable (`canTransition(status,'PAID')`), the actor needs an open shift (`lockOpenShiftOf`), method `CASH` only, `amountReceived ≥ total` (else `INVALID` on field `amountReceived`), `expectedTotal` equals the total computed now (else `CONFLICT` "The total changed. Check the bill and try again."), an order with no live lines → `CONFLICT` "Cannot pay an empty order"; writes `PosPayment` with a `totalsSnapshot` (subtotal, invoiceDiscount, service, tax, deliveryFee 0, total, invoiceDiscountInput, rates, lines[]) and sets PAID with a version bump in the same transaction; audit `pos.payment.take`.
- `totalsSnapshotSchema`/`parseTotalsSnapshot` in `src/server/pos/totals-snapshot.ts` (ported).
- `readReceipt(db, restaurantId, orderId)` → payment + parsed snapshot + order number + table + cashier name.
- Action `pos.payOrder` (`payment.take`, `TILL`), query `pos.receipt` (`order.handle`).

- [ ] **Step 1: Failing tests** (port `tests/services/payments.test.ts`, cash cases): exact cash → change 0; 50,000 for 41,250 → change 8,750 and the snapshot is stored; short cash → `INVALID`; no shift → `CONFLICT`; **double tap: two `payOrder` calls with the same version → exactly one `PosPayment`, the other `CONFLICT`**; change of rates after payment does not alter the stored snapshot or the receipt; comped total 0 pays with received 0; terminal method value → `INVALID`; paying a CANCELLED order → `CONFLICT`; a line added after the screen loaded → stale `CONFLICT`; a KITCHEN member → `FORBIDDEN`.
- [ ] **Step 2: Run → FAIL. Step 3: Implement. Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `feat(pos): cash payment, frozen totals and the receipt`.

## Task 7: Tables board

**Files:** Create `src/server/pos/board.ts`; Modify queries; Test `tests/pos/board.test.ts`.

**Interfaces — Produces:** `readBoard(db, restaurantId, {areaId?, now?})` → `{ areas:[{id,name,tableCount,busyCount}], tables:[{id,number,areaId,status,seatedAt,total,orderId}], busyCount, todaySales, ringMinutes, readAt }` in a fixed number of queries (areas, tables, live orders, their lines, settings, today's payments); query `pos.board` (`order.handle`).

- [ ] **Step 1: Failing tests** (port `tests/services/board.test.ts`): free/busy/ready/bill-requested states from order status; total equals the order screen's total; `todaySales` uses the Baghdad day (a payment at 23:30 UTC the previous day counts for today); area filter keeps header counts; **200 tables + 150 live orders return correct data and the query count is constant** (count Prisma queries through a `$on('query')`-style counter or `$extends`; assert ≤ 8); another restaurant's tables never appear.
- [ ] **Step 2: Run → FAIL. Step 3: Implement. Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `feat(pos): the tables board`.

## Task 8: Kitchen

**Files:** Create `src/server/pos/kitchen.ts`; Modify definitions; Test `tests/pos/kitchen.test.ts`.

**Interfaces — Produces:**
- `sendToKitchenIn(tx, {orderId, expectedVersion})` → `{batch, lineCount, version}` (needs a kitchen mode on in `PosSettings`, else `CONFLICT` "Kitchen mode is off"; nothing unsent → `CONFLICT` "Nothing new to send to the kitchen"; READY order returns to OPEN).
- `readKitchenQueue(db, {restaurantId, userId, role, sectionId?})` → cards (one per order/round/section, oldest first; cancelled-and-unacknowledged lines listed in `cancelled`; 12-hour window; max 200 lines; no prices); a KITCHEN member tied to a section sees only it whatever is asked.
- `markLinesReadyIn(tx, {lineIds, actor})` → `{ready}` (idempotent; the order becomes READY when `kitchenDone`; PAID orders' lines still markable; cancelled skipped), `acknowledgeCancellationsIn`, `readKitchenTicket(db, {orderId, batch?, …})`, `readKitchenScope(db, …)`.
- Actions `pos.sendToKitchen` (`order.handle`), `pos.markReady` (`kitchen.view`), `pos.acknowledgeCancellations` (`kitchen.view`); queries `pos.kitchenQueue`, `pos.kitchenTicket` (`kitchen.view`; the ticket also by `order.handle` through a second definition `pos.orderKitchenTicket`).
- Cancelled sent line becomes a notice; `settleStatus` after a line cancel makes a fully-cooked order READY.

- [ ] **Step 1: Failing tests** (port `tests/services/kitchen.test.ts` and `kitchen-actions.test.ts`): send round 1 then add a line and send round 2 (`batch` 1 then 2); kitchen off → `CONFLICT`; mark ready twice → second is a no-op and writes no audit; last ready line flips the order to READY and the board shows READY; adding a line to a READY order reopens it to OPEN; cancel a sent line → appears as a notice on the queue until acknowledged, then leaves; a section-bound KITCHEN member cannot mark another section's line (`FORBIDDEN`); order of restaurant B's line id → `NOT_FOUND`; ticket groups lines by section with cancel slips; a line hidden beyond 12 hours is not in the queue but is on the ticket.
- [ ] **Step 2: Run → FAIL. Step 3: Implement. Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `feat(pos): the kitchen — send, ready, cancellation notice, ticket`.

## Task 9: Daily report

**Files:** Create `src/server/pos/report.ts`; Modify queries; Test `tests/pos/report.test.ts`.

**Interfaces — Produces:** `readDailyReport(db, restaurantId, {day: 'YYYY-MM-DD', now?})` → `{ day, shifts: ShiftReport[], totals, unassigned, outsideShifts }` where `ShiftReport = { shift, cashierName, closedByName, salesByMethod, grossSales, discountsTotal, netSales, cancelledOrders, cancelledLines, cancelReasons, expenses, expectedCash, countedCash, difference }`; shifts opened on that Baghdad day; cancellations counted per shift window from the audit log (`pos.order.cancel`, `pos.order.line.cancel`), the rest as `outsideShifts`. Refund and delivery-fee fields are added by phases 5 and 7 (no placeholders). Query `pos.dailyReport` (`report.view`, `allowLapsed`), also `pos.shiftReport` (one shift, `report.view`).

- [ ] **Step 1: Failing tests** (port `tests/services/reports.test.ts`): two shifts one day (cash 30,000 + 12,000; one expense 2,000; counted exact) → per-shift and total gross/net, `discountsTotal` from snapshots (invoice + line discounts); a shift opened 23:00 Baghdad and closed after midnight stays in its opening day; cancels with and without reasons grouped; cancel by a manager with no open shift → `outsideShifts`; an invalid day string → `INVALID`; **the report numbers equal the shift summary numbers** (`pos.shift`); a cashier (no `report.view`) → `FORBIDDEN`.
- [ ] **Step 2: Run → FAIL. Step 3: Implement. Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `feat(pos): the daily report`.

## Task 10: Lapsed subscription — close and report only

**Files:** Modify `src/server/studio/framework/access.ts`, `action.ts`, `query.ts` (`allowLapsed?: true` beside `pos`); `src/app/pos/inactive/page.tsx`; Test `tests/pos/lapse.test.ts`, `tests/pos/enforcement.test.ts` (extend).

**Interfaces — Produces:** `allowLapsed: true` on a definition with `pos` skips the `cashierPlanInactive` refusal in `resolvePosAccess` (still refuses an inactive restaurant, a missing or deactivated person, and a role without the permission); `checkDefinition` rejects `allowLapsed` without `pos`. `/pos/inactive` lists the signed-in person's open shift (all open shifts for OWNER/MANAGER) with a count-and-close form when the reason is `cashierPlanInactive`.

- [ ] **Step 1: Failing tests:** with an `EXPIRED` subscription (past grace): `pos.openShift`, `pos.openOrder`, `pos.payOrder` → `FORBIDDEN`; `pos.closeShift`, `pos.shift`, `pos.dailyReport` → OK; with the restaurant `SUSPENDED`, even those → `FORBIDDEN`; a definition with `allowLapsed` and no `pos` throws at definition time; `tests/pos/enforcement.test.ts` lists which definitions carry the flag (exactly the three above plus `pos.openShifts`, `pos.shiftReport`).
- [ ] **Step 2: Run → FAIL. Step 3: Implement. Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `feat(pos): a lapsed subscription still lets a shift be counted and reported`.

## Task 11: Screens — shell, tables board, floor setup

**Files:** Modify `src/app/pos/(till)/layout.tsx` (nav: Tables, Shift, Kitchen, Report, Settings, Staff, Product list, Floor — each shown by `canPos`), `page.tsx` (landing = tables for cashier/manager); Create `src/app/pos/(till)/tables/page.tsx`, `src/ui/pos/TablesBoard.tsx`, `TableCircle.tsx` (time ring from `ringProgress`), `src/app/pos/(till)/floor/{page,FloorSetup}.tsx`; Create `src/studio/messages/pos-till/{en,ar,ckb}.ts` and spread them in the three message files; Test `tests/pos/nav.test.ts`, `tests/studio/messages.test.ts` (existing parity).

**Behaviour:** board refreshes every 10 s (`router.refresh()` while visible) and on focus; tapping a free table opens an order and goes to `/pos/orders/<id>`; tapping a busy table goes to its order; header shows busy count and today's sales; floor setup creates areas and ranges of tables. Every target ≥ 48px, logical CSS only, Latin digits via `formatNumber`.

- [ ] **Step 1: Failing tests:** nav lists exactly the items a role may open (CASHIER: Tables, Shift, Report not; KITCHEN: Kitchen only; MANAGER: all); message parity; a unit test of the board view-model (status → colour key, ring fraction).
- [ ] **Step 2: Run → FAIL. Step 3: Implement. Step 4: Run tests, `npx tsc --noEmit`, `npx eslint src tests`. → PASS.**
- [ ] **Step 5: Commit** `feat(pos): the till shell, the tables board and floor setup`.

## Task 12: Screens — order, payment, receipt

**Files:** Create `src/app/pos/(till)/orders/[id]/{page,OrderScreen}.tsx`, `receipt/page.tsx`; `src/ui/pos/{ProductPicker,LineDialogs,DiscountDialog,PaymentPanel,Receipt,Stepper,MoveTableDialog}.tsx`; Test `tests/pos/order-view.test.ts` (view-model: grouping, quick cash buttons, totals line text).

**Behaviour:** category tabs and a text filter over the already-loaded `TillCatalog` (one fetch per page; filtering is client-side over ≤ 1,000 products rendered as a windowed list of the active category only); a product with variants/required groups opens a sheet; lines show name, options, note, quantity stepper (unsent only), discount, cancel with reason; invoice discount; bill request; send to kitchen button when a kitchen mode is on; payment panel with quick cash buttons and change; stale/`TOTAL_CHANGED` refusals reload the order with a message; receipt page prints (`window.print()`, print stylesheet, 80 mm).

- [ ] **Step 1: Failing view-model tests. Step 2: Run → FAIL. Step 3: Implement. Step 4: Run + tsc + eslint → PASS.**
- [ ] **Step 5: Commit** `feat(pos): the order screen, payment and receipt`.

## Task 13: Screens — shift, kitchen, daily report

**Files:** Create `src/app/pos/(till)/shift/{page,ShiftScreen}.tsx`, `kitchen/{page,KitchenScreen,KitchenTicket}.tsx` (replacing the placeholder page), `orders/[id]/kitchen/page.tsx` (print), `report/{page,DailyReport}.tsx`; Modify `src/app/pos/inactive/page.tsx`; Test `tests/pos/kitchen-view.test.ts` (card ordering, ready state), `tests/pos/report-view.test.ts`.

**Behaviour:** shift page opens (float quick buttons 0/25,000/50,000/100,000), shows live totals, expense dialog, count-and-close with difference text (surplus/shortage/exact) and a printable slip; kitchen screen polls every 5 s, big tap targets to mark a line ready, cancellation notices with an acknowledge button, section filter for managers, sound optional (off); daily report by date with print.

- [ ] **Step 1: Failing view tests. Step 2: Run → FAIL. Step 3: Implement. Step 4: Run + tsc + eslint → PASS.**
- [ ] **Step 5: Commit** `feat(pos): shift, kitchen and daily report screens`.

## Task 14: Isolation, sweep, exit test, browser check

**Files:** Modify `tests/pos/isolation.test.ts`, `tests/studio/cross-tenant.test.ts` (TILL list); Create `tests/pos/phase3-exit.test.ts`; Create `docs/superpowers/notes/`-free: ledger lines go to the shared notes folder.

- [ ] **Step 1: Failing/extended tests:** (a) every new `pos.*` name is in the TILL table; (b) a menu-only restaurant: public menu page data, quote route and Studio overview issue no `pos*` query (spy on the Prisma client delegates `posOrder`, `posShift`, …); (c) **exit test** drives the actions as a CASHIER, a KITCHEN member and a MANAGER: open shift (float 50,000) → open order on table 3 → add 2 products (one with a variant and option, one with a note) → send to kitchen → cook marks ready (order READY) → pay cash → board shows table free and today's sales → add expense 2,000 → close shift with the exact count → daily report gross = paid total and expected cash = 50,000 + total − 2,000; (d) cross-tenant: A's cashier cannot read, pay or mark ready B's order, line, shift or table.
- [ ] **Step 2: Run → FAIL where missing. Step 3: Fill gaps. Step 4: `BUZZIFY_DB_PORT=54371 npx vitest run` full suite, `npx tsc --noEmit`, `npx eslint src tests scripts prisma` → all green.**
- [ ] **Step 5: Browser check** on the private dev server: sign in as manager, create area + tables, set kitchen screen on, sign in as cashier, shift → order → send → (kitchen user) ready → pay → close → report; in `ar`, `ckb` (RTL) and `en`; at 375px width; screenshots noted in the ledger.
- [ ] **Step 6: Final whole-branch review (`code-review`), one fix wave, commit** `test(pos): phase 3 exit check and isolation`.

## Self-review

- Spec coverage: floor/board (T3, T7, T11), manual orders with options and notes (T4, T12), discounts (T4), service/tax (T2, T4), cash payment (T6), shifts and drawer (T5, T13), daily report (T9, T13), kitchen send/ready/notice/print (T8, T13), lapse rule (T10), isolation and sweep (T14). Left out on purpose and recorded: per-line options as separate tables (Ruling 9), terminal payments and refunds (phase 7), takeaway/delivery (phase 5), offline (phase 6), customer orders (phase 4), receipt complaint QR and recipe consumption (phase 8).
- Names used across tasks: `bumpOrder`, `loadOrderView`, `lockOpenShiftOf`, `payOrderIn`, `readBoard`, `refuse` — each defined in the task that produces it before it is consumed (4 before 6 before 7; 5 before 6).
- Proportion: bodies are described by signatures and cases; the cashier's tests are the executable detail and are ported, not rewritten.
