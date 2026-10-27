-- CreateEnum
CREATE TYPE "PosDiscountReason" AS ENUM ('MANAGER_DECISION', 'REGULAR_GUEST', 'COMPLAINT', 'STAFF_MEAL', 'OTHER');

-- AlterTable
ALTER TABLE "PosOrder" ADD COLUMN     "invoiceDiscountApprovedByStaffId" TEXT,
ADD COLUMN     "invoiceDiscountNote" TEXT,
ADD COLUMN     "invoiceDiscountReason" "PosDiscountReason";

-- AlterTable
ALTER TABLE "PosOrderLine" ADD COLUMN     "discountApprovedByStaffId" TEXT,
ADD COLUMN     "discountNote" TEXT,
ADD COLUMN     "discountReason" "PosDiscountReason";

-- AlterTable
ALTER TABLE "PosPaymentReversal" ADD COLUMN     "approvedByStaffId" TEXT;

-- AlterTable
ALTER TABLE "PosSettings" ADD COLUMN     "idleMinutes" INTEGER NOT NULL DEFAULT 15,
ADD COLUMN     "requireApproval" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "PosShift" ADD COLUMN     "zNumber" INTEGER;

-- CreateTable
CREATE TABLE "PosCounter" (
    "restaurantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PosCounter_pkey" PRIMARY KEY ("restaurantId","name")
);

-- CreateIndex
CREATE UNIQUE INDEX "PosShift_restaurantId_zNumber_key" ON "PosShift"("restaurantId", "zNumber");

-- AddForeignKey
ALTER TABLE "PosCounter" ADD CONSTRAINT "PosCounter_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

