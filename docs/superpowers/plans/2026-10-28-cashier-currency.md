# Cashier Batch 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline). Steps use checkbox syntax. TDD: each task's test fails first.

**Goal:** Rounding of the payable total, cash in US dollars, and business details on the receipt.

**Architecture:** Settings drive everything. A pure `roundTo` in the domain feeds `payOrderIn` and `partTotals`; dollars are a payment method `CASH_USD` whose leg freezes the rate; the drawer and shift close count dollars apart.

**Tech Stack:** Next.js, Prisma 7 (hand-written migrations), vitest with `tests/pos/fixture.ts`, Studio actions.

**Spec:** `docs/superpowers/specs/2026-10-28-cashier-currency-design.md`

## Global Constraints

- Whole integer IQD everywhere; USD in whole dollars; rate is whole IQD per 1 USD.
- Every new thrown English text is in `POS_TEXT` and the three `pos-till` catalogs; new action names go in the cross-tenant table; new audit actions in `audit-actions.ts` with `activity.action.*` labels.
- A migration that backfills or alters an index goes in the `POS_ONLY` set of `tests/pharmacy/migration-additive.test.ts`; additive ones need nothing.
- Old snapshots and legs without the new fields read exactly as before.

## Review Focus

- Total on a step boundary, below half a step, and zero bill (never rounded).
- Split bill with rounding: every part a multiple of the step.
- Dollar overpayment gives dinar change, never negative; drawer balances in both currencies.
- Rate 0 or changed between screen and payment is refused.
- Old payments read unchanged in every report.

---

## Phase A: rounding and invoice details

### Task 1: Settings and rounding rule
**Files:** `prisma/schema.prisma` + migration `20261028200000_cashier_currency_settings` (additive: `PosSettings.roundingStep/usdEnabled/usdRate/invoiceName/invoiceAddress/invoicePhone/invoiceTaxNumber/invoiceFooter`); create `src/server/domain/pos/rounding.ts` (`roundTo(total: number, step: number): { total: number; rounding: number }`); extend `src/server/pos/settings.ts` and its action; test `tests/pos/rounding.test.ts`.
- [ ] Test: step 0 returns the total and 0; 250 rounds 10,124 to 10,000 (-124) and 10,125 to 10,250 (+125); a multiple of the step is unchanged; total 0 stays 0; negative step or non-integer refused by the settings action.
- [ ] Run FAIL; implement; run PASS; commit `feat(pos): rounding rule and currency settings`.

### Task 2: Rounding at payment
**Files:** `src/server/pos/payments.ts`, `src/server/pos/totals-snapshot.ts` (`rounding`, `taxNumber` optional), `src/server/domain/pos/split.ts` (part total rounded); test `tests/pos/rounding-payment.test.ts`.
- [ ] Test: with step 250 a 10,124 bill is paid as 10,000 and the snapshot has `rounding -124`; `expectedTotal` is the rounded total; legs must add up to it; split parts are each a multiple of 250; reports sum the rounded total and show `roundingTotal`; zero bill unchanged; old snapshot reads rounding 0.
- [ ] FAIL; implement (round after the components are known, before `expectedTotal` is compared; `OrderView.totals` and `leftToPay` show the rounded amount); PASS; run `tests/pos`; commit.

### Task 3: Rounding and business details on screens
**Files:** pay dialog total, `OrderScreen` totals row "Rounding", `Receipt.tsx` (rounding line, business header and footer, frozen tax number), settings screen fields, messages en/ar/ckb; test `tests/pos/receipt-details.test.ts`.
- [ ] Test the receipt data: details present, tax number from the snapshot not from later settings. FAIL; implement; PASS; typecheck and eslint; commit.

## Phase B: dollars

### Task 4: Schema for dollar legs and shift counts
**Files:** schema + migration `20261028210000_cashier_usd` (enum `CASH_USD`, `PosPaymentLeg.tenderedUsd/rate`, `PosShift.countedUsd/expectedUsdAtClose/differenceUsd`); update `POS_PAYMENT_METHODS`; test `tests/pos/usd-schema.test.ts`.
- [ ] Test the columns round-trip. FAIL; migrate, generate; PASS; commit.

### Task 5: Taking dollars
**Files:** `src/server/pos/payment-legs.ts`, `payments.ts`, the pay action; test `tests/pos/usd-payment.test.ts`.
- [ ] Test: bill 15,000 at rate 1,500 paid with `CASH_USD` and 10 dollars gives amount 15,000, tenderedUsd 10; 12 dollars on a 15,000 bill gives dinar change 3,000; part dollars part dinars adds up; refused when dollars are off, rate is 0, tendered dollars cover less than the leg, or the screen's rate differs from the server's.
- [ ] FAIL; implement `checkLegs` for the dollar leg (dollars needed = ceil(amount / rate)); PASS; commit.

### Task 6: Drawer, shift close, refunds, reports in two currencies
**Files:** `shifts.ts` (`drawerOf` adds `usdSales`, `usdRefunds`, expected dollars; dinar expectation includes dinar change given for dollar legs), close action (`countedUsd` required only when dollars are on), `refunds.ts` (dollar leg refunded in dollars at the frozen rate), `report*.ts` (by-method includes `CASH_USD`, a dollars-handed-over line); test `tests/pos/usd-drawer.test.ts`.
- [ ] Test: expected dinars and dollars after a mixed sale and after its reversal; closing without counted dollars is refused when dollars are on; difference stored. FAIL; implement; PASS; `tests/pos` green; commit.

### Task 7: Dollar screens
**Files:** `PayPanel.tsx` (dollar row with the dollars to take and the dinar change), `src/lib/pos-pay-legs.ts` (`usdDue(amount, rate)`), shift close dialog field, settings fields, messages; test `tests/pos/pay-usd-model.test.ts`.
- [ ] Test the helper (ceil, rate 0 refused); FAIL; implement; PASS; typecheck, eslint; commit.

## Task 8: Whole-batch verification
- [ ] `npm run typecheck`, `npx eslint src`, `BUZZIFY_DB_PORT=54351 npm test` (only the known `ai-import` enforcement failure allowed).
- [ ] One Opus whole-branch review, one fix pass (each fix RED then GREEN), push, PR via browser (ask before pushing).
