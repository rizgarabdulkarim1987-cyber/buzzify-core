# Cashier phase 5: takeaway and delivery (inside Core)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Beside tables the cashier takes **takeaway** orders (a daily queue number, optional name and phone, open until ready, paid and picked up) and **delivery** orders (phone, address, zone with an integer IQD fee, a driver, flow NEW → PREPARING → READY → OUT → DELIVERED, or cancelled; cash on delivery settled into the receiving cashier's shift). Both show as tabs on the tables board, go through the existing kitchen path, and print a receipt (delivery also a driver slip).

**Architecture:** `PosOrder` (kind already has TAKEAWAY and DELIVERY) gains the off-premise columns, so open/add line/kitchen/pay/receipt/reports keep one path. `PosDeliveryZone` and `PosDriver` are small per-restaurant lists. The delivery fee already exists in `Totals` and the payment snapshot (phase 3 left `deliveryFee: 0` in place); this phase feeds it from the order. A pure state machine in `src/server/domain/pos/fulfillment.ts`; services in `src/server/pos/off-premise.ts` and `delivery-setup.ts`; Studio-framework actions/queries as in phases 3-4 (`pos:` permission, `{kind:'pos'}` target).

**Spec / source:** `docs/superpowers/plans/2026-10-24-cashier-unified-plan.md` (phase 5), the frozen cashier plan `buzzify-restaurant/docs/superpowers/plans/2026-10-24-cashier-5-takeaway-delivery.md`, and the real code of phases 3-4.

## Rulings

1. **Same order row.** TAKEAWAY/DELIVERY stay `PosOrder` with `tableId` null; the one-live-order-per-table index is untouched. Switches `PosSettings.takeawayEnabled|deliveryEnabled` already exist (default off); a switched-off kind cannot be opened (`The order type is switched off`), existing orders can still be finished.
2. **Queue number** per restaurant per Baghdad day, shared by takeaway and delivery, unique `(restaurantId, queueDay, queueNumber)`, max+1 with the existing unique-violation retry loop.
3. **Customer data.** Takeaway: optional name/phone. Delivery: phone and address required, name optional. Phone normalized (Arabic-Indic/Persian digits to ASCII, spaces and dashes dropped, `^\+?\d{7,15}$`); name ≤120, address ≤300, note ≤300. Phone and address never go into audit `changes` (`hasPhone`/`hasAddress` booleans only).
4. **Zones** optional (`name`, integer `fee`, `active`, ≤50, names unique case-insensitively). Picking a zone copies name and fee to the order; the cashier may type another fee. Zone edits never change existing orders.
5. **Fee in the money path:** `total = afterDiscount + service + tax + deliveryFee`; fee after tax, never discounted/taxed/service-charged. Service charge is dine-in only (already in `effectiveRates`). `orderTotals` passes `order.deliveryFee` for DELIVERY; the payment snapshot stores it (old snapshots parse as 0).
6. **Drivers** are a name+phone list (no login, ≤100), deactivated never deleted; order stores `driverId` plus `driverNameSnapshot`.
7. **Fulfillment** enum `NEW | PREPARING | READY | OUT | DELIVERED | PICKED_UP` (null for dine-in). Moves: takeaway `NEW→PREPARING→READY→PICKED_UP`; delivery `NEW→PREPARING→READY→OUT→DELIVERED`; back only `OUT→READY` and `READY→PREPARING`. `PICKED_UP` needs PAID; `OUT` needs a driver; `DELIVERED` does not need payment. Cancelling is the existing cancel.
8. **Kitchen drives it when kitchen mode is on:** `sendToKitchenIn` moves NEW→PREPARING; `markLinesReadyIn` flipping the order READY moves PREPARING→READY. Cashier can always tap forward.
9. **`advanceFulfillment` is the one change allowed on a PAID order** (takeaway paid at the counter, then picked up): compare-and-set on `(id, restaurantId, fulfillment = from)` that bumps `version`; locked CANCELLED/REJECTED refuse; the loser gets the stale conflict.
10. **Cash on delivery = the ordinary pay action** by the cashier who receives the cash, into that cashier's open shift. A delivered, unpaid delivery is "cash with driver", listed per driver on the board and counted (not blocking) on the close-shift screen as `unsettledDeliveries`.
11. **Customer lookup:** exact normalized phone against the restaurant's own past delivery orders; no customer model.
12. **Board:** tabs "Takeaway" and "Delivery" (only when enabled) next to the areas, `?area=takeaway|delivery`; the header count and today's sales are unchanged (tables only / all payments). Off-premise orders do not depend on QR ordering.
13. **Permissions:** no new ones. `order.handle` opens/edits/assigns/advances; `order.cancel` cancels; `payment.take` pays; `settings.manage` owns zones and drivers. KITCHEN sees takeaway/delivery only on its screen.
14. **Receipt/slip/reports:** receipt header shows the kind and queue number, customer, and for delivery address/zone/driver and the fee line; a printable driver slip (`/pos/orders/[id]/delivery-slip`, not a receipt) shows items without prices and "to collect"; reports gain `deliveryFeesTotal`.

