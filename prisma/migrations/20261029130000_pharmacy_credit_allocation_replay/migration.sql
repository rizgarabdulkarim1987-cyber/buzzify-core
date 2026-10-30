-- A credit application remembers the request that made it (client key, payload hash, person), so a late retry of that request is a replay. Null for rows made before. Additive only.
ALTER TABLE "PhCreditAllocation" ADD COLUMN "clientKey" TEXT, ADD COLUMN "payloadHash" TEXT, ADD COLUMN "createdById" TEXT;
CREATE INDEX "PhCreditAllocation_restaurantId_clientKey_idx" ON "PhCreditAllocation"("restaurantId", "clientKey");
