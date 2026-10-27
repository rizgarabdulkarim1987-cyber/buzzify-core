# Menu POS: the ten calm layouts

Status: approved by the owner on 2026-10-26 ("ديلا كمل" after the port design was described in chat).

## Why

The ten calm layouts were first built in the separate `buzzify-restaurant` cashier
(`buzzify-restaurant/docs/superpowers/specs/2026-10-26-cashier-calm-layouts-design.md`, approved the same day). That app is
not deployed. The cashier the owner actually uses is this one, the Menu app's POS at `studio.buzzify-menu.online/pos`.
This port brings the same ten arrangements here. That spec is the source for the layouts, the calm base and the press
rules; this file records only what differs here.

## Same as the source spec

- The ten layouts and their ids: `tiles` (default), `strip`, `register`, `keypad`, `dock`, `groups`, `order`, `zones`,
  `night`, `slips`.
- Square tiles fitted to the box. Colour only where the cashier must act: info blue = new QR order, danger red = bill
  asked for, success green frame = food ready, busy = quiet grey.
- "Waiting for you": tables with a QR request, then bill asked for, then food ready.
- In `tiles`, `register`, `dock` and `night` the first press on a busy table selects it (its bill shows). A second
  press, or "Open order", opens the order; "Pay" opens it on the payment step (`?pay=1`). Escape clears the selection.
- `order` adds a rail of every table beside the order page.
- No motion anywhere in the till shell.

## Different here

- **Where:** `/pos/tables` only (the tables tab; takeaway and delivery tabs keep their board). The picker is a header
  button with a visible label, "Screen layout" / «ترتيب الشاشة» / «ڕیزبەندی شاشە», shown to roles that handle orders.
- **Choice per device:** cookie `pos-layout`, one year, read on the server.
- **Fixed screen:** from `lg` up, the till shell is one screen and the tables page fits it with no scroll. Below `lg` the page
  may scroll (the owner: phone scroll is fine, desktop scroll is not). Other till pages scroll inside the main area.
- **Colours:** the Studio's own tokens (`--s-*`); `night` redefines them dark while the tables page shows it.
- **Words:** new keys under `pos.calm.*` and `pos.layout.*` in `src/studio/messages/pos-till/{ar,en,ckb}.ts`.
- **Press rules kept from this POS:** a table with a waiting QR request goes to `/pos/requests`; a free table opens a new
  order (`openPosOrder`); a busy table opens its order.
- **Board data:** `readBoard` adds each open table's live lines (`{ name, quantity }`, cancelled lines left out); it already
  loads them.

## Claude's calls

- The time ring around busy tables is gone with the circles. The table's time shows as text and turns red once it passes
  the owner's "table ring minutes" setting, so that setting still means something.
- The side column's "+ Takeaway" / "+ Delivery" are links to those tabs, where the existing new-order form lives.
- `zones` shows takeaway and delivery orders as a row of cards that open the order.
