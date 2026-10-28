# Wheel of fortune in the menu

Date: 2026-10-29. Branch: menu-intro-explore. Status: awaiting the owner's approval. Earlier instruction (2026-10-25): plan first, do not
build before approval. A mockup exists: `.superpowers/brainstorm/86318-1792958227/content/crazy-styles-photos.html` (#15).

## Why
A playful extra that brings guests back and lifts a dish: the guest spins a wheel whose slices are real dish photos; it lands on a dish
and enlarges its photo. It is an optional extra for every menu style, not a style of its own.

## Goals
- The wheel lives INSIDE the Explore (`about`) tab (owner's decision, 2026-10-29): a section of that page, not a floating element, a header
  button or a popup of its own, so it takes no space anywhere else in the menu and no style's layout changes. It therefore needs the About
  tab on: the wheel shows only when `extras.about` and `extras.wheel` are both on, and a menu with the wheel ready is never "empty" for
  the tab's rule. Winning dish opens the normal product sheet from the page.
- The owner and managers switch it on and set it up from Business Core (this repository, as decided on 2026-10-27); the menu reads the
  switch live, like `feedbackEnabled`.
- Slices are dishes chosen by the restaurant (a number from 4 to 12), shown by their real photo; a dish without a photo cannot be a slice.
- The spin lands on a dish chosen on the server, not in the browser; the guest sees the dish enlarged with its price and an "Add to order"
  button that opens the normal product sheet.
- An optional prize per slice (a label such as "10% off today"): information for the guest to show the waiter; the cashier gets no new
  discount rule in this batch.
- Limits the restaurant sets: spins per guest per day (default 1), active from/to dates, on/off.

## Non-goals
- No money, no gambling: nothing is paid to spin and nothing is won beyond the dish shown and an optional label.
- No cashier discount automation yet; no accounts or sign-in for guests.

## Anti-goals
- The result must not be guessable or forceable from the browser (the server picks; weights are optional and the restaurant's own).
- The wheel must not run on a phone that asks for reduced motion without a calm alternative (a button that reveals the dish at once).

## Decided by the owner
- An optional extra in every style; switched on by owner and manager from Business Core; slices are real dish photos; lands on a dish and
  enlarges its photo.

## Builder's calls (not yet confirmed by the owner)
- Data: `MenuWheel` (menu id, enabled, spins per day, active window) and `WheelSlice` (wheel id, product id, label, weight, sort).
  Per-guest limits use a signed cookie plus a per-IP-per-day counter; no personal data stored.
- The spin endpoint is a public route with the same abuse limits as the feedback box (honeypot-free: no form, only rate limits).
- Entitlement `menu.wheel` in `entitlements.ts`; Business Core page "Wheel of fortune" with the slice picker (photos shown).

## Left to the builder
The wheel's drawing (canvas or SVG), the stop animation, how it reads in right-to-left, the calm alternative, and the order of work
with the About tab (the wheel is built after it, inside it). The intro page may link to the Explore tab; it does not carry the wheel.
