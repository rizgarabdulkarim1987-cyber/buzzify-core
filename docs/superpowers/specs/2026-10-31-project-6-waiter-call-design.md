# Project 6, part 1: call a waiter (`table.callWaiter`, Pro)

First item of project 6. Decisions marked **[call]** are mine.

## What it is
A guest who scanned a table's QR and sees ordering open gets a second button beside "Ask for the bill": "Call a waiter". The floor sees it in the same list as bill requests, labelled "Table N asks for a waiter", and one person marking it seen clears it for everyone.

## Rules
- Same gate as the bill: QR ordering on at that table, cashier subscription live, table exists. A plan without `table.callWaiter` answers 404 and the button is not shown. **[call]** Pro and Premium have it; Basic does not.
- Same limits as the bill, counted apart per kind: an unseen call of that kind is not repeated, and at most three per table in ten minutes (then 429). **[call]** A bill and a waiter call can be open together.
- A waiter call touches no order (the bill call moves the order to `BILL_REQUESTED`).
- **[call]** Stored in `PosBillCall` with a new `kind` column (`BILL` default, `WAITER`), not a new table: the cashier and captain lists, badges, expiry and seen-by-one already work on it. The audit action stays `pos.billCall.call`; a waiter call adds `kind` to its changes.
- The cashier's list title becomes "Calls from tables" (three languages). No motion is added to the cashier.

## Out of scope
Other project 6 items (loyalty, share cards, TV board, limited drops, seasonal particles, WhatsApp) are separate parts.