## Global Constraints

- Private DB only (own `BUZZIFY_DB_PORT`), no push of `main`, no production. PR body says the migration must be rehearsed on a Neon branch.
- Integer IQD; ar/ckb/en trees identical; RTL logical CSS; 48px targets; Baghdad time via `formatStamp`; Arabic-Indic digits accepted in typed fields; user text `dir="auto"`, phones/amounts LTR.
- Every new table has `restaurantId`, is in `RESTAURANT_SCOPED_MODELS`, every new action/query is in the TILL list of `tests/studio/cross-tenant.test.ts`; new audit names/entity types registered with 3-language labels; refusal sentences in `POS_TEXT` with `error.text.*`.
- A menu-only restaurant runs no cashier code (isolation test).
- LF endings (check `git diff --stat`); commit trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Delivery paid in a shift: drawer expected cash = opening + cash payments (fees included) − expenses; an unsettled delivery appears in no shift.
2. Two cashiers advancing/paying/cancelling the same order: one wins, no double audit, consistent end state.
3. Queue numbers across Baghdad midnight and concurrent opens: no duplicates, restart at 1.
4. Phone/address input: Arabic-Indic digits, 300-char Arabic address with newlines, 120-char name; other restaurants' zones/drivers unreachable.
5. Money edges: fee 0, fee with 100% invoice discount, fee with tax, takeaway with service charge configured (no service), old snapshots without `deliveryFee`.
6. Types switched off: no tab/button; opening refuses; live orders can still be finished.

## Tasks

### Task 1: schema, zones, drivers, phone, setup page
Files: `prisma/schema.prisma` + migration `…_pos_takeaway_delivery`; `src/lib/phone.ts` (`normalizePhone`); `src/server/pos/delivery-setup.ts`; `src/server/studio/actions/pos-delivery.ts`, `queries/pos-delivery.ts`; `src/app/studio/_actions/pos.ts` exports; `src/app/pos/(till)/delivery/page.tsx`, `src/app/pos/_ui/DeliverySetup.tsx`; nav page `delivery` (needs `settings.manage` and `deliveryEnabled`); audit names `pos.zone.create|update|delete`, `pos.driver.create|update`; messages.
Tests: `tests/pos/delivery-setup.test.ts`, `tests/pos/domain/phone.test.ts`, cross-tenant TILL list, schema/registry tests.
- [ ] failing tests → implement → full run → commit `feat(pos): delivery zones and drivers`.

### Task 2: opening off-premise orders, queue number, details, recent customer
Files: `src/server/pos/off-premise.ts` (`openOffPremiseIn`, `updateOffPremiseDetailsIn`, `findRecentCustomerIn`), actions in `pos-orders.ts`/`pos-delivery.ts`.
Tests: `tests/pos/off-premise.test.ts` (queue numbers, midnight, concurrency, switch off, validation, audit has no phone/address, isolation).
- [ ] commit `feat(pos): takeaway and delivery orders with a daily queue number`.

### Task 3: money, snapshot, reports, receipt data
Files: `orders.ts` (`orderTotals` fee), `payments.ts` (snapshot fee, receipt fields), `report.ts` (`deliveryFeesTotal`), `OrderView` additions.
Tests: totals, payments, report, views.
- [ ] commit `feat(pos): delivery fee in totals, snapshots and reports`.

### Task 4: fulfillment flow, drivers on orders, kitchen coupling, board data, unsettled deliveries
Files: `src/server/domain/pos/fulfillment.ts`, `off-premise.ts` (`advanceFulfillmentIn`, `assignDriverIn`, `readOffPremiseBoard`), `kitchen.ts` (coupling, `kind`/`queueNumber` on cards and tickets), `shifts.ts` (`unsettledDeliveries`).
Tests: `tests/pos/domain/fulfillment.test.ts`, off-premise, kitchen, shifts.
- [ ] commit `feat(pos): fulfillment flow, drivers and off-premise board`.

### Task 5: UI
Board tabs and cards, new takeaway/delivery dialog with phone lookup, order screen bar (stepper, driver picker, details edit), receipt additions, driver slip page, kitchen labels, shift warning, daily report row; messages in ar/ckb/en.
Verification: tests, tsc, eslint, browser (ar, ckb, en; 375px) on the private DB.
- [ ] commit `feat(pos): takeaway and delivery screens`.
