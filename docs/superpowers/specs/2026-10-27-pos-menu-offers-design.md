# The menu's offers at the Menu POS till

Date: 2026-10-27. Status: decided by the session that asked for it (a cashier must sell what the menu advertises).

## Problem

`addLineIn` (`src/server/pos/order-lines.ts`) stores `unitPriceSnapshot = product.basePrice` and never reads the menu's
live DISCOUNT offers. A dish the menu shows at a sale price is sold by the cashier at the regular price. QR orders already
carry the offer (`promoDiscountPerUnit`), so a guest and a cashier get different prices for the same dish.

## Decisions

1. **Where the offer lives.** A new column `PosOrderLine.promoDiscountPerUnit Int @default(0)`, whole IQD per unit.
   `unitPriceSnapshot` stays the regular price (never silently lowered), so Gross / Discounts / Net stay correct and the
   receipt can print the offer. It is separate from the manual line discount (`discountKind/Value`).
2. **Money rule** (`src/server/domain/pos/totals.ts`, the one file the server, the offline till and the reports share):
   `lineDiscount = promo × qty + manual discount taken from (gross − promo × qty)`. A manual discount therefore stacks
   on the sale price and can never double-count the offer; the line total never goes below 0. Quantity changes rescale the
   offer by themselves (the QR model froze an AMOUNT total, which went stale when the quantity changed).
3. **The amount.** `unit = base + variant delta + options` (same as `priceOf` in `domain/catalog.ts`);
   `promo = unit − salePrice(unit, percent, roundTo)` for the largest live DISCOUNT that names the dish or its category
   (`discountFor`). One shared pure function, `offerPerUnit` in `src/server/domain/pos/line-offer.ts`.
4. **Which offers.** The offers of the till's catalog menu as the cashier sees its prices, i.e. the DRAFT rows (the till
   already reads the draft catalog, and a till-only menu is never published), live at the pricing time in the menu's time
   zone, and only when the plan allows `selling.offers` (same gate as `servedCatalog` for guests).
5. **QR orders** use the same column: accepting a request now stores `promoDiscountPerUnit` instead of an AMOUNT discount,
   so the cashier can still add a manual discount to an accepted QR line. Old accepted lines keep their AMOUNT discount.
6. **Offline.** The sync snapshot's catalog carries the menu's active DISCOUNT offers (`catalog.offers`, `timeZone`); the
   device prices a tapped dish with the same pure functions at the time of the tap. The `addLine` operation carries
   `clientAt`; the server prices the replay at `clientAt` when it is within the last 12 hours and not in the future, else
   at the server's clock. So an offer that ended while the device was offline is still honoured for lines tapped while
   it ran, and the `payCash` `expectedTotal` check keeps working (online and offline totals agree).
7. **UI.** Product tile and order line show a small `-NN%` cue and the sale price; no motion. The receipt prints the
   offer as a line discount.
8. **Refunds and reports** read the line through `pricedLine`, so they follow with no extra rule: the offer is part of
   the discounts total.

## Out of scope

SPECIAL offers (no price), bundles, upsells; changing menu shape bodies.
