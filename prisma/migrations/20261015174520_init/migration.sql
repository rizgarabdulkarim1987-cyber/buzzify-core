-- CreateEnum
CREATE TYPE "Daypart" AS ENUM ('BREAKFAST', 'LUNCH', 'DINNER', 'LATE_NIGHT');

-- CreateEnum
CREATE TYPE "PairingSourceType" AS ENUM ('PRODUCT', 'CATEGORY');

-- CreateEnum
CREATE TYPE "RestaurantStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "ThemeMode" AS ENUM ('DARK', 'LIGHT');

-- CreateEnum
CREATE TYPE "NumeralSystem" AS ENUM ('LATN', 'ARAB');

-- CreateEnum
CREATE TYPE "AnalyticsEventType" AS ENUM ('MENU_VIEW', 'PRODUCT_VIEW', 'ADD_TO_CART', 'UPSELL_IMPRESSION', 'UPSELL_ACCEPT', 'PAIRING_IMPRESSION', 'PAIRING_ADD', 'BUNDLE_IMPRESSION', 'BUNDLE_ACCEPT');

-- CreateTable
CREATE TABLE "Restaurant" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "defaultLocale" TEXT NOT NULL DEFAULT 'en',
    "locales" TEXT[],
    "timezone" TEXT NOT NULL,
    "numeralSystem" "NumeralSystem" NOT NULL DEFAULT 'LATN',
    "engineConfig" JSONB NOT NULL DEFAULT '{}',
    "status" "RestaurantStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Restaurant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RestaurantDomain" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "host" TEXT NOT NULL,

    CONSTRAINT "RestaurantDomain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandConfig" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "tokens" JSONB NOT NULL,
    "typography" JSONB NOT NULL,
    "theme" "ThemeMode" NOT NULL DEFAULT 'DARK',
    "motionIntensity" TEXT NOT NULL DEFAULT 'subtle',
    "navStyle" TEXT NOT NULL DEFAULT 'rail',
    "logoText" TEXT NOT NULL,

    CONSTRAINT "BrandConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "translations" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "basePrice" INTEGER NOT NULL,
    "cost" INTEGER,
    "popularity" INTEGER NOT NULL DEFAULT 50,
    "priority" INTEGER NOT NULL DEFAULT 50,
    "isSignature" BOOLEAN NOT NULL DEFAULT false,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "stockCount" INTEGER,
    "lowStockThreshold" INTEGER,
    "dayparts" "Daypart"[],
    "hideOutsideDaypart" BOOLEAN NOT NULL DEFAULT false,
    "slot" TEXT,
    "allergens" TEXT[],
    "ingredients" JSONB NOT NULL DEFAULT '{}',
    "media" JSONB NOT NULL DEFAULT '[]',
    "translations" JSONB NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVariant" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "priceDelta" INTEGER NOT NULL DEFAULT 0,
    "costDelta" INTEGER,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "translations" JSONB NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModifierGroup" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "minSelect" INTEGER NOT NULL DEFAULT 0,
    "maxSelect" INTEGER NOT NULL DEFAULT 1,
    "translations" JSONB NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ModifierGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModifierOption" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "priceDelta" INTEGER NOT NULL DEFAULT 0,
    "costDelta" INTEGER,
    "isSuggested" BOOLEAN NOT NULL DEFAULT false,
    "suggestPriority" INTEGER NOT NULL DEFAULT 50,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "translations" JSONB NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ModifierOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UpsellRule" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "sourceProductId" TEXT NOT NULL,
    "targetProductId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 50,
    "dayparts" "Daypart"[],
    "translations" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "UpsellRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PairingRule" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "sourceType" "PairingSourceType" NOT NULL,
    "sourceProductId" TEXT,
    "sourceCategoryId" TEXT,
    "targetProductId" TEXT NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 50,
    "dayparts" "Daypart"[],
    "translations" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PairingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bundle" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "dayparts" "Daypart"[],
    "translations" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Bundle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BundleItem" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "bundleId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "BundleItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DaypartSchedule" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "daypart" "Daypart" NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "daysOfWeek" INTEGER NOT NULL DEFAULT 127,

    CONSTRAINT "DaypartSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Table" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "Table_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsEvent" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "anonymousSessionId" TEXT NOT NULL,
    "type" "AnalyticsEventType" NOT NULL,
    "tableNumber" INTEGER,
    "productId" TEXT,
    "suggestionId" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Restaurant_slug_key" ON "Restaurant"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "RestaurantDomain_host_key" ON "RestaurantDomain"("host");

