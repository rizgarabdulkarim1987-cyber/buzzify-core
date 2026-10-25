-- CreateEnum
CREATE TYPE "PosCustomerOrderStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- CreateTable
CREATE TABLE "PosCustomerOrder" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "tableNumber" INTEGER NOT NULL,
    "publicId" TEXT NOT NULL,
    "status" "PosCustomerOrderStatus" NOT NULL DEFAULT 'PENDING',
    "customerNote" TEXT NOT NULL DEFAULT '',
    "locale" TEXT NOT NULL,
    "rejectReason" TEXT NOT NULL DEFAULT '',
    "orderId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decidedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosCustomerOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosCustomerOrderLine" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "productId" TEXT,
    "nameSnapshot" TEXT NOT NULL,
    "unitPriceSnapshot" INTEGER NOT NULL,
    "optionsSnapshot" JSONB NOT NULL DEFAULT '[]',
    "promoDiscountPerUnit" INTEGER NOT NULL DEFAULT 0,
    "quantity" INTEGER NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "PosCustomerOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PosCustomerOrder_publicId_key" ON "PosCustomerOrder"("publicId");

-- CreateIndex
CREATE INDEX "PosCustomerOrder_restaurantId_status_idx" ON "PosCustomerOrder"("restaurantId", "status");

-- CreateIndex
CREATE INDEX "PosCustomerOrder_tableId_status_createdAt_idx" ON "PosCustomerOrder"("tableId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PosCustomerOrder_restaurantId_createdAt_idx" ON "PosCustomerOrder"("restaurantId", "createdAt");

-- CreateIndex
CREATE INDEX "PosCustomerOrderLine_requestId_idx" ON "PosCustomerOrderLine"("requestId");

-- CreateIndex
CREATE INDEX "PosCustomerOrderLine_restaurantId_idx" ON "PosCustomerOrderLine"("restaurantId");

-- AddForeignKey
ALTER TABLE "PosCustomerOrder" ADD CONSTRAINT "PosCustomerOrder_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosCustomerOrder" ADD CONSTRAINT "PosCustomerOrder_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "PosTable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosCustomerOrderLine" ADD CONSTRAINT "PosCustomerOrderLine_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosCustomerOrderLine" ADD CONSTRAINT "PosCustomerOrderLine_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PosCustomerOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosCustomerOrderLine" ADD CONSTRAINT "PosCustomerOrderLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
