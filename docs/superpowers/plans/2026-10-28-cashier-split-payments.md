# Cashier Batch 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline, native). Steps use checkbox syntax.

**Goal:** Mixed payment, split by guest, tips, comp, merge tables and keyboard shortcuts in the Menu POS.

**Architecture:** `PosPayment` stays the unit every report, shift and refund reads. A payment gains legs (one per method) and a tip. Phase A keeps one payment per order (mixed payment, tip, comp, refund by leg). Phase B lets an order have several payments (`part`), each owning the lines it paid.

**Tech Stack:** Next.js, Prisma 7 (embedded Postgres, `BUZZIFY_DB_PORT=54351`), vitest in `tests/pos`, Studio action framework.

**Spec:** `docs/superpowers/specs/2026-10-28-cashier-split-payments-design.md`

## Global Constraints

- TDD: every task starts with a test that fails for the right reason.
- Thrown `refuse(code, text)` texts go in `POS_TEXT` (`src/server/pos/errors.ts`) with `error.text.*` keys in `src/studio/messages/pos-till/{en,ar,ckb}.ts`; `tests/studio/messages.test.ts` fails on untranslated English.
- Every new action or query name is added to the table in `tests/studio/cross-tenant.test.ts` (the line containing `'pos.idleMinutes'`). A new restaurant-scoped model goes in `RESTAURANT_SCOPED_MODELS` (`src/server/data/tenant-db.ts`).
- Money is integer IQD. No motion in the cashier. Arabic and Kurdish RTL must work.
- Migrations: hand-written SQL in `prisma/migrations/<ts>_<name>/`, applied with `BUZZIFY_DB_PORT=54351 npx prisma migrate deploy`, then `npx prisma generate`. Old rows must keep meaning exactly what they meant (backfill in the migration).
- Run commands as plain separate commands from the worktree (compound git/python commands are refused by the sandbox).

## Review Focus

- A bill paid in parts, then a part refunded: day report, range report, breakdown and shift expected cash agree.
- Mixed payment with cash change: the drawer gets cash applied only, never the change.
- Two cashiers paying different parts at once: no line is paid twice.
- A tip is never inside gross sales, and a tip over the part's total is refused.
- Merging an order the kitchen already received: tickets follow the lines.

---

## Phase A: mixed payment, tips, comp

### Task 1: Schema for legs, tip, COMP, reversal cash part

**Files:** Modify `prisma/schema.prisma`; create `prisma/migrations/20261028100000_cashier_split_payments/migration.sql`; modify `src/server/data/tenant-db.ts`; test `tests/pos/split-schema.test.ts`.

**Interfaces:** Produces model `PosPaymentLeg { id, restaurantId, paymentId, method PosPaymentMethod, amount Int, tendered Int?, reference String? }` (cascade from payment and restaurant; `Restaurant.posPaymentLegs`, `PosPayment.legs`); `PosPayment.tipAmount Int @default(0)`, `PosPayment.tipMethod PosPaymentMethod?`; `PosPaymentReversal.cashPart Int @default(0)`; enum value `PosDiscountReason.COMP`. Migration backfills one leg per existing payment (`amount` = snapshot `total`, `tendered` = `amountReceived` when CASH) and `cashPart = amount` for CASH reversals.

