# Captain role (الكابتن) — design

Status: draft for approval. Date: 2026-10-28.

## Intent

Some restaurants want the guest's order to go straight to the cashier. Others want a captain (floor waiter) to check it
first and release it. Some also want the captain to take an order by mouth at the table, for a guest who did not open the
QR menu. This adds a **CAPTAIN** role to the Menu POS (the cashier at `src/app/pos`) and one per-restaurant switch that
turns the captain's approval step on or off.

A second, independent feature rides along: the guest can ask for the bill from the menu, and the captain and the cashier
both see it at once.

## Goals

1. New POS role `CAPTAIN` with its own screen, close to the cashier's (tables, incoming orders, new order), without
   payment, reports, settings or staff management.
2. A restaurant switch "captain approves guest orders" (default off). When off, nothing changes for that restaurant.
3. When on, a guest order reaches the captain and the cashier at the same moment. The cashier sees it marked "waiting for
   captain" and cannot accept it, print it or send it to the kitchen until the captain approves.
4. The captain can edit a guest order before approving: change quantity, add, remove, replace a dish, or cancel the whole
   order.
5. The captain can open a table and order for the guest by mouth. This order reaches the cashier already approved.
6. The guest can press "I want my bill" on the menu. The captain and the cashier see it together, with the table number,
   whatever the switch says.
7. The switch can be changed by the Super Admin, the Owner and the Manager (the roles that already manage POS settings).

## Non-goals

- The captain does not take payment, give discounts, refund, see reports, or manage staff or settings.
- No new payment, kitchen or printing behaviour.
- No per-table or per-captain assignment of tables (any captain sees every table). Can be added later.
- No change to the guest's menu look or its styles beyond the bill button.

## Anti-goals

- A restaurant with the switch off must see no new screen, no new wait and no new button state in the cashier.
- The cashier must never be able to push an unapproved guest order forward by any route (UI, API, offline sync).
  The rule is enforced in the server action, not only in the screen.

## Behaviour

### Roles and the switch

| | Switch off (today) | Switch on |
|---|---|---|
| Guest order | guest -> cashier | guest -> captain **and** cashier (cashier waits) |
| Who releases it | cashier accepts | captain approves, then cashier accepts |
| Captain's own order | n/a | goes to the cashier already approved |
| Bill request | captain and cashier both notified | same |

Who may approve when the captain is absent (builder: this is the product owner's call, marked as an assumption):
Manager and Owner can approve in place of a captain. The cashier cannot.

If the switch is on and the restaurant has no active captain, guest orders still wait for approval; Manager or Owner
releases them. (Assumption.)

### Guest order with the switch on

1. Guest sends the order from the table menu. It is stored as a pending customer order with an approval state
   "awaiting captain".
2. Captain screen and cashier screen both list it. Cashier shows a "waiting for captain" label and disables accept.
3. Captain edits if needed and approves. The cashier's accept becomes available; edits show on the cashier at once.
4. If the captain cancels it, it is rejected with a reason, like today's reject, and the guest sees the rejection on
   the existing status check.
5. The existing 60-minute expiry of pending requests still applies.
6. The guest's status page keeps working; it should say the order is with the captain while it waits (assumption, one line
   of copy).

### Captain's own order

The captain picks a table number and adds dishes from the same product list the cashier uses. Submitting creates the
order approved. If the table already has a live order, it joins it, as a guest order does today.

### Bill request

A button on the table menu. It sets the table's order to the existing `BILL_REQUESTED` state when the table has a live
order, and raises a visible notice on the captain and cashier screens until one of them marks it seen (assumption: a
"seen" mark so it does not keep alerting). A table with no live order shows a notice only. The button is rate-limited
per table to stop spam (builder: reuse the guest order limits).

## Constraints from the code (found by reading it)

- Roles: `PosRole` enum in `prisma/schema.prisma` and `POS_ROLES` and the permission matrix in
  `src/server/domain/pos/permissions.ts`. The cashier's role cannot resolve without it, so adding a role touches the
  enum, the matrix, `RolesMatrix.tsx`, staff forms and the default landing page (`nav.ts`).
- Guest orders: `PosCustomerOrder` (status PENDING / ACCEPTED / REJECTED) in `src/server/pos/customer-orders.ts` and
  `customer-orders-guest.ts`, API under `src/app/api/[tenant]/qr-order`. Approval state must be added without touching the
  one-live-order-per-table index or the order state machine.
- Settings: `PosSettings` holds the on/off switches (for example `qrOrderingEnabled`); the new switch goes there and in
  the settings screen. Entitlements/plans in `src/server/domain/entitlements.ts` may need to know the new role.
- The offline till sync (`src/lib/pos-sync`) must refuse accepting an unapproved order too.
- Per the project memory: no motion at all in the cashier screens; Arabic and Kurdish (ckb) and English strings are needed
  in `src/studio/messages`.

## Left to the builder

- Exact screen layout of the captain (follow the cashier's tables and requests screens).
- Whether approval state is a new column on `PosCustomerOrder` or a new status value.
- Notice mechanics for the bill request (use the existing realtime/polling the cashier already uses for requests).
- Migration and tests (TDD): switch off unchanged; switch on blocks accept; captain edit; manager override; cashier
  cannot override; bill request reaches both; offline sync refuses unapproved.

## Assumptions to confirm

1. Manager and Owner can approve in place of the captain; the cashier cannot.
2. With the switch on and no captain on shift, Manager or Owner release orders.
3. Guest sees "with the captain" while waiting.
4. Bill request has a "seen" mark and a per-table rate limit.
5. Captains see all tables (no table assignment).
