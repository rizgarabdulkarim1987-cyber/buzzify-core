# Pharmacy cashier screen and fast product entry: design

Date: 2026-11-05. Status: draft for approval. Nothing is built.

Prototypes, committed so no design detail is lost (single-file HTML, open in a browser; not product code, not to be copied):
- `docs/pharmacy/prototypes/cashier-layouts-2026-11-05.html`: the cashier screen, layout A approved by the owner. Contains the full simulation: unit button, inline flows, receipt tabs, roles, drawer rules, shift totals, inquiry, hotkeys.
- `docs/pharmacy/prototypes/product-entry-2026-11-05.html`: the fast product-entry screen.

**The prototypes are the source of truth for every detail** (labels, column order, button wording, messages, field order, behaviours). Where this document is shorter than the prototype, the prototype wins. The builder must read both before planning, and the plan must list any prototype behaviour it leaves out.

## Why

A pharmacist friend of the owner uses a competitor program (SpCashier). Two things impressed them: the detailed sale-lines table on the cashier screen, and (as a contrast) how long product entry is in that program. The owner wants the same strengths inside Buzzify Pharmacy, looking more professional, and a much shorter product-entry path.

## Goals

1. **Cashier screen**: nearly all sale work on one screen, no popups, fastest possible, everything close to the cashier.
2. The same buttons and labels as the competitor program (the pharmacist already knows them), in a cleaner design.
3. The screen is also for **price inquiry**, not only sale.
4. A **button that converts the sale unit** (tablet / strip / packet). Never a dropdown.
5. Several **open receipts as tabs**: a new sale never closes the current one.
6. **Fast product entry** on one screen: scan, then either add a batch (known product) or fill one form (new product), with the product's history underneath.

## Non-goals

- AI Doctor: postponed (branch `pharmacy-ai-doctor`, untouched).
- No motion in the cashier (existing rule). No dialogs or popups on the cashier or entry screen.
- No payment gateway; manual payments only (existing rule).
- Replacing the other pharmacy screens (purchasing, returns, reports) is out of scope.

## Anti-goals (would make it a failure even if it works)

- A flow that needs a dropdown for the unit, a modal, or leaving the screen mid-sale.
- A new product needing more than four fields before it can be saved.
- Layout that breaks when the cashier is a cashier (price edit, cost and profit visible to the wrong role).

## Cashier screen (layout A)

Grid, right-to-left: header strip across the top; toolbar row; below it a **side column (370px)** and the **main column**. The page is RTL, so with `grid-template-areas: "side main"` the side column sits on the physical RIGHT. It holds the total box (amount due, USD equivalent, discount, item count, balance), customer and receipt number, and the **keypad and payment buttons**. The owner required the keypad on the right because most people use the right hand. Keypad digits read 1 2 3 left to right (`direction:ltr` on the keys). Verify on screen that the keypad is physically at the right.

Layouts B (keyboard-first) and C (dark) exist in the prototype for comparison only; A was chosen and B/C are not to be built.

Main column, top to bottom: **receipt tabs**, scan/search field with the unit button and the price-inquiry button beside it, an inline message line, the **sale-lines table**, then three panels: batches (nearest expiry first), item details, substitutes by active ingredient.

