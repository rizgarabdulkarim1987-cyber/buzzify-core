-- CreateEnum
CREATE TYPE "PosRole" AS ENUM ('OWNER', 'MANAGER', 'CASHIER', 'KITCHEN');

-- CreateEnum
CREATE TYPE "PosPaymentMethod" AS ENUM ('CASH', 'ZAINCASH', 'FIB', 'QICARD');

-- CreateTable
CREATE TABLE "PosSettings" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "serviceRatePercent" INTEGER NOT NULL DEFAULT 0,
    "taxRatePercent" INTEGER NOT NULL DEFAULT 0,
    "enabledPaymentMethods" "PosPaymentMethod"[] DEFAULT ARRAY['CASH']::"PosPaymentMethod"[],
    "kitchenPrintEnabled" BOOLEAN NOT NULL DEFAULT false,
    "kitchenScreenEnabled" BOOLEAN NOT NULL DEFAULT false,
    "qrOrderingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "takeawayEnabled" BOOLEAN NOT NULL DEFAULT false,
    "deliveryEnabled" BOOLEAN NOT NULL DEFAULT false,
    "complaintsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "tableRingMinutes" INTEGER NOT NULL DEFAULT 60,
    "catalogMenuId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosStaff" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "PosRole" NOT NULL,
    "deactivatedAt" TIMESTAMP(3),
    "kitchenSectionId" TEXT,
    "pinHash" TEXT,
    "pinSetAt" TIMESTAMP(3),
    "pinFailedCount" INTEGER NOT NULL DEFAULT 0,
    "pinLockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosStaff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PosSettings_restaurantId_key" ON "PosSettings"("restaurantId");

-- CreateIndex
CREATE INDEX "PosStaff_restaurantId_idx" ON "PosStaff"("restaurantId");

-- CreateIndex
CREATE INDEX "PosStaff_userId_idx" ON "PosStaff"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PosStaff_restaurantId_userId_key" ON "PosStaff"("restaurantId", "userId");

-- AddForeignKey
ALTER TABLE "PosSettings" ADD CONSTRAINT "PosSettings_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosSettings" ADD CONSTRAINT "PosSettings_catalogMenuId_fkey" FOREIGN KEY ("catalogMenuId") REFERENCES "Menu"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosStaff" ADD CONSTRAINT "PosStaff_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosStaff" ADD CONSTRAINT "PosStaff_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
