# Cashier batch 1: trust controls and accountability reports

Branch `cashier-trust-controls`. Source: the 2026-10-27 audit of the Menu POS (`src/app/pos`, `src/server/pos`) against international POS practice. The user asked for all audit gaps to be built in batches; this is batch 1. Batches 2 to 4 (split and mixed payment, IQD/USD and tax invoice, printing and kitchen expo) and the loyalty program come later and are out of scope here.

## Why

A cashier can today discount without giving a reason, a cashier's discount or cancel needs no manager, the shift close shows the expected cash before the cashier counts, and the owner has no screen that shows what staff did. A restaurant owner cannot trust the till without these. Reports by hour, item and staff, and a CSV export, are what an owner asks for first.

## Goals

1. **Reason on every discount.** Line and invoice discounts require a reason (a short list plus free text), stored and audited.
2. **Manager approval at the till.** A cashier's discount, line cancel, order cancel and refund can be approved on the spot by a manager or owner typing their own PIN, without signing the cashier out. A manager acting alone needs no second approval. The approver is recorded next to the action.
3. **Blind cash count.** The close-shift screen does not show the expected cash until the counted amount is submitted. After submit it shows expected, counted and the difference.
4. **X and Z reports.** X is the live report of the open shift (no side effects). Z is the report of a closed shift, numbered in sequence per restaurant (Z-1, Z-2, ...), fixed once the shift is closed, reprintable.
5. **Reports by hour, item, staff and payment method** for a date range, with CSV export.
6. **Idle sign-out.** A till session that has been idle for a time set in settings (default 15 minutes, off allowed) returns to the PIN switch screen. No data is lost: an open order stays on its table.
7. **Owner view of sensitive actions.** A page listing discounts, cancels, refunds, over/short differences and failed PINs from the audit log, newest first, filter by staff and type.

## Non-goals

No split or mixed payment, tips, comp, merge (batch 2). No second currency, tax invoice fields or invoice series (batch 3). No printer or hardware work (batch 4). No rule-based fraud alerts or push notifications to the owner. No new motion anywhere in the cashier. No change to the Studio menus or the public menu.

## Anti-goals (a failure even if it works)

- Approval that can be skipped by calling the action directly. The check lives in the server action, not only in the UI.
- A PIN or approver secret stored or logged anywhere new.
- Reports that disagree with the existing daily report on the same data.
- Anything slower than three taps for the normal cashier path: approval appears only when needed.
- Touching the shared dev database on port 54329.

## Constraints

- Follow `docs/superpowers/specs/2026-10-23-cashier-design.md` and the Studio action framework (`defineAction`, `ctx.transaction`, `ctx.audit`, tenant db).
- Three languages with RTL: every new string in `src/studio/messages/{en,ar,ckb}.ts`.
- Schema change by a Prisma migration, developed on this worktree's own database port only.
- Tests first (vitest, `tests/pos`), including cross-tenant checks for every new query.
- Cashier styles differ by layout, not colour; no motion.

## Design decisions

These are my calls; the user has not reviewed them.

- **Approval.** New helper `verifyApproverPin` in `src/server/pos/pin.ts` reusing the existing hashing, the per-staff lock and the attempt counters, but it writes an audit row `pos.approval.ok` / `pos.approval.fail` and creates no session. Only OWNER or MANAGER staff of the same restaurant, with a PIN, can approve. Actions take an optional `approval: { staffId, pin }`. When the actor is a CASHIER and a restaurant setting `requireApproval` (default on for discount, cancel and refund) applies, a missing or wrong approval is refused with a distinct error the UI turns into a PIN prompt.
- **Reason.** Discount reasons are an enum (`MANAGER_DECISION`, `REGULAR_GUEST`, `COMPLAINT`, `STAFF_MEAL`, `OTHER`) plus optional note; `OTHER` requires a note. Stored on the discount rows added by migration.
- **Z number.** New integer `zNumber` on the shift, assigned at close inside the close transaction from a per-restaurant counter row (`PosCounter`), unique per restaurant. Shifts closed before the migration stay without a Z number and show as "before numbering".
- **Blind count.** Server: the shift view for an open shift omits `expectedCashAtClose`; close returns it. UI: `ShiftScreen` shows the form first, then the result.
- **Reports.** Extend `src/server/pos/report.ts` and `range-report.ts` with grouped queries (hour in the restaurant's time zone, item, staff, method). CSV is a server route that streams the same data, with a formula-injection guard on cells that start with `=`, `+`, `-`, `@`.
- **Idle.** A client-side timer in the till layout reading `idleMinutes` from settings; on expiry it calls the existing sign-out-to-switch path for PIN devices and the sign-out for password sessions.
- **Owner page.** `src/app/pos/(till)/activity` reads `AuditLog` rows whose action starts with `pos.` in a fixed list of sensitive actions; permission `report.view`.

## Left to the builder

Exact table and column names, the shape of the approval dialog, pagination size, CSV column order, and the Arabic and Kurdish wording (reviewed by the user).

## Done means

All new code has tests written first and passing; `npm run typecheck`, lint on `src`, and the full `tests/pos` suite pass; the flows are checked in the browser against this worktree's own server and database; a code review of the diff is done; a PR is opened from `cashier-trust-controls`.
