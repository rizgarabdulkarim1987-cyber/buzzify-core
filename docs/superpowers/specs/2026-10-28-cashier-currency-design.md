# Cashier batch 3: rounding, dollars and invoice details

Date: 2026-10-28. Branch `cashier-currency`. The user asked to continue after Batch 2 and not to be asked each step, so every open choice below is my call and is marked **(call)**.

## Why

Iraqi tills take dinars and often dollars, nobody hands back 1 dinar of change, and a receipt must carry the business's own name and tax details. Today the till prices in whole dinars, takes only dinars, and prints no business details.

## Goals

1. **Rounding.** A restaurant can choose a rounding step (off, 250, 500 or 1000 IQD). The payable total of a bill (or of one guest's part) is rounded to the nearest step, half up. The difference is stored as `rounding` and printed on the receipt.
2. **Dollars.** A restaurant can switch on cash in US dollars with a rate (IQD per 1 USD). A guest pays all or part of a bill in dollars; the till shows the dollar amount to take and the dinar change to give back.
3. **Invoice details.** The restaurant sets the name, address, phone, tax number and a footer line that print on every receipt. Old receipts keep what they were paid with.

## Non-goals

No live exchange-rate feed. No other currencies. No dollar change (change is always in dinars). No per-product dollar prices. No tax-authority export or fiscal printer.

## Decisions

- **Rounding applies to the payable total only (call).** `snapshot.total` becomes the payable amount; `snapshot.rounding` (signed whole IQD, default 0) records what the step added or took, so `subtotal - invoiceDiscount + service + tax + deliveryFee + rounding = total`. Old snapshots have no `rounding` and read as 0. Reports sum `total` as before, so gross sales is what the till actually collected; a new report line shows the rounding total.
- **Each split part rounds on its own (call).** A guest pays a round amount; the parts still add up to the rounded whole only when rounding is off, which is accepted and shown in the receipts. The last part is not forced to fix the others' rounding.
- **A comped or zero bill never rounds.** Rounding runs only when the total is above 0.
- **Dollars are one more payment method, `CASH_USD` (call).** Its leg stores `amount` (the dinars it covers), `tenderedUsd` (whole dollars handed over), and `rate` (frozen at payment). Dollars needed = the covered dinars divided by the rate, rounded up to a whole dollar; the guest may hand over more, and the overpayment comes back in dinars from the dinar drawer at the same rate.
- **The drawer counts two currencies (call).** Expected dinar cash excludes dollar legs but includes the dinar change paid out for them. Expected dollars = the sum of `tenderedUsd`. Closing a shift asks for a counted dollar amount only when the restaurant has dollars switched on; the difference is stored beside the dinar one.
- **Refunds of a dollar leg go back in dollars at the frozen rate (call)**, from the dollar drawer of the person reversing.
- **Rate changes never touch old payments.** Rate is edited in settings by managers and owners, and audited.
- **Invoice details are settings, not per-payment data (call).** The receipt reads the current settings, except the tax number printed on a receipt is frozen in the snapshot at payment so a later edit never rewrites a tax document.

## Data

- `PosSettings`: `roundingStep Int @default(0)`, `usdEnabled Boolean @default(false)`, `usdRate Int @default(0)`, `invoiceName`, `invoiceAddress`, `invoicePhone`, `invoiceTaxNumber`, `invoiceFooter` (strings, default empty).
- `PosPaymentMethod` gains `CASH_USD`. `PosPaymentLeg` gains `tenderedUsd Int?` and `rate Int?`.
- `PosShift` gains `countedUsd Int?`, `expectedUsdAtClose Int?`, `differenceUsd Int?`.
- Snapshot gains `rounding` and `taxNumber` (both optional on read).

## Phases

- **A. Rounding and invoice details** (low risk): settings, `roundTo(total, step)` in the domain, payOrderIn and partTotals apply it, receipt and reports show it.
- **B. Dollars**: method, leg fields, change in dinars, drawer and shift close, reversals, reports by currency.

## Review focus

- A bill of exactly a multiple of the step, a total below half a step, and half-up on the step boundary.
- A split bill with rounding on: each part's total is a multiple of the step and nobody pays more than their lines plus half a step.
- Dollar overpayment: change in dinars is never negative and the drawer stays balanced.
- A rate of 0 or a changed rate between sending a screen and paying (the server uses its own rate and refuses a mismatch shown on the screen).
- Old payments with no rounding or dollar fields read exactly as before in every report.
