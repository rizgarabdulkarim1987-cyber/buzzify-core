# Project 5: order together at the table

Roadmap project 5 (plans spec 4.2: `ordering.tableBasket`, Premium, "order together at the table"). The user asked for the whole
roadmap in order with no questions; each decision of mine is marked **[call]**.

## Intent

Four friends at a table each browse the menu on their own phone. Today each phone has its own cart and one person has to collect
everything and send it. With the table basket every guest adds dishes from their own phone into one shared basket for the table,
everyone sees what the others added, and any one of them sends it to the cashier as a single order.

## Goals

- Guests who scanned the same table code share one basket. Each guest's own cart is their part of it; everyone sees all parts.
- One tap by any guest sends the whole basket as one order request, through the existing path (`submitCustomerOrder`): the server
  prices it again, the table's limits apply, the cashier (and captain) approve it as today. All phones then follow its state.
- It is a plan feature (`ordering.tableBasket`, Premium). Without it the menu behaves exactly as today: one device, one cart.
- It needs nothing from the guest: no account, no name (a name may be given, "Guest 2" otherwise).

## Non-goals

- Paying together or splitting the bill (manual payments only, no gateway).
- Merging with a table's earlier orders, or changing an order after it is sent.
- Bundles in a table order (the existing QR order refuses them; so does this). **[call]**
- Real-time push: guests see each other within a few seconds by polling, like the order status does today. **[call]**

## Anti-goals

- A guest must never change or remove another guest's items. Each phone writes only its own part.
- Nothing a phone sends may set a price: only ids, quantities and notes are read, as in the QR order.
- A table of one restaurant must never read or write another restaurant's basket.
- A plan without the feature must never see the basket (the endpoints answer as if there were none).

## Design

- **Data.** `TableBasketPart` (menu scoped): `menuId`, `tableNumber`, `ownerKey` (SHA-256 of a random token the phone keeps, so the
  token itself is never stored), `name`, `lines` (JSON: product, size, options, quantity, note), `updatedAt`, and `sentPublicId` /
  `sentAt` once its lines went into an order. One row per guest per table; unique on (menu, table, owner key).
- **Rules (pure).** A part is live for 3 hours after its last change; at most 12 guests per table; at most the QR order's line cap
  across all parts; a sent part is kept 30 minutes so every phone can follow the order, then ignored.
- **API** under `/api/[tenant]/table-basket`, behind the same gate as QR ordering plus the plan feature:
  `GET ?table=&token=` the live parts (each marked `mine`), with names and prices taken from the catalog, the total, and the last
  sent order's id; `PUT` replaces the caller's own part (empty lines remove it); `POST /send` builds one order from every live
  part and submits it, marks the parts sent, returns the order's public id.
- **Guest page.** On a scanned table with ordering open and the plan feature, the send panel becomes the table panel: the caller's
  cart syncs to their part, everyone's items are listed by guest, and the send button sends for the table. The existing status
  follow-up and "bill" button are reused.
- **Entitlements.** `ordering.tableBasket` goes live (project 5, still Premium); the guest features carry `tableBasket`.

## Left to the builder

Polling period, wording in the three languages, the look of the table panel (it follows the template's tokens).

## Verification

Unit tests for the rules, the part writes (own part only, caps, foreign restaurant, plan lock), the send (one order from all parts,
priced by the server, parts marked sent, a second send refused), and the guest-feature gating; type check; a browser check of two
guests sharing one table.
