-- CreateEnum
CREATE TYPE "PosStockUnit" AS ENUM ('GRAM', 'MILLILITER', 'PIECE');

-- CreateEnum
CREATE TYPE "PosStockMovementKind" AS ENUM ('PURCHASE', 'PURCHASE_VOID', 'SALE', 'ADJUSTMENT', 'WASTE', 'COUNT');

-- CreateEnum
CREATE TYPE "PosSupplierPayMethod" AS ENUM ('CASH', 'BANK', 'ZAINCASH', 'FIB', 'QICARD', 'OTHER');

-- CreateEnum
CREATE TYPE "PosComplaintStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'RESOLVED');

-- CreateEnum
CREATE TYPE "PosComplaintCategory" AS ENUM ('FOOD', 'SERVICE', 'CLEANLINESS', 'PRICE', 'OTHER');

-- CreateTable
CREATE TABLE "PosInventoryItem" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "unit" "PosStockUnit" NOT NULL,
    "onHand" INTEGER NOT NULL DEFAULT 0,
    "reorderLevel" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastCostAmount" INTEGER,
    "lastCostQuantity" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosInventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosSupplier" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "phone" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosSupplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosPurchaseInvoice" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "invoiceDay" TEXT NOT NULL,
    "number" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "total" INTEGER NOT NULL,
    "clientKey" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3),
    "paidMethod" "PosSupplierPayMethod",
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosPurchaseInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosPurchaseLine" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "lineTotal" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosPurchaseLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosStockCount" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "userId" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosStockCount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosStockMovement" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "kind" "PosStockMovementKind" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "costTotal" INTEGER,
    "reason" TEXT NOT NULL DEFAULT '',
    "purchaseLineId" TEXT,
    "paymentId" TEXT,
    "orderLineId" TEXT,
    "countId" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosStockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosRecipeLine" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "PosRecipeLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosComplaint" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "clientKey" TEXT NOT NULL,
    "status" "PosComplaintStatus" NOT NULL DEFAULT 'NEW',
    "category" "PosComplaintCategory",
    "body" TEXT NOT NULL,
    "tableId" TEXT,
    "tableNumber" INTEGER,
    "orderId" TEXT,
    "orderNumber" INTEGER,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "contactConsentAt" TIMESTAMP(3),
    "contactRemovedAt" TIMESTAMP(3),
    "statusChangedAt" TIMESTAMP(3),
    "statusChangedByUserId" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'ar',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosComplaint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosComplaintNote" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "complaintId" TEXT NOT NULL,
    "userId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosComplaintNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PosInventoryItem_restaurantId_active_idx" ON "PosInventoryItem"("restaurantId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "PosInventoryItem_restaurantId_nameKey_key" ON "PosInventoryItem"("restaurantId", "nameKey");

-- CreateIndex
CREATE UNIQUE INDEX "PosSupplier_restaurantId_nameKey_key" ON "PosSupplier"("restaurantId", "nameKey");

-- CreateIndex
CREATE INDEX "PosPurchaseInvoice_restaurantId_invoiceDay_idx" ON "PosPurchaseInvoice"("restaurantId", "invoiceDay");

-- CreateIndex
CREATE UNIQUE INDEX "PosPurchaseInvoice_restaurantId_clientKey_key" ON "PosPurchaseInvoice"("restaurantId", "clientKey");

-- CreateIndex
CREATE UNIQUE INDEX "PosPurchaseInvoice_restaurantId_supplierId_number_key" ON "PosPurchaseInvoice"("restaurantId", "supplierId", "number");

-- CreateIndex
CREATE INDEX "PosPurchaseLine_invoiceId_idx" ON "PosPurchaseLine"("invoiceId");

-- CreateIndex
CREATE INDEX "PosPurchaseLine_itemId_createdAt_idx" ON "PosPurchaseLine"("itemId", "createdAt");

-- CreateIndex
CREATE INDEX "PosStockCount_restaurantId_createdAt_idx" ON "PosStockCount"("restaurantId", "createdAt");

-- CreateIndex
CREATE INDEX "PosStockMovement_restaurantId_createdAt_idx" ON "PosStockMovement"("restaurantId", "createdAt");

-- CreateIndex
CREATE INDEX "PosStockMovement_itemId_createdAt_idx" ON "PosStockMovement"("itemId", "createdAt");

-- CreateIndex
CREATE INDEX "PosStockMovement_paymentId_idx" ON "PosStockMovement"("paymentId");

-- CreateIndex
CREATE INDEX "PosRecipeLine_restaurantId_idx" ON "PosRecipeLine"("restaurantId");

-- CreateIndex
CREATE INDEX "PosRecipeLine_itemId_idx" ON "PosRecipeLine"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "PosRecipeLine_productId_itemId_key" ON "PosRecipeLine"("productId", "itemId");

-- CreateIndex
CREATE INDEX "PosComplaint_restaurantId_status_createdAt_idx" ON "PosComplaint"("restaurantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PosComplaint_tableId_createdAt_idx" ON "PosComplaint"("tableId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PosComplaint_restaurantId_clientKey_key" ON "PosComplaint"("restaurantId", "clientKey");

-- CreateIndex
CREATE INDEX "PosComplaintNote_complaintId_createdAt_idx" ON "PosComplaintNote"("complaintId", "createdAt");

-- AddForeignKey
ALTER TABLE "PosInventoryItem" ADD CONSTRAINT "PosInventoryItem_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosSupplier" ADD CONSTRAINT "PosSupplier_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosPurchaseInvoice" ADD CONSTRAINT "PosPurchaseInvoice_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosPurchaseInvoice" ADD CONSTRAINT "PosPurchaseInvoice_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "PosSupplier"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosPurchaseLine" ADD CONSTRAINT "PosPurchaseLine_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosPurchaseLine" ADD CONSTRAINT "PosPurchaseLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "PosPurchaseInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosPurchaseLine" ADD CONSTRAINT "PosPurchaseLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "PosInventoryItem"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosStockCount" ADD CONSTRAINT "PosStockCount_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosStockMovement" ADD CONSTRAINT "PosStockMovement_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosStockMovement" ADD CONSTRAINT "PosStockMovement_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "PosInventoryItem"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosStockMovement" ADD CONSTRAINT "PosStockMovement_countId_fkey" FOREIGN KEY ("countId") REFERENCES "PosStockCount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosRecipeLine" ADD CONSTRAINT "PosRecipeLine_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosRecipeLine" ADD CONSTRAINT "PosRecipeLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosRecipeLine" ADD CONSTRAINT "PosRecipeLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "PosInventoryItem"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosComplaint" ADD CONSTRAINT "PosComplaint_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosComplaintNote" ADD CONSTRAINT "PosComplaintNote_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosComplaintNote" ADD CONSTRAINT "PosComplaintNote_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "PosComplaint"("id") ON DELETE CASCADE ON UPDATE CASCADE;
