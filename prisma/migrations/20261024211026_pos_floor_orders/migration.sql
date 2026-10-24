-- CreateEnum
CREATE TYPE "PosOrderStatus" AS ENUM ('PENDING_APPROVAL', 'OPEN', 'READY', 'BILL_REQUESTED', 'PAID', 'CANCELLED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PosOrderKind" AS ENUM ('DINE_IN', 'TAKEAWAY', 'DELIVERY');

-- CreateEnum
CREATE TYPE "PosDiscountKind" AS ENUM ('AMOUNT', 'PERCENT');

-- CreateTable
CREATE TABLE "PosArea" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PosArea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosTable" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "areaId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,

    CONSTRAINT "PosTable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosOrder" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "tableId" TEXT,
    "number" INTEGER NOT NULL,
    "kind" "PosOrderKind" NOT NULL DEFAULT 'DINE_IN',
    "status" "PosOrderStatus" NOT NULL DEFAULT 'OPEN',
    "seatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invoiceDiscountKind" "PosDiscountKind",
    "invoiceDiscountValue" INTEGER,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosOrderLine" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT,
    "nameSnapshot" TEXT NOT NULL,
    "unitPriceSnapshot" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "note" TEXT NOT NULL DEFAULT '',
    "optionsSnapshot" JSONB NOT NULL DEFAULT '[]',
    "discountKind" "PosDiscountKind",
    "discountValue" INTEGER,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "sectionId" TEXT,
    "sectionNameSnapshot" TEXT NOT NULL DEFAULT '',
    "sentAt" TIMESTAMP(3),
    "batch" INTEGER,
    "readyAt" TIMESTAMP(3),
    "cancelAckAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosPayment" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "method" "PosPaymentMethod" NOT NULL,
    "amountReceived" INTEGER NOT NULL,
    "reference" TEXT,
    "totalsSnapshot" JSONB NOT NULL,
    "userId" TEXT,
    "shiftId" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosShift" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openingFloat" INTEGER NOT NULL,
    "closedAt" TIMESTAMP(3),
    "closedByUserId" TEXT,
    "countedCash" INTEGER,
    "expectedCashAtClose" INTEGER,
    "difference" INTEGER,
    "note" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "PosShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosCashExpense" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosCashExpense_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PosArea_restaurantId_idx" ON "PosArea"("restaurantId");

-- CreateIndex
CREATE INDEX "PosTable_areaId_idx" ON "PosTable"("areaId");

-- CreateIndex
CREATE UNIQUE INDEX "PosTable_restaurantId_number_key" ON "PosTable"("restaurantId", "number");

-- CreateIndex
CREATE INDEX "PosOrder_tableId_idx" ON "PosOrder"("tableId");

-- CreateIndex
CREATE INDEX "PosOrder_restaurantId_status_idx" ON "PosOrder"("restaurantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PosOrder_restaurantId_number_key" ON "PosOrder"("restaurantId", "number");

-- CreateIndex
CREATE INDEX "PosOrderLine_restaurantId_idx" ON "PosOrderLine"("restaurantId");

-- CreateIndex
CREATE INDEX "PosOrderLine_orderId_idx" ON "PosOrderLine"("orderId");

-- CreateIndex
CREATE INDEX "PosOrderLine_productId_idx" ON "PosOrderLine"("productId");

-- CreateIndex
CREATE INDEX "PosOrderLine_restaurantId_sentAt_idx" ON "PosOrderLine"("restaurantId", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "PosPayment_orderId_key" ON "PosPayment"("orderId");

-- CreateIndex
CREATE INDEX "PosPayment_restaurantId_paidAt_idx" ON "PosPayment"("restaurantId", "paidAt");

-- CreateIndex
CREATE INDEX "PosPayment_shiftId_idx" ON "PosPayment"("shiftId");

-- CreateIndex
CREATE INDEX "PosShift_restaurantId_openedAt_idx" ON "PosShift"("restaurantId", "openedAt");

-- CreateIndex
CREATE INDEX "PosShift_userId_idx" ON "PosShift"("userId");

-- CreateIndex
CREATE INDEX "PosCashExpense_shiftId_idx" ON "PosCashExpense"("shiftId");

-- CreateIndex
CREATE INDEX "PosCashExpense_restaurantId_createdAt_idx" ON "PosCashExpense"("restaurantId", "createdAt");

-- AddForeignKey
ALTER TABLE "PosArea" ADD CONSTRAINT "PosArea_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosTable" ADD CONSTRAINT "PosTable_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosTable" ADD CONSTRAINT "PosTable_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "PosArea"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosOrder" ADD CONSTRAINT "PosOrder_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosOrder" ADD CONSTRAINT "PosOrder_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "PosTable"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosOrderLine" ADD CONSTRAINT "PosOrderLine_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosOrderLine" ADD CONSTRAINT "PosOrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PosOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosOrderLine" ADD CONSTRAINT "PosOrderLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosPayment" ADD CONSTRAINT "PosPayment_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosPayment" ADD CONSTRAINT "PosPayment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PosOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosPayment" ADD CONSTRAINT "PosPayment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosPayment" ADD CONSTRAINT "PosPayment_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "PosShift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosShift" ADD CONSTRAINT "PosShift_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosShift" ADD CONSTRAINT "PosShift_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosCashExpense" ADD CONSTRAINT "PosCashExpense_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosCashExpense" ADD CONSTRAINT "PosCashExpense_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "PosShift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosCashExpense" ADD CONSTRAINT "PosCashExpense_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- One live order per table, and one open shift per person and restaurant: Prisma cannot express partial unique indexes.
CREATE UNIQUE INDEX "PosOrder_one_live_per_table" ON "PosOrder"("tableId") WHERE "tableId" IS NOT NULL AND "status" NOT IN ('PAID', 'CANCELLED', 'REJECTED');
CREATE UNIQUE INDEX "PosShift_one_open_per_user" ON "PosShift"("restaurantId", "userId") WHERE "closedAt" IS NULL;
