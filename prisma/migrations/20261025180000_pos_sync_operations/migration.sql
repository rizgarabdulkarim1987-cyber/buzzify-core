-- CreateTable
CREATE TABLE "PosSyncOperation" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "clientAt" TIMESTAMP(3) NOT NULL,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosSyncOperation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PosSyncOperation_restaurantId_appliedAt_idx" ON "PosSyncOperation"("restaurantId", "appliedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PosSyncOperation_restaurantId_operationId_key" ON "PosSyncOperation"("restaurantId", "operationId");

-- AddForeignKey
ALTER TABLE "PosSyncOperation" ADD CONSTRAINT "PosSyncOperation_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
