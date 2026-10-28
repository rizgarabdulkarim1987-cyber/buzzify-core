-- CreateEnum
CREATE TYPE "PosPrinterRole" AS ENUM ('RECEIPT', 'KITCHEN');

-- CreateEnum
CREATE TYPE "PosPrinterTransport" AS ENUM ('NETWORK', 'FILE');

-- CreateTable
CREATE TABLE "PosPrinter" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "PosPrinterRole" NOT NULL,
    "transport" "PosPrinterTransport" NOT NULL,
    "address" TEXT NOT NULL,
    "paperWidth" INTEGER NOT NULL DEFAULT 80,
    "cut" BOOLEAN NOT NULL DEFAULT true,
    "drawerPin" INTEGER,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sectionId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosPrinter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PosPrinter_restaurantId_idx" ON "PosPrinter"("restaurantId");

-- AddForeignKey
ALTER TABLE "PosPrinter" ADD CONSTRAINT "PosPrinter_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosPrinter" ADD CONSTRAINT "PosPrinter_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "PosKitchenSection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
