# Cashier trust controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Menu POS discount reasons, on-the-spot manager approval, a blind cash count, numbered Z reports, reports by hour/item/staff with CSV, idle sign-out and an owner activity page.

**Architecture:** Server rules live in `src/server/pos/*` and are called from the Studio-framework actions in `src/server/studio/actions/pos-*.ts` (`defineAction`, `ctx.transaction`, `ctx.audit`). One Prisma migration adds the new columns and a counter table. UI changes are in `src/app/pos`, with strings in the three message files. Approval is enforced in the server actions, never only in the UI.

**Tech Stack:** Next.js, Prisma/Postgres (embedded, own port), vitest (`tests/pos`), Zod, `better-auth/crypto` for PIN hashing.

**Spec:** `docs/superpowers/specs/2026-10-27-cashier-trust-controls-design.md`

## Global Constraints

- Work only in this worktree; migrate and test on its own database port (`BUZZIFY_DB_PORT`, for example 54341), never 54329. Pass `DATABASE_URL` explicitly to any `tsx` script.
- Tests are written first and must fail before the code exists.
- Every new string exists in `en.ts`, `ar.ts` and `ckb.ts` under `src/studio/messages/`.
- Every new query filters by `restaurantId`; every new query has a cross-tenant test.
- No motion in the cashier; no colour-only difference between styles.
- A PIN is never stored in new places and never logged.
- Lint `src`, not `.`; commit with LF line endings (check `git diff --stat` for whole-file churn).

## Review Focus

- A cashier posts the discount/cancel/refund action directly with no approval: refused.
- An approver PIN of staff from another restaurant, a deactivated manager, a cashier, or a locked manager: refused.
- Ten wrong approval PINs in a row lock the approver the same way sign-in does.
- Two shifts closing at the same moment never get the same Z number.
- A CSV cell that starts with `=`, `+`, `-` or `@` (a product named `=HYPERLINK(...)`) is neutralised.
- A restaurant with zero orders in the range returns empty reports, not an error.
- Hour grouping uses the restaurant's local time zone across midnight.
- Idle timeout set to off never signs anyone out; an open order survives a timeout.

---

### Task 1: Schema and migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_cashier_trust_controls/migration.sql` (generated)
- Test: `tests/pos/trust-schema.test.ts`

**Interfaces:**
- Produces: enum `PosDiscountReason { MANAGER_DECISION REGULAR_GUEST COMPLAINT STAFF_MEAL OTHER }`; nullable `discountReason PosDiscountReason?` and `discountNote String?` on `PosOrder` (invoice discount) and `PosOrderLine`; `approvedByStaffId String?` on `PosOrder`, `PosOrderLine`, `PosPaymentReversal`; `zNumber Int?` on `PosShift` with `@@unique([restaurantId, zNumber])`; model `PosCounter { restaurantId, name, value }` with `@@id([restaurantId, name])`; `idleMinutes Int @default(15)` and `requireApproval Boolean @default(true)` on the POS settings model (the one holding `taxRatePercent`).

- [ ] **Step 1:** Write `trust-schema.test.ts`: creating a `PosCounter` twice for the same restaurant and name fails; two shifts with the same `zNumber` in one restaurant fail, in different restaurants succeed.
- [ ] **Step 2:** Start this worktree's database (`BUZZIFY_DB_PORT=54341 npm run db:up`), run the test; expect FAIL (missing model).
- [ ] **Step 3:** Edit the schema as listed and run `prisma migrate dev --name cashier_trust_controls` with `DATABASE_URL` pointing at port 54341, then `prisma generate`.
- [ ] **Step 4:** Run the test; expect PASS. Run `npm run typecheck`.
- [ ] **Step 5:** Commit `feat(pos): schema for discount reasons, approvals, Z numbers`.

### Task 2: Approver PIN check

**Files:**
- Modify: `src/server/pos/pin.ts`, `src/server/pos/errors.ts`
- Test: `tests/pos/approval.test.ts`

