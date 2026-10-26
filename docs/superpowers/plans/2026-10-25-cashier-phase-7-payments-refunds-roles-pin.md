# Cashier phase 7: terminal payments, refunds, roles, PIN and final settings (inside Core)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Finish the cashier's money and people side. (1) ZainCash, FIB and QiCard are taken at the till as *recorded* payments (method + optional reference, online only, no gateway). (2) A paid order can be reversed as a counter-entry under a manager's name; cash reversals come out of the reverser's drawer. (3) The role matrix is reviewed, shown read-only on the staff page and pinned by tests. (4) Till-only staff switch by PIN on shared devices a manager registered. (5) The settings page gains the subscription state and the shared devices.

**Architecture:** Same layers as phases 3-6: pure domain in `src/server/domain/pos`, services in `src/server/pos`, `defineAction`/`defineQuery` with a `pos:` permission and `{ kind: 'pos' }` target, audit in the same transaction, `delegates(tx)` inside `ctx.transaction` (never `delegates(ctx.db)`). One migration adds `PosPaymentReversal`, `PosSharedDevice`, `PosPinAttempt`; all three are restaurant-scoped and listed in `RESTAURANT_SCOPED_MODELS`. PIN sign-in is a small Better Auth plugin endpoint (`POST /api/auth/pin/sign-in`) that creates a normal Studio session after `verifyPin` passes, and only on a registered device.

**Source:** `docs/superpowers/plans/2026-10-24-cashier-unified-plan.md` (phase 7), the frozen cashier plan `buzzify-restaurant/docs/superpowers/plans/2026-10-24-cashier-7-payments-roles.md` (behaviour), and the real code of phases 3-6.

## What already exists (found in the code, 2026-10-25)

- `PosPaymentMethod` enum, `PosSettings.enabledPaymentMethods` (CASH always on), `tableRingMinutes` and its settings field.
- `payment.refund` in `POS_PERMISSIONS` (OWNER, MANAGER); `expectedCash({..., cashRefunds})` already takes refunds (callers pass `[]`).
- `PosStaff.pinHash|pinSetAt|pinFailedCount|pinLockedUntil` columns (no code uses them yet).
- Reports already split sales by method; `ShiftReport.netSales` equals gross "(no refunds exist yet)".
- `payOrderIn` is cash-only; the action's `method` is `z.literal('CASH')`; sync's `payCash` hard-codes CASH.
- Not ported on purpose (unified plan): `cashierActive` and its operator script (the live `cashier` subscription is the gate).

## Rulings

