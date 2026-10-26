-- CreateTable
CREATE TABLE "PosKitchenSection" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosKitchenSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosCategorySetting" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "sectionId" TEXT,

    CONSTRAINT "PosCategorySetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosProductSetting" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "sectionId" TEXT,
    "soldOutOverride" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PosProductSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PosKitchenSection_restaurantId_idx" ON "PosKitchenSection"("restaurantId");

-- CreateIndex
CREATE UNIQUE INDEX "PosCategorySetting_categoryId_key" ON "PosCategorySetting"("categoryId");

-- CreateIndex
CREATE INDEX "PosCategorySetting_restaurantId_idx" ON "PosCategorySetting"("restaurantId");

-- CreateIndex
CREATE UNIQUE INDEX "PosProductSetting_productId_key" ON "PosProductSetting"("productId");

-- CreateIndex
CREATE INDEX "PosProductSetting_restaurantId_idx" ON "PosProductSetting"("restaurantId");

-- AddForeignKey
ALTER TABLE "PosStaff" ADD CONSTRAINT "PosStaff_kitchenSectionId_fkey" FOREIGN KEY ("kitchenSectionId") REFERENCES "PosKitchenSection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosKitchenSection" ADD CONSTRAINT "PosKitchenSection_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosCategorySetting" ADD CONSTRAINT "PosCategorySetting_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosCategorySetting" ADD CONSTRAINT "PosCategorySetting_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "PosKitchenSection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosCategorySetting" ADD CONSTRAINT "PosCategorySetting_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosProductSetting" ADD CONSTRAINT "PosProductSetting_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosProductSetting" ADD CONSTRAINT "PosProductSetting_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "PosKitchenSection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosProductSetting" ADD CONSTRAINT "PosProductSetting_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