**Interfaces:**
- Produces: `verifyApproverPin(prisma: PrismaClient, input: { restaurantId: string; staffId: string; pin: string; meta: RequestMeta; now?: Date }): Promise<{ staffId: string; userId: string }>`; throws `PinRefusedError` or `PinLockedError`. Only staff with role OWNER or MANAGER, active, with a PIN, in `restaurantId`, are accepted. Writes `pos.approval.ok` / `pos.approval.fail` audit rows; creates no session; reuses the staff lock counters of `verifyPin`.
- Produces: `refuse` code text `'Manager approval is needed'` mapped to message key `error.text.posApprovalNeeded` in `errors.ts`.

- [ ] **Step 1:** Write `approval.test.ts` covering: valid manager ok; wrong PIN refused; cashier as approver refused; other restaurant's manager refused; deactivated manager refused; 5 wrong PINs lock, the sixth with the right PIN is still `PinLockedError`; no `Session` row created; audit rows written.
- [ ] **Step 2:** Run; expect FAIL (function missing).
- [ ] **Step 3:** Implement `verifyApproverPin` by extracting the shared lock/attempt steps of `verifyPin` into an internal helper both use, adding the role filter. Do not change `verifyPin` behaviour; its existing tests must still pass.
- [ ] **Step 4:** Run `tests/pos/approval.test.ts` and the existing PIN tests; expect PASS.
- [ ] **Step 5:** Commit `feat(pos): approver PIN check`.

### Task 3: Reasons and approval on discount, cancel and refund

**Files:**
- Modify: `src/server/pos/orders.ts` (`setInvoiceDiscountIn`, `updateLineIn`, `cancelLineIn`, `cancelOrderIn`), `src/server/pos/refunds.ts`, `src/server/studio/actions/pos-orders.ts`, the refund action in `src/server/studio/actions/` (search `pos.refund`)
- Create: `src/server/pos/approval.ts`
- Test: `tests/pos/discount-approval.test.ts`

**Interfaces:**
- Consumes: `verifyApproverPin` (Task 2), schema (Task 1).
- Produces: `requireApprovalIn(args: { prisma; restaurantId: string; actor: { role: PosRole }; needed: boolean; approval?: { staffId: string; pin: string }; meta: RequestMeta }): Promise<{ approvedByStaffId: string | null }>`. A MANAGER or OWNER actor never needs approval; a CASHIER needs it when `needed` (the setting `requireApproval`) is true, else `StudioError` with the `posApprovalNeeded` text.
- Produces: discount input becomes `discount: { kind, value, reason: PosDiscountReason, note?: string }` where `OTHER` requires a non-empty `note`; the stored row keeps `discountReason`, `discountNote`, `approvedByStaffId`; the audit `changes` include reason and approver.

- [ ] **Step 1:** Write tests: cashier discount without reason refused; `OTHER` without note refused; cashier discount without approval refused; with a valid manager approval ok and `approvedByStaffId` stored; manager discount alone ok; same three cases for cancel line, cancel order and refund; with `requireApproval=false` a cashier needs no approval but still needs a reason; calling the action directly with a wrong approval PIN is refused.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement `requireApprovalIn` and thread `approval`, `reason`, `note` through the listed server functions and actions; load `requireApproval` from the settings loader in `src/server/pos/settings.ts`.
- [ ] **Step 4:** Run the new tests plus the existing `tests/pos` order, refund and payment tests; expect PASS (update old tests only to supply the now-required reason).
- [ ] **Step 5:** Commit `feat(pos): reasons and manager approval on discount, cancel and refund`.

### Task 4: Approval dialog and discount reason in the till UI

**Files:**
- Create: `src/app/pos/_ui/ApprovalDialog.tsx`, `src/app/pos/_ui/DiscountReasonField.tsx`
- Modify: `src/app/pos/_ui/OrderScreen.tsx`, `src/app/pos/_ui/ReverseDialog.tsx`, `src/app/pos/_ui/use-pos-call.ts`, `src/studio/messages/{en,ar,ckb}.ts`
- Test: `tests/pos/approval-dialog.test.tsx` (component test, same setup as existing `_ui` tests)

**Interfaces:**
- Consumes: the action input shapes of Task 3.
- Produces: `<ApprovalDialog open onApproved={(a: { staffId: string; pin: string }) => void} onCancel />` listing OWNER/MANAGER staff with a PIN and a digit entry; `<DiscountReasonField value onChange />`; `usePosCall` retries an action once with `approval` after the dialog returns when the server answers `posApprovalNeeded`.

