-- CreateEnum
CREATE TYPE "PosFulfillment" AS ENUM ('NEW', 'PREPARING', 'READY', 'OUT', 'DELIVERED', 'PICKED_UP');

-- AlterTable
ALTER TABLE "PosOrder" ADD COLUMN     "address" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "addressNote" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "customerName" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "customerPhone" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "deliveryFee" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "deliveryZoneId" TEXT,
ADD COLUMN     "deliveryZoneName" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "doneAt" TIMESTAMP(3),
ADD COLUMN     "driverId" TEXT,
ADD COLUMN     "driverNameSnapshot" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "fulfillment" "PosFulfillment",
ADD COLUMN     "outAt" TIMESTAMP(3),
ADD COLUMN     "queueDay" TEXT,
ADD COLUMN     "queueNumber" INTEGER;

-- CreateTable
CREATE TABLE "PosDeliveryZone" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fee" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosDeliveryZone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosDriver" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosDriver_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PosDeliveryZone_restaurantId_idx" ON "PosDeliveryZone"("restaurantId");

-- CreateIndex
CREATE INDEX "PosDriver_restaurantId_idx" ON "PosDriver"("restaurantId");

-- CreateIndex
CREATE INDEX "PosOrder_restaurantId_kind_status_idx" ON "PosOrder"("restaurantId", "kind", "status");

-- CreateIndex
CREATE INDEX "PosOrder_restaurantId_customerPhone_idx" ON "PosOrder"("restaurantId", "customerPhone");

-- CreateIndex
CREATE UNIQUE INDEX "PosOrder_restaurantId_queueDay_queueNumber_key" ON "PosOrder"("restaurantId", "queueDay", "queueNumber");

-- AddForeignKey
ALTER TABLE "PosDeliveryZone" ADD CONSTRAINT "PosDeliveryZone_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosDriver" ADD CONSTRAINT "PosDriver_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

