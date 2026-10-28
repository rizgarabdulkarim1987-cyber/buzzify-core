-- A bill can be paid in parts, one payment per guest: PosPayment gets a part number and is unique per (order, part)
-- instead of per order; each order line records the payment that paid it.

ALTER TABLE "PosPayment" ADD COLUMN "part" INTEGER NOT NULL DEFAULT 1;

DROP INDEX "PosPayment_orderId_key";
CREATE UNIQUE INDEX "PosPayment_orderId_part_key" ON "PosPayment"("orderId", "part");

ALTER TABLE "PosOrderLine" ADD COLUMN "paymentId" TEXT;
CREATE INDEX "PosOrderLine_paymentId_idx" ON "PosOrderLine"("paymentId");
ALTER TABLE "PosOrderLine" ADD CONSTRAINT "PosOrderLine_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "PosPayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Every live line of an order that was already paid belongs to its one payment.
UPDATE "PosOrderLine" AS l
SET "paymentId" = p."id"
FROM "PosPayment" AS p
WHERE p."orderId" = l."orderId" AND l."cancelledAt" IS NULL;