- [ ] **Step 1:** Write the component test: the dialog lists only managers, entering the PIN calls `onApproved` with the chosen staff id; a refused PIN shows the error text and keeps the dialog open; the reason field shows the note input only for `OTHER`.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement the two components (48px minimum targets, no motion, RTL-safe) and wire them into the discount, cancel and refund buttons; add the staff-list query for approvers to `src/server/studio/queries/pos.ts` (restaurant-scoped, test it cross-tenant in `tests/pos/approval.test.ts`).
- [ ] **Step 4:** Run the test and `npm run typecheck`; expect PASS.
- [ ] **Step 5:** Commit `feat(pos): approval dialog and discount reason in the till`.

### Task 5: Blind count and Z numbers

**Files:**
- Modify: `src/server/pos/shifts.ts`, `src/server/studio/queries/pos.ts` (open-shift view), `src/app/pos/_ui/ShiftScreen.tsx`, `src/server/pos/report.ts`
- Create: `src/server/pos/counter.ts`
- Test: `tests/pos/shift-close.test.ts`

**Interfaces:**
- Produces: `nextCounterIn(db: AnyDb, restaurantId: string, name: string): Promise<number>` using an atomic upsert-increment on `PosCounter`.
- Produces: `closeShiftIn` additionally returns `{ zNumber: number; expectedCash: number; countedCash: number; difference: number }` and stores `zNumber`.
- Produces: the open-shift view no longer includes expected cash.

- [ ] **Step 1:** Write tests: the open-shift query result has no expected-cash field; closing returns expected, counted, difference; two shifts closed in parallel (`Promise.all`) get Z 1 and 2; Z numbers are per restaurant; a shift closed before the migration (null `zNumber`) still reads.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement `nextCounterIn` and call it inside the close transaction; strip expected cash from the open view; change `ShiftScreen` to show the count form first and the result (expected, counted, difference, Z number) after submit.
- [ ] **Step 4:** Run the test and typecheck; expect PASS.
- [ ] **Step 5:** Commit `feat(pos): blind cash count and numbered Z reports`.

### Task 6: X and Z report views

**Files:**
- Modify: `src/server/pos/report.ts`, `src/app/pos/(till)/report/` page, `src/app/pos/_ui/DailyReportView.tsx`
- Test: `tests/pos/x-z-report.test.ts`

**Interfaces:**
- Produces: `shiftReportView(prisma, restaurantId, shiftId): Promise<{ kind: 'X' | 'Z'; zNumber: number | null; ...existing report fields }>` where `kind` is `'X'` for an open shift and `'Z'` for a closed one; the closed numbers never change after close (reads stored figures, not live recomputation of anything mutable).

- [ ] **Step 1:** Write tests: open shift gives `X` with live figures and no write; closed shift gives `Z` with its number; a refund recorded after close does not alter the Z figures; another restaurant's shift id gives not found.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement `shiftReportView`, and label the view and print header "X report" or "Z report N" in all three languages.
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5:** Commit `feat(pos): X and Z report views`.

### Task 7: Reports by hour, item, staff and method, with CSV

**Files:**
- Modify: `src/server/pos/range-report.ts`, `src/app/pos/(till)/report/` range page
- Create: `src/server/pos/report-breakdown.ts`, `src/server/pos/csv-export.ts`, `src/app/pos/(till)/report/export/route.ts`
- Test: `tests/pos/report-breakdown.test.ts`, `tests/pos/csv-export.test.ts`

**Interfaces:**
- Produces: `breakdownIn(prisma, restaurantId, range: { from: Date; to: Date; timeZone: string }): Promise<{ byHour: { hour: number; orders: number; total: number }[]; byItem: { name: string; quantity: number; total: number }[]; byStaff: { staffId: string; name: string; orders: number; total: number }[]; byMethod: { method: string; total: number }[] }>`; totals equal the existing range report's total for the same range.
- Produces: `toCsv(rows: (string | number)[][]): string` that quotes cells and prefixes a `'` to any text cell starting with `=`, `+`, `-` or `@`; the export route requires `report.view`.

