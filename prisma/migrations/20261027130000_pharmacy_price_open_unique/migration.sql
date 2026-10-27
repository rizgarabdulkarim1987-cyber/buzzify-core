-- One open price (no validTo yet) per product unit, branch (or the whole business, a null branch) and currency: two
-- saves racing to set the same price cannot both leave a row open. Closed rows are history and are left out.
CREATE UNIQUE INDEX "PhPrice_one_open_price" ON "PhPrice" ("productId", "unitId", COALESCE("branchId", ''), "currency") WHERE "validTo" IS NULL;

-- What a bulk price change asks for (the branch, currency, products, change, rounding and reason), so applying it can
-- work the preview out again from the prices of that moment and compare it with the hash the person saw.
ALTER TABLE "PhPriceChangeBatch" ADD COLUMN "change" JSONB NOT NULL DEFAULT '{}';
