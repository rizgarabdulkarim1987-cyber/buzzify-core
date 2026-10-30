-- AlterTable
-- Additive: a width with a default and a nullable key (metadata only). Rows written before it keep width 80 and no key.
ALTER TABLE "PhReceiptReprint" ADD COLUMN     "width" INTEGER NOT NULL DEFAULT 80,
ADD COLUMN     "clientKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "PhReceiptReprint_restaurantId_clientKey_key" ON "PhReceiptReprint"("restaurantId", "clientKey");

-- Checks
ALTER TABLE "PhReceiptReprint" ADD CONSTRAINT "PhReceiptReprint_width_allowed" CHECK ("width" IN (58, 80));