- [ ] **Step 1:** Write tests: totals of every breakdown equal the range report total; hour buckets follow the time zone across midnight; cancelled and refunded orders are excluded as in the existing report; empty range gives empty arrays; cross-tenant isolation; `toCsv` neutralises `=HYPERLINK("x")`, quotes commas and newlines; the route refuses a KITCHEN role.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement with grouped queries (no per-row loops), the range page tables, and an "Export CSV" link.
- [ ] **Step 4:** Run; expect PASS; cross-check one range against `range-report.ts` in a test.
- [ ] **Step 5:** Commit `feat(pos): breakdown reports and CSV export`.

### Task 8: Idle sign-out and the settings fields

**Files:**
- Modify: `src/server/pos/settings.ts`, the settings section UI under `src/app/pos/(till)/settings/`, `src/app/pos/(till)/layout.tsx`
- Create: `src/app/pos/_ui/IdleGuard.tsx`
- Test: `tests/pos/settings-trust.test.ts`, `tests/pos/idle-guard.test.tsx`

**Interfaces:**
- Produces: settings read/write for `idleMinutes` (0 = off, else 1 to 240) and `requireApproval`, owner/manager only; `<IdleGuard minutes={number} />` resetting on pointer, key and touch events and calling the existing sign-out path at expiry.

- [ ] **Step 1:** Write tests: out-of-range `idleMinutes` refused; a cashier cannot change settings; with fake timers `IdleGuard` fires after the limit, resets on activity, and never fires when `minutes` is 0.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement settings fields (default 15 and true), the guard, and mount it in the till layout.
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5:** Commit `feat(pos): idle sign-out and trust settings`.

### Task 9: Owner activity page

**Files:**
- Create: `src/server/pos/activity.ts`, `src/app/pos/(till)/activity/page.tsx`
- Modify: `src/app/pos/_ui/TillNav.tsx`, `src/studio/messages/{en,ar,ckb}.ts`
- Test: `tests/pos/activity.test.ts`

**Interfaces:**
- Produces: `listActivityIn(prisma, restaurantId, filter: { staffId?: string; type?: 'discount' | 'cancel' | 'refund' | 'difference' | 'pin'; before?: Date; limit?: number }): Promise<{ rows: ActivityRow[]; next: Date | null }>` over `AuditLog` rows with actions `pos.order.discount.*`, `pos.order.line.update` (with a discount), `pos.order.cancel`, `pos.order.line.cancel`, refund, shift close difference, `pos.pin.fail`, `pos.approval.*`; page size default 50.

- [ ] **Step 1:** Write tests: each type filter returns only its rows; newest first; paging via `next`; other restaurants' rows never appear; the page is refused without `report.view`.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement the query and a plain table page (no motion) with staff and type filters; add the nav entry for roles with `report.view`.
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5:** Commit `feat(pos): owner activity page`.

### Task 10: Whole-batch verification

**Files:** none new.

- [ ] **Step 1:** Run `npm run typecheck`, `npx eslint src`, and `BUZZIFY_DB_PORT=54341 npm test`; expect all pass.
- [ ] **Step 2:** Start this worktree's dev server on its own port (add a `launch.json` entry in the main checkout as the project notes describe) and click through: cashier discount asks for a manager PIN; wrong PIN refused; blind count then Z number; range report and CSV; idle sign-out with a 1-minute setting; activity page. Check in Arabic and Kurdish (RTL).
- [ ] **Step 3:** Run `/code-review` on the diff and fix confirmed findings.
- [ ] **Step 4:** Check `git diff --stat main...` for whole-file CRLF churn.
- [ ] **Step 5:** Open the PR from `cashier-trust-controls` using the prefilled compare URL (no `gh`).

## Self-review

Every spec goal maps to a task: 1 and 2 to Tasks 1, 3, 4; 3 to Task 5; 4 to Tasks 5 and 6; 5 to Task 7; 6 to Task 8; 7 to Task 9. Names used across tasks (`verifyApproverPin`, `requireApprovalIn`, `nextCounterIn`, `shiftReportView`, `breakdownIn`, `toCsv`, `listActivityIn`, `IdleGuard`) are defined once where produced.
