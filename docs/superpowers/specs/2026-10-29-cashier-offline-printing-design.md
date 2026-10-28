# Cashier: printing and the drawer while offline

Status: written by Claude on the user's instruction "finish everything left in the cashier" (2026-10-29); every decision below is mine and listed so it can be overruled.

## Why

Batch 4 prints silently through the local print bridge, but only for the online till. The offline till (a service worker plus a queue of operations replayed later, `src/lib/pos-sync/*`, `src/app/pos/_ui/sync/*`) still uses `window.print()`, never prints a kitchen ticket and never opens the drawer. A restaurant whose internet drops at lunch is exactly the one that needs paper and an open drawer.

## What makes this possible

The bridge runs on the till PC or the local network, so it works with no internet. Everything a paper needs is on the device or can be put in the offline snapshot: the order lines, the totals, the restaurant's details and the printers. Printing is a client-side job that never touched the server except for audit rows, so the only server work left is recording what happened.

## Goals

1. **Receipt.** An offline cash sale prints the receipt through the bridge and opens the drawer, exactly as online, marked as provisional.
2. **Kitchen.** Sending an order to the kitchen offline prints the round on each section's printer, with the same cancellation-slip rules as online.
3. **Manual drawer and copies.** "Open drawer" (with a reason) and "Print a copy" work offline and leave an audit row when the device syncs.
4. **No change to the online till** and no change to how an offline sale itself is queued or replayed.

## Non-goals

- Queueing a print job that failed (bridge off) beyond the screen's own "Retry"; the offline order list can always reprint.
- Printing the shift report offline (it is closed online).
- Card/e-wallet payments offline (the offline till takes cash only, unchanged).

## Decisions

- **Snapshot grows by two fields (call).** `SyncSnapshot.printers: PrinterView[]` and `SyncSnapshot.business: { name, address, phone, taxNumber, footer }`, both read when the snapshot is built and stored with it. Old snapshots without them print nothing and fall back to the browser (the field is optional on read).
- **Provisional receipt (call).** The offline receipt is built by `offlineReceiptDoc` from the local order: it carries the provisional number (`P-ABCD-3`) and a line "Provisional, final number after sync" in all three languages. After sync the receipt page shows the final number; printing it again from there is a normal copy.
- **Drawer (call).** The same rule as online (`drawerShouldKick`): the sale opened the drawer if any leg was cash. A cash offline sale is always cash, so it opens. The kick is not audited separately for a sale, as online.
- **Kitchen tickets (call).** `kitchenDocs` is reused: the offline round is adapted into a `KitchenTicket` (sections come from the catalog already in the snapshot). Cancellation slips follow the existing `printedSlips` memory in `localStorage`.
- **Audit on replay (call).** Two new queueable operation kinds, `drawerOpen { reason }` and `receiptCopy { orderRef }`. The server writes `pos.drawer.open` and `pos.receipt.reprint` when it applies them (the operation row keeps the device's time). Replaying prints nothing (printing already happened at the till). Both are idempotent by `operationId` like every operation.
- **Never block a sale (call).** A print failure shows the translated bridge/printer text with Retry and "Print with the browser", and the sale stands.

## Review focus

- An order with 60+ character Arabic names printed offline (same wrapping as online).
- Bridge off at the moment of sale: the sale is queued, the message shown, the drawer not kicked, the receipt reprintable.
- A device with an old snapshot (no printers): no crash, the browser print path as today.
- Replaying a `receiptCopy` for an order the server never saw: `unknownRef`, the queue panel says so and the row is kept for attention, not dropped.
