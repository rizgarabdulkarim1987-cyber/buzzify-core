-- Manual stock changes are idempotent by a client key kept on the movement (refType 'clientKey', refId the key). One
-- movement per key per branch; a reversal copies its original's refType and refId, so it is left out of the index.
CREATE UNIQUE INDEX "PhStockMovement_client_key" ON "PhStockMovement" ("restaurantId", "branchId", "refId") WHERE "refType" = 'clientKey' AND "reversesId" IS NULL;