-- CreateIndex
CREATE INDEX "RestaurantDomain_restaurantId_idx" ON "RestaurantDomain"("restaurantId");

-- CreateIndex
CREATE UNIQUE INDEX "BrandConfig_restaurantId_key" ON "BrandConfig"("restaurantId");

-- CreateIndex
CREATE UNIQUE INDEX "Category_restaurantId_slug_key" ON "Category"("restaurantId", "slug");

-- CreateIndex
CREATE INDEX "Product_restaurantId_categoryId_idx" ON "Product"("restaurantId", "categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_restaurantId_slug_key" ON "Product"("restaurantId", "slug");

-- CreateIndex
CREATE INDEX "ProductVariant_restaurantId_productId_idx" ON "ProductVariant"("restaurantId", "productId");

-- CreateIndex
CREATE INDEX "ModifierGroup_restaurantId_productId_idx" ON "ModifierGroup"("restaurantId", "productId");

-- CreateIndex
CREATE INDEX "ModifierOption_restaurantId_groupId_idx" ON "ModifierOption"("restaurantId", "groupId");

-- CreateIndex
CREATE INDEX "UpsellRule_restaurantId_sourceProductId_idx" ON "UpsellRule"("restaurantId", "sourceProductId");

-- CreateIndex
CREATE INDEX "PairingRule_restaurantId_idx" ON "PairingRule"("restaurantId");

-- CreateIndex
CREATE UNIQUE INDEX "Bundle_restaurantId_slug_key" ON "Bundle"("restaurantId", "slug");

-- CreateIndex
CREATE INDEX "BundleItem_restaurantId_bundleId_idx" ON "BundleItem"("restaurantId", "bundleId");

-- CreateIndex
CREATE INDEX "DaypartSchedule_restaurantId_idx" ON "DaypartSchedule"("restaurantId");

-- CreateIndex
CREATE UNIQUE INDEX "Table_restaurantId_number_key" ON "Table"("restaurantId", "number");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_restaurantId_type_occurredAt_idx" ON "AnalyticsEvent"("restaurantId", "type", "occurredAt");

-- AddForeignKey
ALTER TABLE "RestaurantDomain" ADD CONSTRAINT "RestaurantDomain_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandConfig" ADD CONSTRAINT "BrandConfig_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModifierGroup" ADD CONSTRAINT "ModifierGroup_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModifierGroup" ADD CONSTRAINT "ModifierGroup_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModifierOption" ADD CONSTRAINT "ModifierOption_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModifierOption" ADD CONSTRAINT "ModifierOption_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ModifierGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UpsellRule" ADD CONSTRAINT "UpsellRule_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UpsellRule" ADD CONSTRAINT "UpsellRule_sourceProductId_fkey" FOREIGN KEY ("sourceProductId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UpsellRule" ADD CONSTRAINT "UpsellRule_targetProductId_fkey" FOREIGN KEY ("targetProductId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PairingRule" ADD CONSTRAINT "PairingRule_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PairingRule" ADD CONSTRAINT "PairingRule_sourceProductId_fkey" FOREIGN KEY ("sourceProductId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PairingRule" ADD CONSTRAINT "PairingRule_targetProductId_fkey" FOREIGN KEY ("targetProductId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bundle" ADD CONSTRAINT "Bundle_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BundleItem" ADD CONSTRAINT "BundleItem_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BundleItem" ADD CONSTRAINT "BundleItem_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "Bundle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BundleItem" ADD CONSTRAINT "BundleItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DaypartSchedule" ADD CONSTRAINT "DaypartSchedule_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Table" ADD CONSTRAINT "Table_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