Header strip (replaces the competitor's large logo and name banner, which the owner rejected as wasted space): cashier/till and role, exchange rate, and live chips: shift sales, receipts done, cash in drawer, near-expiry count, low-stock count (both red, clicking one fills the search with that product), clock. The pharmacy name is a small label.

### Sale-lines table (the part the owner likes most)

Columns: row, item code, item name, qty, unit, unit price, line total, discount, unit price after discount, line total after discount, batch (lot), expiry, balance. Cost and profit columns exist but show only for pharmacist and owner. Row selection with arrow keys; `+`/`-` change quantity; `Delete` removes.

### Unit button

One button beside the search field cycles tablet → strip → packet for the selected line (or the next scanned item if no line is selected). Price per unit comes from the product's unit ladder (price per tablet, tablets per strip, strips per packet). Stock checks use tablets.

### Modes

Sale, return (a return slip prints, the drawer does not open), and price inquiry (shows price, stock, batches, substitutes, adds nothing to the receipt unless the user chooses to).

### Inline flows (replace every dialog)

A work panel in the left/main area switches between: idle, cash, credit, refund, discount, held receipts, all operations, calculator, receipt preview. Destructive actions use a two-tap "arm" button, not a confirm dialog. Messages appear in an inline line, not toasts.

### Receipt tabs

Bar above the table: one tab per open receipt showing number, running total and item count. `+` or F4 opens a new receipt; the current stays open. Switch by click, Alt+1..6 or Alt+Left/Right. Each tab keeps its own lines, selection, customer and discount. Maximum 6. A receipt with items cannot be closed by its tab's X (finish, hold or discard it first). After payment the tab shows done and is replaced by a fresh receipt when used. "Held" receipts (F8) remain for long parking and show in the toolbar with a count.

### Business rules to reproduce

- Prescription items need pharmacist or owner confirmation before payment.
- Expired batches cannot be sold. Quantity over batch stock blocks payment.
- Price edit only for pharmacist and owner; cost and profit columns only for them.
- The cash drawer opens only for an original sale with a cash part (not a copy, not a refund, not card-only). A credit sale with a limit and a partial cash payment opens it for the cash part.
- Shift totals (cash, credit, card, returns) always visible in a footer line.
- Substitutes are matched by active ingredient.

### Hotkeys

F2 cash, F3 credit, F4 new receipt, F6 or `*` cycle unit, F7 inquiry, F8 hold, F9 receipt discount, `/` focus scan, Esc back, Alt+1..6 switch receipt.

## Fast product entry

One screen: a large scan field; a status line that says whether the product is known or new; a form; the product history; and a side list of what was entered in this session.

- **Known product**: summary (stock, last purchase price, current selling price, last supplier) and a six-field batch form: quantity (packets, required), expiry month/year (required, typed as digits, becomes MM/YY), purchase price per packet (required, pre-filled from the last purchase), selling price (pre-filled), lot number (optional), supplier (pre-filled).
- **New product**: one form with four required fields (name, selling price per packet, quantity, expiry) and, on the same screen, the optional ones: purchase price, strips per packet, tablets per strip, needs prescription, active ingredient (feeds substitutes), supplier, low-stock threshold, lot.
- **History under the form**: three tables, purchases, sales, returns, for the scanned product.
- Enter moves to the next field; Enter in the last field or F2 saves; Esc clears. After saving, the scan field is empty and focused for the next product. Expiry in the past or malformed is rejected with a message naming the field.

## Constraints

- Follow the pharmacy project rules in `CLAUDE.md`: no motion, RTL, ar/ckb/en messages in `src/studio/messages/pharmacy/`, 44px touch targets, the pharmacy audit guard that forbids fields named address or phone and similar.
- Cashier and entry screens follow existing pharmacy design tokens, not the prototype's colours.
- Existing routes to build on or replace: `src/app/pharmacy/(app)/sell`, `.../catalog/new`, `.../stock/receive/new`, `src/app/pharmacy/_ui/ProductEditor.tsx`, `UnitLadderEditor.tsx`. The builder decides replace versus extend.

## Decided by the owner

Layout A. Keypad on the physical right. Unit as a converting button. No popups. Receipt tabs. No big logo or name banner. Entry as one screen with history. Prototype first, offline.

## My calls (owner to confirm)

- Receipt tabs max 6; a receipt with items cannot be closed with X.
- Expiry accepted as month/year only, last-day-of-month semantics, and must not be before the current month.
- Entry quantity is counted in **packets**. If the owner enters by strip or tablet, the form needs a unit toggle like the cashier's.
- Header chips use a 90-day near-expiry window and a threshold of 5 packets for low stock (new products get a per-product threshold).
- Strip and packet counts, lots, suppliers and prices in the prototypes are placeholders.

## Decided after the builder check

- **Currency (owner, 2026-11-05).** The customer does not pay in USD. The USD figure and the exchange rate in the header are display only. The pharmacist can change the rate in settings. No currency toggle in the payment panel; shift and drawer totals stay in IQD. Purchase prices are in USD as in the prototype.

## More calls made after the builder check (owner to confirm)

- **The new cashier replaces `/sell` (owner decision, 2026-11-05).** The owner rejected keeping the old screen alongside: the new page takes over the sell route. The old sell tests are migrated to the new screen, not kept as a parallel path. The multi-receipt state is new state, not a patch on the old cart reducer, but it reuses the existing pricing, stock, shift, payment and prescription logic. The builder plans the swap so nothing the old screen does is lost (shift gating, draft cart, prescription recording, payment and discount drafts).
- **Unit prices.** An explicit per-unit price on a product (existing `priceMinor`) always wins. Otherwise the price derives from the packet price through the unit ladder, with a rounding rule the builder picks for IQD (no fractions). The unit button skips units that are not sellable or have no price.
- **Entry and permissions.** The selling-price field on the entry screen is read-only for a user without the existing `price.change` permission; a price set by entry writes the normal price-history row. A new product from entry gets defaults for everything beyond the four required fields (category, unit names); the builder picks defaults that the catalog validation accepts.
- **Entry documents.** One entry session is one draft receiving document in the existing stock-receive model, posted when the user presses finish. It does not create one posted receipt per product. Supplier is a link to a supplier record (it affects payables), pre-filled from the last purchase.
- **Open receipts.** Tabs are stored on the device per till and user, reuse the existing draft-cart storage approach, and survive a reload. Held receipts (F8) use the same storage. Stock is checked at payment, not reserved.
- **Returns.** Return mode is a return against an original sale (lookup, same batch and price, quantity cap), routed to the existing returns logic. A return without an original sale needs pharmacist or owner approval. Contents of "all operations" route to existing screens.
- **Keys.** In the search field the scanner wins; `*`, `/`, `+`, `-` act as hotkeys only when focus is not in a text field, except `*` and `/` on an empty search field. Alt+1..6 is best effort where the browser reserves it; Alt+Arrow and clicking always work.
- **Locales.** Arabic wording in the prototype is final; Kurdish and English are straight translations by the builder, placed in `src/studio/messages/pharmacy/`.
- **Chips.** Near-expiry and low-stock are computed on the server. Low stock uses the product's existing reorder level; 5 packets is only the fallback. Near-expiry window is 90 days unless the pharmacy already has a setting.
- **Server-side gating.** Cost, profit and price edit are enforced on the server, not only hidden in the UI. The prototype's role dropdown is simulation only; the real role comes from the session.

## Left to the builder

Data model changes (batches, unit ladder, receipt drafts), whether open-receipt tabs persist across reloads, server actions, tests, and how the cashier and entry screens are routed and permissioned.

## Not yet decided

- How a pharmacist confirms a prescription item at a cashier's till (PIN on the same till, payment pauses until the pharmacist signs in, or prescription number only). Builder records it as an open point.
- Whether the cashier runs on tablets (needs a collapsed layout) or desktop only.
- Whether every customer runs Windows (affects the print/drawer bridge, separate from this work).
- Return flow detail beyond mode, slip and no-drawer.
- "All operations" menu contents: display-only in the prototype.
- Touch and small-screen behaviour of the cashier (prototype untested there).
