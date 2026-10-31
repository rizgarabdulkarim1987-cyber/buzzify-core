-- A held cart keeps the cart as entered, so resuming it returns the same discounts and prices overrides. Additive: one nullable column, no row read or changed.
ALTER TABLE "PhSale" ADD COLUMN     "holdPayload" JSONB;
