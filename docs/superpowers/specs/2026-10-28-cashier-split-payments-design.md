# Cashier Batch 2: split and mixed payment, tips, comp, merge tables, shortcuts

Date: 2026-10-28. Branch `cashier-split-payments` (cut from `cashier-trust-controls` after PR #53).

## Why

A table of six wants to pay "half cash, half FIB", or each guest pays their own part. Guests leave tips. A manager gives a dish on the house. Two tables join into one. Today the till takes one method for the whole bill, has nowhere to put a tip, and has no honest way to give a dish free. Every international POS does these five things; a cashier without them is worked around with pen and paper, which is where money goes missing.

## Goals

1. **Mixed payment:** one bill paid with several methods in one go (cash 20,000 + FIB 15,000).
2. **Split by guest:** pay a chosen set of lines first, then the rest. Each part is its own payment event.
3. **Tips:** a tip typed at payment time, kept apart from sales, reported per person so the manager can pay it out.
4. **Comp (ضيافة):** a line or bill given free, with a reason and manager approval, shown in its own report line.
5. **Merge tables:** move all live lines of one open dine-in order into another; the emptied one is closed as merged.
6. **Keyboard shortcuts** on the order screen for the cashier at a PC with a scanner or numpad.

## Non-goals

- No card terminal integration and no payment gateway (manual payments only, as today).
- No split of a single line between guests (half a pizza). A line goes whole to one payment.
- No currency change, rounding or invoice numbers (Batch 3). No printing or drawer kick (Batch 4).
- No loyalty.

## Anti-goals

- Reports must still agree with each other: gross sales is the same number in the day report, the range report and every breakdown table, with or without splits.
- The cash drawer count must stay honest: expected cash counts only the cash that actually stayed in the drawer.
- A split must never lose or duplicate a line: the lines paid across all parts equal the lines of the bill, once each.

## Design

### Data

Keep `PosPayment` as the unit every report, shift and refund already reads, and let one order have several of them.

- Drop the unique index on `PosPayment.orderId`. Add `PosPayment.part Int @default(1)` with `@@unique([orderId, part])`.
- `PosPayment` gains `tipAmount Int @default(0)` (integer IQD, not part of `totalsSnapshot.total`).
- New child `PosPaymentLeg { id, restaurantId, paymentId, method PosPaymentMethod, amount Int, reference String? }`. One leg per method used in that payment. `PosPayment.method` stays and holds the method of the largest leg, so old code that reads it keeps working; `PosPayment.amountReceived` becomes the sum of the legs.
- `PosOrderLine.paymentId String?`: the payment that paid this line (null while unpaid). The lines of a part are the ones it carries; `totalsSnapshot.lines` lists only them.
- `PosOrder.status` becomes `PAID` only when every live line is paid. Until then an order with some paid lines stays open and shows "Paid 35,000 of 60,000".
- Enum `PosDiscountReason` gains `COMP`. A comp is a 100 percent discount with that reason; it always needs manager approval (the rule from Batch 1) even if the restaurant switched approval off for other discounts.
- `PosShift` figures: cash sales = cash legs minus change given; cash tips are counted in the drawer; card or wallet tips are not.

### Rules

- **Mixed payment:** legs must add up to the part's total plus tip. Cash may exceed the due amount and gives change, but only the cash leg may carry change. Non-cash legs are exact. A non-cash method must be switched on in settings.
- **Split:** the cashier selects lines; the part's total is computed from those lines with the invoice-level service, tax and discount spread in proportion (the last line takes the rounding), so the parts add up to the bill total exactly.
- **Tip:** typed per payment, never negative, at most the part's total (a tip above 100 percent is almost certainly a typo). It does not change `totalsSnapshot.total`, so sales reports stay clean; reports show tips as a separate column and the activity page lists them.
- **Refund:** reverses a whole payment part (as today). A mixed part is refunded back to the same methods leg by leg; the cash refund leaves the drawer, the others are recorded as owed back.
- **Merge:** both orders open, dine-in, same restaurant, neither has paid lines. Lines move with their kitchen state kept; the source is cancelled with reason "merged into No. N", no approval needed (nothing is discounted or lost), audit row on both orders. A manager may merge anything; a cashier may merge their own tables.
- **Shortcuts:** `/` focus the product search, `F2` open payment, `Esc` close the dialog, `Enter` confirm a dialog, digits on the amount field. Shown in a small help line on the order screen; they never fire while typing in a field.

### Reports

- Day and range reports: gross sales counts each payment part; refunds as today. A new "Tips" tile and a "Comps" line (cost of comped lines) appear.
- By-method table counts legs (so a mixed bill shows in both methods); orders column counts payments.
- Z report: tips total and comps total added; cash difference formula uses the drawer rule above.

## Calls I made (change any of them)

1. Several payments per order (`part`), not a separate "split bill" entity: every existing report and the shift close keep reading `PosPayment`.
2. A tip is outside the bill total, so sales figures never include it.
3. A comp is a 100 percent discount with reason `COMP`, not a new kind of line.
4. Merging needs no manager approval, but unpaid orders only.
5. A line is never split between guests.

## Review focus

- A bill paid in three parts, then one part refunded: day report, range report, breakdown and shift expected cash all agree.
- Mixed payment with cash change: the drawer gets cash received minus change only.
- Two cashiers paying different parts of the same table at once: no line paid twice (lines carry `paymentId`, locked inside the transaction).
- Offline: a split or mixed payment queued offline replays correctly; if a line was paid elsewhere meanwhile it is refused, not duplicated.
- Merge of an order that the kitchen already received: tickets follow the lines.
