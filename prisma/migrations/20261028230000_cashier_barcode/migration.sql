-- AlterTable
ALTER TABLE "PosProductSetting" ADD COLUMN     "barcode" TEXT;

-- CreateIndex: one product per code in a restaurant; many products may have no code.
CREATE UNIQUE INDEX "PosProductSetting_restaurantId_barcode_key" ON "PosProductSetting"("restaurantId", "barcode") WHERE "barcode" IS NOT NULL;
