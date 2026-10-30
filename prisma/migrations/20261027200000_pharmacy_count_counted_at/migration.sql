-- Additive: when a count line was last counted.
ALTER TABLE "PhStockCountLine" ADD COLUMN "countedAt" TIMESTAMP(3);
