-- AlterTable
ALTER TABLE "PhCashMovement" ADD COLUMN     "clientKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "PhCashMovement_restaurantId_clientKey_key" ON "PhCashMovement"("restaurantId", "clientKey");

-- CreateIndex
CREATE UNIQUE INDEX "PhShift_id_currency_key" ON "PhShift"("id", "currency");

-- AddForeignKey
ALTER TABLE "PhCashMovement" ADD CONSTRAINT "PhCashMovement_shiftId_currency_fkey" FOREIGN KEY ("shiftId", "currency") REFERENCES "PhShift"("id", "currency") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhSale" ADD CONSTRAINT "PhSale_shiftId_currency_fkey" FOREIGN KEY ("shiftId", "currency") REFERENCES "PhShift"("id", "currency") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhReturn" ADD CONSTRAINT "PhReturn_shiftId_currency_fkey" FOREIGN KEY ("shiftId", "currency") REFERENCES "PhShift"("id", "currency") ON DELETE NO ACTION ON UPDATE CASCADE;


-- Totals add up. The sale's discount is the sum of its lines' discounts, each line discount including its share of any
-- invoice discount (documented, not a cross-row check). The identities are named so they sort after the single-column
-- checks: a negative column is reported as itself.
ALTER TABLE "PhSale" ADD CONSTRAINT "PhSale_total_identity" CHECK ("totalMinor" = "subtotalMinor" - "discountMinor" + "roundingMinor");
ALTER TABLE "PhSaleLine" ADD CONSTRAINT "PhSaleLine_within_gross_total" CHECK ("totalMinor" = "unitPriceMinor" * "qty" - "discountMinor");

-- A completed or returned sale has a completion time, and its change is what was paid above the total (cash only can
-- overpay, so the change comes from cash, but the identity is the same for every method).
ALTER TABLE "PhSale" ADD CONSTRAINT "PhSale_completed_when_done" CHECK ("status" NOT IN ('COMPLETED', 'RETURNED_PARTIAL', 'RETURNED_FULL') OR "completedAt" IS NOT NULL);
ALTER TABLE "PhSale" ADD CONSTRAINT "PhSale_paid_overpay_is_change" CHECK ("status" NOT IN ('COMPLETED', 'RETURNED_PARTIAL', 'RETURNED_FULL') OR "changeMinor" = "paidMinor" - "totalMinor");
