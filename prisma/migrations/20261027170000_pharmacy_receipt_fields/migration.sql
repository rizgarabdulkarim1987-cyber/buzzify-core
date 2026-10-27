-- Task 4 (manual receiving): the receipt's running number, and the line's bonus quantity and two explicit flags.
-- Additive only: nullable column and columns with defaults.
ALTER TABLE "PhReceipt" ADD COLUMN "number" TEXT;
ALTER TABLE "PhReceiptLine" ADD COLUMN "bonusQty" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PhReceiptLine" ADD COLUMN "freeOfCharge" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PhReceiptLine" ADD COLUMN "acceptExpired" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX "PhReceipt_branchId_number_key" ON "PhReceipt"("branchId", "number");
ALTER TABLE "PhReceiptLine" ADD CONSTRAINT "PhReceiptLine_bonus_nonneg" CHECK ("bonusQty" >= 0);
