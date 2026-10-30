-- A batch is (business, product, lot, expiry); the supplier is not part of its identity (additive: one index).
CREATE UNIQUE INDEX "PhBatch_restaurantId_productId_lot_expiryDate_key" ON "PhBatch"("restaurantId", "productId", "lot", "expiryDate");
