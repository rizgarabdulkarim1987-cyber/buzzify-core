-- CreateEnum
CREATE TYPE "PhRxLevel" AS ENUM ('OTC', 'RX', 'RESTRICTED');

-- CreateEnum
CREATE TYPE "PhPriceChangeStatus" AS ENUM ('PREVIEW', 'APPLIED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PhImportStatus" AS ENUM ('UPLOADED', 'MAPPED', 'PREVIEWED', 'COMMITTED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PhImportRowStatus" AS ENUM ('OK', 'WARNING', 'ERROR', 'SKIPPED', 'IMPORTED');

-- CreateTable
CREATE TABLE "PhCategory" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhProduct" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "tradeName" TEXT NOT NULL,
    "genericName" TEXT NOT NULL DEFAULT '',
    "activeIngredient" TEXT NOT NULL DEFAULT '',
    "strength" TEXT NOT NULL DEFAULT '',
    "form" TEXT NOT NULL DEFAULT '',
    "manufacturer" TEXT NOT NULL DEFAULT '',
    "categoryId" TEXT,
    "rxLevel" "PhRxLevel" NOT NULL DEFAULT 'OTC',
    "requiresCold" BOOLEAN NOT NULL DEFAULT false,
    "storageNote" TEXT NOT NULL DEFAULT '',
    "shelfLocation" TEXT NOT NULL DEFAULT '',
    "imageAssetId" TEXT,
    "identityKey" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhProductUnit" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "baseQty" INTEGER NOT NULL,
    "sellable" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PhProductUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhBarcode" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhBarcode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhProductBranch" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "minQty" INTEGER NOT NULL DEFAULT 0,
    "reorderQty" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PhProductBranch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhPrice" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "branchId" TEXT,
    "currency" "Currency" NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3),
    "reason" TEXT NOT NULL DEFAULT '',
    "changedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhPriceChangeBatch" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "status" "PhPriceChangeStatus" NOT NULL DEFAULT 'PREVIEW',
    "previewHash" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhPriceChangeBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhImportBatch" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "status" "PhImportStatus" NOT NULL DEFAULT 'UPLOADED',
    "fileSha256" TEXT NOT NULL,
    "mapping" JSONB NOT NULL DEFAULT '{}',
    "summary" JSONB NOT NULL DEFAULT '{}',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhImportRow" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "raw" JSONB NOT NULL,
    "parsed" JSONB NOT NULL DEFAULT '{}',
    "issues" JSONB NOT NULL DEFAULT '[]',
    "status" "PhImportRowStatus" NOT NULL DEFAULT 'OK',

    CONSTRAINT "PhImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PhCategory_restaurantId_nameKey_key" ON "PhCategory"("restaurantId", "nameKey");

-- CreateIndex
CREATE INDEX "PhProduct_restaurantId_active_tradeName_idx" ON "PhProduct"("restaurantId", "active", "tradeName");

-- CreateIndex
CREATE INDEX "PhProduct_restaurantId_categoryId_idx" ON "PhProduct"("restaurantId", "categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "PhProduct_restaurantId_identityKey_key" ON "PhProduct"("restaurantId", "identityKey");

-- CreateIndex
CREATE INDEX "PhProductUnit_restaurantId_productId_idx" ON "PhProductUnit"("restaurantId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "PhProductUnit_productId_level_key" ON "PhProductUnit"("productId", "level");

-- CreateIndex
CREATE INDEX "PhBarcode_restaurantId_code_idx" ON "PhBarcode"("restaurantId", "code");

-- CreateIndex
CREATE INDEX "PhBarcode_productId_idx" ON "PhBarcode"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "PhBarcode_restaurantId_code_unitId_key" ON "PhBarcode"("restaurantId", "code", "unitId");

-- CreateIndex
CREATE INDEX "PhProductBranch_restaurantId_productId_idx" ON "PhProductBranch"("restaurantId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "PhProductBranch_branchId_productId_key" ON "PhProductBranch"("branchId", "productId");

-- CreateIndex
CREATE INDEX "PhPrice_restaurantId_productId_unitId_currency_validFrom_idx" ON "PhPrice"("restaurantId", "productId", "unitId", "currency", "validFrom");

-- CreateIndex
CREATE INDEX "PhPrice_restaurantId_validFrom_idx" ON "PhPrice"("restaurantId", "validFrom");

-- CreateIndex
CREATE INDEX "PhPriceChangeBatch_restaurantId_createdAt_idx" ON "PhPriceChangeBatch"("restaurantId", "createdAt");

-- CreateIndex
CREATE INDEX "PhImportBatch_restaurantId_createdAt_idx" ON "PhImportBatch"("restaurantId", "createdAt");

-- CreateIndex
CREATE INDEX "PhImportBatch_restaurantId_fileSha256_idx" ON "PhImportBatch"("restaurantId", "fileSha256");

-- CreateIndex
CREATE INDEX "PhImportRow_restaurantId_batchId_status_idx" ON "PhImportRow"("restaurantId", "batchId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PhImportRow_batchId_rowNumber_key" ON "PhImportRow"("batchId", "rowNumber");

-- AddForeignKey
ALTER TABLE "PhCategory" ADD CONSTRAINT "PhCategory_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhProduct" ADD CONSTRAINT "PhProduct_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhProduct" ADD CONSTRAINT "PhProduct_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "PhCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhProductUnit" ADD CONSTRAINT "PhProductUnit_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhProductUnit" ADD CONSTRAINT "PhProductUnit_productId_fkey" FOREIGN KEY ("productId") REFERENCES "PhProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhBarcode" ADD CONSTRAINT "PhBarcode_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhBarcode" ADD CONSTRAINT "PhBarcode_productId_fkey" FOREIGN KEY ("productId") REFERENCES "PhProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhBarcode" ADD CONSTRAINT "PhBarcode_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "PhProductUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhProductBranch" ADD CONSTRAINT "PhProductBranch_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhProductBranch" ADD CONSTRAINT "PhProductBranch_restaurantId_branchId_fkey" FOREIGN KEY ("restaurantId", "branchId") REFERENCES "Branch"("restaurantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhProductBranch" ADD CONSTRAINT "PhProductBranch_productId_fkey" FOREIGN KEY ("productId") REFERENCES "PhProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhPrice" ADD CONSTRAINT "PhPrice_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhPrice" ADD CONSTRAINT "PhPrice_productId_fkey" FOREIGN KEY ("productId") REFERENCES "PhProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhPrice" ADD CONSTRAINT "PhPrice_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "PhProductUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhPrice" ADD CONSTRAINT "PhPrice_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhPriceChangeBatch" ADD CONSTRAINT "PhPriceChangeBatch_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhImportBatch" ADD CONSTRAINT "PhImportBatch_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhImportRow" ADD CONSTRAINT "PhImportRow_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhImportRow" ADD CONSTRAINT "PhImportRow_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "PhImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written CHECK constraints (Prisma cannot express them).
ALTER TABLE "PhProductUnit" ADD CONSTRAINT "PhProductUnit_baseQty_positive" CHECK ("baseQty" >= 1);

ALTER TABLE "PhProductUnit" ADD CONSTRAINT "PhProductUnit_base_level_one" CHECK ("level" <> 0 OR "baseQty" = 1);

ALTER TABLE "PhPrice" ADD CONSTRAINT "PhPrice_amountMinor_nonnegative" CHECK ("amountMinor" >= 0);
