-- AlterTable (additive: a nullable column, no existing row is touched)
ALTER TABLE "PhReceiptLine" ADD COLUMN "clientKey" TEXT;

-- Fast product entry (Task 13): one receipt line per entry request, so a repeated request finds its line instead of adding a second.
CREATE UNIQUE INDEX "PhReceiptLine_restaurantId_clientKey_key" ON "PhReceiptLine"("restaurantId", "clientKey");
