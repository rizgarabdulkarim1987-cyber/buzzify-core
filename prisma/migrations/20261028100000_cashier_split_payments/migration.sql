-- AlterEnum
ALTER TYPE "PosDiscountReason" ADD VALUE 'COMP';

-- AlterTable
ALTER TABLE "PosPayment" ADD COLUMN     "tipAmount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tipMethod" "PosPaymentMethod";

-- AlterTable
ALTER TABLE "PosPaymentReversal" ADD COLUMN     "cashPart" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "PosPaymentLeg" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "method" "PosPaymentMethod" NOT NULL,
    "amount" INTEGER NOT NULL,
    "tendered" INTEGER,
    "reference" TEXT,

    CONSTRAINT "PosPaymentLeg_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PosPaymentLeg_paymentId_method_key" ON "PosPaymentLeg"("paymentId", "method");

-- CreateIndex
CREATE INDEX "PosPaymentLeg_restaurantId_idx" ON "PosPaymentLeg"("restaurantId");

-- AddForeignKey
ALTER TABLE "PosPaymentLeg" ADD CONSTRAINT "PosPaymentLeg_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosPaymentLeg" ADD CONSTRAINT "PosPaymentLeg_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "PosPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: every payment so far was one method for the whole bill, so it becomes one leg of that method.
INSERT INTO "PosPaymentLeg" ("id", "restaurantId", "paymentId", "method", "amount", "tendered", "reference")
SELECT 'leg_' || "id", "restaurantId", "id", "method", ("totalsSnapshot"->>'total')::INTEGER,
       CASE WHEN "method" = 'CASH' THEN "amountReceived" ELSE NULL END, "reference"
FROM "PosPayment";

-- Backfill: a reversal of a cash payment took its whole amount out of the drawer.
UPDATE "PosPaymentReversal" SET "cashPart" = "amount" WHERE "method" = 'CASH';