- [ ] **Step 1:** Test: after migrate, an inserted payment with two legs reads back; a legacy-shaped payment (inserted without legs) is not required to have them (legs are read through `legsOf` in Task 2, which falls back to the payment's own method); `COMP` is a valid reason.
- [ ] **Step 2:** Run; expect FAIL (model missing).
- [ ] **Step 3:** Edit schema and write migration SQL including the backfill `INSERT ... SELECT` for legs and `UPDATE` for `cashPart`; add `PosPaymentLeg` to `RESTAURANT_SCOPED_MODELS`; deploy and generate.
- [ ] **Step 4:** Run; expect PASS, plus `tests/data` registry tests.
- [ ] **Step 5:** Commit `feat(pos): schema for payment legs, tips and comp`.

### Task 2: Mixed payment and tip in `payOrderIn`

**Files:** Modify `src/server/pos/payments.ts`, `src/server/studio/actions/pos-payments.ts`, `src/server/pos/errors.ts`, messages; create `src/server/pos/payment-legs.ts`; test `tests/pos/mixed-payment.test.ts`.

**Interfaces:**
- Produces `PayInput` gains `legs: { method: PosPaymentMethodKey; amount: number; tendered?: number; reference?: string }[]` and `tip?: { amount: number; method: PosPaymentMethodKey }`; the old `method` + `amountReceived` stay accepted and are turned into one leg (so sync and old callers keep working).
- Produces `checkLegs(total: number, legs, tip, enabled: PosPaymentMethodKey[]): { change: number; amountReceived: number }` in `payment-legs.ts`, and `legsOf(payment): Leg[]` (falls back to one leg from the payment's own method).

- [ ] **Step 1:** Tests: cash 20,000 + FIB 15,000 on a 35,000 bill is paid with two legs; legs summing to less or more than the total are refused; only a cash leg may carry `tendered > amount` and the change is `tendered - amount`; a non-cash method that is switched off is refused; a tip is stored outside `totalsSnapshot.total`; a tip above the total is refused; a negative tip is refused; two legs of the same method are refused; the old single-method call still works; cash tip counts in the shift's drawer, a FIB tip does not (assert via `readShiftSummary`).
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement `checkLegs` and use it in `payOrderIn`; create the legs and set `PosPayment.method` to the largest leg's method, `amountReceived` to the sum of tendered (or amount) plus tip, `tipAmount`/`tipMethod`; extend the action's zod input (`legs` array max 4, `tip` optional) and audit `legs` and `tip`.
- [ ] **Step 4:** Run; expect PASS and all existing payment tests green.
- [ ] **Step 5:** Commit `feat(pos): mixed payment and tips`.

### Task 3: Shifts, reports and refunds follow legs

**Files:** Modify `src/server/pos/shifts.ts`, `report.ts`, `range-report.ts`, `report-breakdown.ts`, `refunds.ts`, `receipt` reader in `payments.ts`, `src/server/studio/actions/pos-payments.ts`; tests `tests/pos/legs-reports.test.ts`.

**Interfaces:** Produces `cashIn(payment): number` (cash legs' `amount` plus a cash tip). Reports gain `tips: { total: number }`. `ReverseInput` unchanged; the reversal's `cashPart` = the payment's cash legs `amount` and its refund per method comes from the legs.

- [ ] **Step 1:** Tests: expected cash = float + cash legs (+ cash tip) - expenses - cash refunds, with change excluded; a mixed payment shows in both methods of the day report's by-method with the leg amounts; range report gross and every breakdown table equal for a mixed sale; refunding a mixed payment puts only the cash leg out of the drawer and lists each leg's method as refunded; Z report shows tips total.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Read legs wherever `payment.method`/`amountReceived` is summed (list in the spec's Reports section); fall back to `legsOf` for legacy rows.
- [ ] **Step 4:** Run `tests/pos` fully; expect PASS.
- [ ] **Step 5:** Commit `feat(pos): shifts, reports and refunds read payment legs`.

### Task 4: Comp (ضيافة)

**Files:** Modify `src/server/pos/approval.ts`, `src/server/studio/actions/pos-orders.ts`, `src/lib/pos-approval.ts`, report readers, messages; test `tests/pos/comp.test.ts`.

**Interfaces:** `DISCOUNT_REASONS` gains `'COMP'`. `requireApprovalIn` takes `always?: boolean`; a discount whose reason is `COMP` calls it with `always: true`, which ignores `requireApproval = false` for a CASHIER.

- [ ] **Step 1:** Tests: a cashier cannot comp a line without a manager PIN even when `requireApproval` is off; with the PIN the line is 100 percent off and `discountReason = COMP`; a manager comps without a second person; the day report has a `comps` total (the value taken off lines with reason COMP, from the payment snapshots); the activity page's discount rows show the COMP label.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement; the snapshot lines need `discount.reason` so the report can sum comps (add `reason` to the snapshot line discount, optional for old rows).
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5:** Commit `feat(pos): comp with manager approval`.

### Task 5: Pay dialog UI (mixed payment, tip)

**Files:** Modify `src/app/pos/_ui/PayPanel.tsx`, messages; test `tests/pos/pay-panel-model.test.ts` for a pure helper `src/lib/pos-pay-legs.ts` (`remaining(total, legs)`, `legsReady(...)`).

- [ ] **Step 1:** Test the helper: remaining amount, change display, "add the rest" fills the remaining on a chosen method, legs ready only when they add up.
- [ ] **Step 2:** Run; expect FAIL. **Step 3:** Implement the helper and the dialog: method rows with amount fields, "rest" button, tip field with quick 5, 10 and 15 percent buttons, change shown for cash. **Step 4:** Run; expect PASS; typecheck and eslint. **Step 5:** Commit `feat(pos): pay dialog with several methods and a tip`.

## Phase B: split by guest

### Task 6: Schema for parts and paid lines

**Files:** Modify `prisma/schema.prisma`, migration `20261028110000_cashier_payment_parts`; test `tests/pos/parts-schema.test.ts`.

**Interfaces:** `PosPayment.part Int @default(1)`; drop `@unique` on `orderId`, add `@@unique([orderId, part])`; `PosOrder.payment` relation becomes `payments`; `PosOrderLine.paymentId String?` with relation and index.

- [ ] **Step 1:** Test: two payments for one order with parts 1 and 2 are allowed, a third with part 2 is refused; lines can carry a `paymentId`. **Step 2:** FAIL. **Step 3:** Schema and migration (backfill: set `paymentId` on every live line of an already PAID order); fix compile errors from the renamed relation (`orders.ts:259,321`, receipts, refunds). **Step 4:** PASS and `tests/pos` green. **Step 5:** Commit.

### Task 7: Pay part of an order

**Files:** Modify `src/server/pos/payments.ts`, `orders.ts`, `src/server/studio/actions/pos-payments.ts`; create `src/server/pos/split.ts`; test `tests/pos/split-payment.test.ts`.

**Interfaces:** `PayInput.lineIds?: string[]`. `partTotals(order, lines, rates, lineIds): Totals` spreads the invoice discount, service, tax and delivery fee over the chosen lines in proportion, the last line taking the rounding, so all parts add up to the bill exactly.

- [ ] **Step 1:** Tests: paying two of three lines takes their share, leaves the order open with the third unpaid; paying the last lines makes the order PAID; the parts' totals add up to the whole bill with service, tax and an invoice discount; a line already paid is refused (two cashiers at once: the second gets CONFLICT, no double payment); `expectedTotal` is checked against the part; a cancelled line cannot be chosen; adding a line to a partly paid order is allowed and unpaid.
- [ ] **Step 2:** FAIL. **Step 3:** Implement with lines locked in the transaction (`updateMany ... where paymentId null`, count must match); status PAID only when no live line is unpaid; stock consumption only for the paid lines. **Step 4:** PASS. **Step 5:** Commit.

### Task 8: Refund, receipt and reports for parts

**Files:** Modify `refunds.ts`, `payments.ts` (`readReceipt`), `report*.ts`, `activity.ts`; test `tests/pos/split-reports.test.ts`.

- [ ] **Step 1:** Tests: reversal takes `paymentId` (a part); refunding one part leaves the others; the order shows paid only while all parts stand; day, range, breakdown and shift agree after a split with one refunded part; each part has its own receipt. **Step 2:** FAIL. **Step 3:** `ReverseInput.paymentId` (default: the order's only payment for old callers); receipts list parts. **Step 4:** PASS, `tests/pos` green. **Step 5:** Commit.

### Task 9: Split UI

**Files:** Modify `OrderScreen.tsx`, `PayPanel.tsx`, create `src/lib/pos-split.ts`; test `tests/pos/split-ui-model.test.ts`.

- [ ] **Step 1:** Test `pos-split.ts`: select lines, running part total, "split evenly by N guests" proposes N groups of lines as close as possible in value. **Step 2:** FAIL. **Step 3:** Implement helper and a "Split bill" mode that marks lines and pays the selection; paid lines show a "Paid" mark. **Step 4:** PASS; typecheck, eslint. **Step 5:** Commit.

## Phase C: merge tables and shortcuts

### Task 10: Merge tables

**Files:** Create `src/server/pos/merge.ts`; modify `src/server/studio/actions/pos-orders.ts`, `TablesBoard.tsx`/`OrderScreen.tsx`, messages; test `tests/pos/merge-tables.test.ts`.

**Interfaces:** `mergeOrdersIn(db, restaurantId, { fromOrderId, intoOrderId, expectedVersions }): { moved: number }`; action `pos.mergeOrders` with permission `order.handle`.

- [ ] **Step 1:** Tests: lines move to the target with kitchen state (`sentAt`, `batch`) kept and the target's version bumped; the source is cancelled with reason "merged into No. N"; refused when either is not open, not dine-in, has paid lines, the same order, or another restaurant's; stale versions give CONFLICT; one audit row names both orders; a cashier merges tables, a kitchen user cannot.
- [ ] **Step 2:** FAIL. **Step 3:** Implement in one transaction; add `pos.mergeOrders` to the cross-tenant table; UI: "Merge into..." on the order screen listing other open tables. **Step 4:** PASS. **Step 5:** Commit.

### Task 11: Keyboard shortcuts

**Files:** Create `src/lib/pos-shortcuts.ts`, `src/app/pos/_ui/Shortcuts.tsx`; modify `OrderScreen.tsx`, messages; test `tests/pos/shortcuts.test.ts`.

**Interfaces:** `shortcutFor(event: { key: string; target: { tagName?: string; isContentEditable?: boolean } | null; ctrlKey: boolean; metaKey: boolean; altKey: boolean }): 'search' | 'pay' | 'close' | null`.

- [ ] **Step 1:** Tests: `/` gives search, `F2` gives pay, `Escape` gives close; nothing fires while the target is an input, textarea, select or contenteditable (except Escape); modified keys are ignored. **Step 2:** FAIL. **Step 3:** Implement and mount on the order screen with a one-line help text. **Step 4:** PASS. **Step 5:** Commit.

## Task 12: Whole-batch verification

- [ ] **Step 1:** `npm run typecheck`, `npx eslint src`, `BUZZIFY_DB_PORT=54351 npm test`; expect only the known `ai-import` enforcement failure.
- [ ] **Step 2:** One whole-branch review with the most capable model (`origin/main...HEAD`), one fix pass for Critical and Important findings, each RED then GREEN.
- [ ] **Step 3:** Push and open the PR from the prefilled compare URL (no `gh`).
