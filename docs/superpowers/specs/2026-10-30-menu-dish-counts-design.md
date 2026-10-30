# Dish counts on the menu: views and orders (design)

Date: 2026-10-30. Status: waiting for the owner's approval.

## Intent

Sales. A guest who sees that a dish was ordered 340 times and opened 1,200 times trusts it more and orders it. The numbers must be real, so that the proof is worth something: the product owner does not want to help restaurants lie.

## What the guest sees

On every dish card, in every menu style, a small line such as "340 orders · 1,200 views" (Arabic, Kurdish and English like the rest of the menu). A dish shows nothing until it has been ordered at least once (the owner's decision). From its first paid order the line appears on its own, with both numbers, orders and views (automatic, no setting). A dish with views but no order yet shows nothing. The card layout of each style must stay intact; the line is one more small element, not a new structure.

## The numbers

- **Views**: counted automatically from the existing `PRODUCT_VIEW` analytics events (`AnalyticsEvent`, which carries `anonymousSessionId` and `productId`). One device counts once per dish per day (Baghdad day): the count is the number of distinct (session, day) pairs for the dish. Refreshing or reopening does not raise it.
- **Orders**: counted automatically from the cashier (Menu POS). For a dish: the sum of `quantity` over `PosOrderLine` rows of that product that are paid (`paymentId` set), not cancelled (`cancelledAt` null) and not refunded (see `PosPaymentReversal`). Comped lines are a builder question (see "Left to the builder"). All time, from the first day; nothing resets.
- Nobody can edit, reset, hide or delete a number, not the owner and not a super admin. There is no setting for it. Numbers are never copied into the published snapshot: they are read live (cached briefly), because a publish must not freeze or fake them.

## The switch

All or nothing for the whole restaurant. There is no hiding of single dishes (no cherry-picking: that would be lying) and no time period setting. Two levels, as the wheel of fortune already works:

1. The **super admin** grants the feature to the restaurant (an entitlement, `menu.dishCounts`, in `src/server/domain/entitlements.ts`, switchable per restaurant as the other extras are).
2. The **owner** turns it on or off for the menu (a flag on `Menu`, like `wheelEnabled`).

The numbers are shown only when both are on. Both are plain on/off.

## Goals

- Real, automatic, tamper-proof numbers on every dish card, in every style.
- One restaurant-wide on/off for the owner, one grant for the super admin.

## Non-goals

- No ratings or reviews (dropped on purpose: too easy to fake).
- No per-dish visibility, no time windows, no manual editing of numbers.
- No new statistics screen; existing Sales insights are untouched.

## Anti-goals

- A number that can be inflated by refreshing, or that includes cancelled, refunded or unpaid items.
- Breaking any current menu style or its motion, or the cashier (the cashier gets no change and no motion).
- The existing "most ordered" label (`selling.socialProof`) keeps working as it is; the two are separate features.

## Constraints

- The menu is served from a published snapshot; counts come from live tables on the same request path and must not slow the menu noticeably (one grouped query per menu, cached for about a minute; the builder chooses).
- Tests for the two counts (dedupe, refunds, cancelled lines) before the code; Studio texts in en, ar and ckb.
- Test data uses the project's own fixtures; no real data touched.

## Left to the builder

- Where the line sits on each style's card (small, quiet, readable in RTL).
- Whether old `AnalyticsEvent` rows are pruned (if so, say how far back "all time" really reaches).
- How comped (free) lines count: my call is that they count as orders, since the dish was served.
- Which plan the feature starts in: my call is PRO, and the super admin can still grant it to any restaurant.
- Exact cache time and the query shape.

## Answered by the code (from the builder check)

- Orders are attributed to a menu through `Product.menuId` of the line's `productId`; lines with a null product (deleted or ad-hoc) are not counted.
- A line is refunded when its own payment (`paymentId`) has a `PosPaymentReversal`; split payments therefore map line by line.
- `PRODUCT_VIEW` is sent when a dish is opened (sheet or page), not when its card is shown. The builder verifies it fires in every style, and that staff preview and cashier traffic are not counted.

## Builder's calls (added after the check)

- Cache: the builder picks one that is safe on the deployment (multiple instances); the numbers may come with the menu payload or from a small endpoint.
- If the grant is removed or the owner flag is off, the numbers just disappear; stored data stays.
- Digits, grouping and plural texts follow each language's existing menu conventions.

## Stronger view protection (the owner asked for it)

Clearing storage or private mode must not let one person raise a number. Follow the wheel of fortune's way (`WheelSpin`: random cookie key plus a salted address hash, no personal data):

- One device (cookie key) counts once per dish per day.
- One address (salted hash, never the raw IP) counts at most 3 views per dish per day, so a shared café Wi-Fi is not punished and a cleared browser cannot inflate. (My guess at the number, taken from the wheel's 3x rule.)
- Bots, crawlers and link-preview fetchers are not counted; neither are staff preview and cashier traffic.
- This needs an ingest-side change (a short-lived record of who counted, kept a few days like `WheelSpin`), not only a read query. The builder plans it.
- Order counts need no such guard: they come from paid cashier lines.

## Open for the owner

- Nothing open.

## My calls (the owner did not decide these)

Plan level PRO; comped lines count; both numbers appear together once the dish has one order (my reading of "until the first order"); cache of about a minute.