1. **Terminal payments = method + optional reference, no new payment path.** `payPosOrder` accepts `CASH | ZAINCASH | FIB | QICARD`. A terminal method needs `amountReceived === total`, a reference trimmed ≤100 (blank = none), and the method enabled in `PosSettings` (else `The payment method is switched off`, nothing posted). The UI never claims verification. No split payments (one `PosPayment` per order stays unique).
2. **Terminal methods are online only.** `OP_KINDS` and `op-schema` are unchanged (`payCash` payload has no method; sync passes `CASH`); a hand-built `payCash` with a method is refused as `invalid`. The order screen offers terminal methods only while online (`useSync().online`).
3. **A refund is a full reversal recorded in `PosPaymentReversal`** (`paymentId` unique, one per payment, no partial refunds). Amount = the payment's snapshot total, method = the payment's own; the order stays `PAID` (no new status; the board, locks and the offline snapshot are untouched); the `PosPayment` row is never edited. Needs `payment.refund` **and the reverser's own open shift**, for every method. A cash reversal lowers that shift's expected cash; a terminal reversal moves no cash and keeps an optional terminal reference. It counts in the shift where it was recorded; a closed shift's frozen figures are never touched. The order's `version` is bumped by compare-and-set on `expectedVersion` (the only other change allowed on a PAID order after `advanceFulfillment`).
4. **A cashier cannot refund alone**; a manager switches in by PIN on the same till (no override-PIN dialog).
5. **Reversal is online only and not allowed on a lapsed subscription** (it moves money; `allowLapsed` is not set). It is not in `OP_KINDS`.
6. **Reports:** shift and day gain `refundsByMethod`, `refundsTotal`, `netSales = gross − refunds`; `grossSales` is unchanged by a refund. A reversal belongs to the Baghdad day of the shift it was recorded in. `ShiftSummary` gains `cashRefunds` and `refundsByMethod`.
7. **Roles stay the four fixed ones.** The matrix is shown read-only on the staff page and pinned by tests (CASHIER exact set, KITCHEN exact set, OWNER/MANAGER hold all). A new permission **`pin.own`** is held by all four roles (a KITCHEN member must be able to set a PIN, and a till action names exactly one permission). `can`-style pure functions stay the single source (offline snapshot, pages and actions).
8. **PIN = quick sign-in for till-only accounts on registered shared devices.** A device is registered by `settings.manage`; the server sets HttpOnly cookie `bz_device` (32 random bytes base64url, 400 days, `SameSite=Lax`, `Secure` in production) and stores only its sha256. A PIN alone, from anywhere else, opens nothing (403 `deviceUnknown`).
9. **Eligibility (Core-specific security ruling).** A PIN session is a normal Studio session, so PIN is allowed only for accounts that could do nothing in the Studio anyway: the user has an active `PosStaff` row in the device's restaurant, **no `Membership` anywhere, not a Super Admin, two-factor off, not deactivated**. `setOwnPin` refuses an ineligible account (`pinNotAvailable`); `verifyPin` answers the ineligible exactly like a wrong PIN (`pinRefused`). OWNER members therefore never PIN in (they sign in by password and 2FA).
10. **PIN rules:** 4-8 digits; weak refused (one repeated digit, ascending/descending run, two-digit repeats like `1212`); stored with Better Auth `hashPassword` (scrypt); set by the person after re-entering their password (rate-limited with the Studio's `checkRateLimit`); cleared (never read) by `staff.manage` under the `mayAssign` limits (a MANAGER touches only CASHIER/KITCHEN rows, never oneself). Deactivating does not clear the hash; `verifyPin` refuses inactive rows.
11. **PIN limits:** staff locked 15 min after 5 consecutive failures (`pinFailedCount`, `pinLockedUntil`); a device refused 15 min once it holds 20 failed `PosPinAttempt` rows in 15 min, checked before any hashing. Every attempt writes one `PosPinAttempt` and one audit row (`pos.pin.ok|fail`, `{ deviceId }`, never the PIN). Unknown staff, no PIN, wrong PIN, ineligible: same `pinRefused` after the same scrypt work (fixed dummy hash).
12. **PIN switching is online only** and ends the previous session of that request. The sync scope (restaurant + user) already isolates each person's queue; switching shows the pending-operations warning first when the queue has items.
13. **Final settings are only what exists:** the ring minutes field stays; the page gains a read-only **subscription state** line and the **shared devices** section. Restaurant name is the Studio's; no receipt footer/logo/printer/currency settings.
14. **Audit names** registered with ar/ckb/en labels: `pos.payment.reverse`, `pos.staff.pin.set|clear`, `pos.device.register|revoke`, `pos.pin.ok|fail`; payment audit gains `method` and `reference`.

## Global Constraints

- Private DB only (`BUZZIFY_DB_PORT=54397`), never 54329; no push/PR/merge/production. PR body (when the owner asks) must say the migration is to be rehearsed on a Neon branch first.
- Integer IQD; a reversal amount is the stored `totalsSnapshot.total`, never retyped. No gateway, no provider call.
- ar/ckb/en message trees identical; RTL logical CSS; touch targets ≥48px (PIN keys 64px); user text `dir="auto"`, amounts/PIN/references LTR.
- Every new table has `restaurantId`, is in `RESTAURANT_SCOPED_MODELS`; every new action/query is in the TILL list of `tests/studio/cross-tenant.test.ts`; refusal sentences in `POS_TEXT` with `error.text.*`.
- Secrets: a PIN, a password and a device token never reach an audit row, a log, a URL, the offline snapshot or IndexedDB. Hashes only.
- A menu-only restaurant runs no cashier code (isolation test stays green).
- New online-only actions are not added to `OP_KINDS`; the existing sync path must keep working unchanged.
- LF endings (check `git diff --stat`); commit trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

1. PIN guessing: one staff member, many staff, unregistered device, revoked device; ineligible accounts (membership, super admin, 2FA, deactivated); no PIN in any audit row; PIN session never reaches the Studio.
2. Refund twice (double tap, two managers, retry): exactly one reversal; unpaid/cancelled order; cash refund in another shift; original closed shift unchanged; lapsed subscription.
3. Terminal method offline, in a hand-built sync batch, or after being switched off: never queued; `methodDisabled`-style refusal posts nothing.
4. Report math: gross unchanged, refunds per method, net, day totals, expected cash with refunds; method switched off still listed.
5. Cross-tenant: devices, reversals, PIN staff of another restaurant unreachable; sweep covers every new definition.

## Tasks

### Task 1: schema, migration, registry
Files: `prisma/schema.prisma` + migration `…_pos_payments_roles_pin`; `src/server/data/tenant-db.ts` registry; `tests/pos/schema.test.ts`, tenant registry test, `tests/helpers/db.ts` reset if needed.
Models: `PosPaymentReversal {id, restaurantId, paymentId @unique, orderId, method, amount, reference?, reason, userId?, shiftId?, createdAt}`, `PosSharedDevice {id, restaurantId, name, tokenHash @unique, createdByUserId?, createdAt, lastUsedAt?, revokedAt?}`, `PosPinAttempt {id, restaurantId, deviceId, staffId, ok, at}`.
- [ ] failing schema tests → migrate (own DB) → commit `feat(pos): payments, roles and PIN tables`.

### Task 2: terminal payments
Files: `payments.ts` (`payOrderIn` method/reference/enabled check), `pos-payments.ts` (method enum), `domain/pos/payment-methods.ts` helpers, `PayPanel.tsx` (method picker, reference, online only), `Receipt.tsx`/`readReceipt` (method name, reference, no change line for terminal), messages.
Tests: `tests/pos/payments.test.ts` additions, `tests/pos/op-schema.test.ts` (payCash with a method refused), sync test (terminal never queued).
- [ ] tests → implement → commit `feat(pos): terminal payments, recorded and online only`.

### Task 3: reversal service, drawer and report math
Files: `src/server/pos/refunds.ts` (`reversePaymentIn`, `readReversal`), `pos-payments.ts` (`pos.reversePayment`), `queries/pos.ts` receipt carries reversal, `shifts.ts` (`drawerOf` cash refunds, summary fields), `report.ts` (refunds, net), `_actions/pos.ts` export, cross-tenant TILL list, audit labels.
Tests: `tests/pos/refunds.test.ts` (all Review Focus 2 cases), shifts, report, cash-drawer.
- [ ] tests → implement → commit `feat(pos): payment reversal as a counter-entry, refunds in the drawer and reports`.

### Task 4: reversal UI
Files: `ReverseDialog.tsx`, `Receipt.tsx` (REVERSED stamp, button with `payment.refund` and online), `ShiftScreen.tsx`, `DailyReportView.tsx`, messages.
- [ ] browser check → commit `feat(pos): reverse from the receipt, refunds on the shift and the daily report`.

### Task 5: roles matrix and `pin.own`
Files: `domain/pos/permissions.ts` (`pin.own`, `roleMatrix()`), `RolesMatrix.tsx` on the staff page, messages, `tests/pos/permissions.test.ts`, snapshot tests.
- [ ] commit `feat(pos): read-only role matrix, pin.own permission`.

### Task 6: PIN and device services
Files: `src/server/domain/pos/pin.ts` (`isWeakPin`, limits, pure), `src/server/pos/pin.ts` (`setOwnPinIn`, `clearStaffPinIn`, devices, `resolveDevice`, `listPinStaff`, `verifyPin`), actions `pos.setOwnPin`, `pos.clearStaffPin`, `pos.registerDevice`, `pos.revokeDevice`, queries `pos.devices`.
Tests: `tests/pos/pin.test.ts` (Review Focus 1), cross-tenant.
- [ ] commit `feat(pos): staff PINs, shared devices, rate-limited PIN verification`.

### Task 7: PIN endpoint and screens
Files: `src/server/studio/auth/pin-plugin.ts`, `auth.ts` plugin, `http.ts` public route, `device-cookie.ts`, `_actions/pos.ts` cookie wrappers, `/pos/switch` page + `PinPad`, "My PIN" page, staff "Has PIN"/"Clear PIN", header "Switch user", messages.
Tests: `tests/pos/pin-route.test.ts`, http route allowlist test.
- [ ] browser check (ar/ckb/en, 375px) → commit `feat(pos): quick switch by PIN on registered devices`.

### Task 8: final settings
Files: settings page subscription line, `DevicesSection.tsx`, messages. Tests: query test.
- [ ] commit `feat(pos): subscription state and shared devices on the settings page`.

### Task 9: verification and review
Full `npx vitest run`, `npx tsc --noEmit -p .`, `npx eslint src`, browser pass, independent review, fix wave, `git diff --stat` CRLF check, final commit.
