-- Restaurant becomes two models. The old `Restaurant` (a slug and a catalog) is now `Menu`; a new `Restaurant`
-- (the client business) sits above it. Every catalog table is re-keyed from `restaurantId` to `menuId`, and
-- `RestaurantDomain` becomes `MenuDomain`.
--
-- Nothing here is production data: the only rows are the demo café that `npm run db:seed` creates. Re-keying them in
-- place is not worth the SQL, so existing rows are removed first (the catalog, domains and analytics go with them
-- through the foreign keys that still exist at this point) and the seed recreates them. Run `npm run db:seed` after
-- applying this migration to a database that held the demo café.
DELETE FROM "Restaurant";

-- CreateEnum
CREATE TYPE "RestaurantType" AS ENUM ('CAFE', 'RESTAURANT', 'BAKERY', 'FAST_FOOD', 'FINE_DINING', 'OTHER');

-- CreateEnum
CREATE TYPE "MenuStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'SUSPENDED', 'ARCHIVED');

-- AlterEnum
ALTER TYPE "RestaurantStatus" ADD VALUE 'ARCHIVED';

-- DropForeignKey
ALTER TABLE "AnalyticsEvent" DROP CONSTRAINT "AnalyticsEvent_restaurantId_fkey";

-- DropForeignKey
ALTER TABLE "BrandConfig" DROP CONSTRAINT "BrandConfig_restaurantId_fkey";

-- DropForeignKey
ALTER TABLE "Bundle" DROP CONSTRAINT "Bundle_restaurantId_fkey";

-- DropForeignKey
ALTER TABLE "BundleItem" DROP CONSTRAINT "BundleItem_restaurantId_fkey";

-- DropForeignKey
ALTER TABLE "Category" DROP CONSTRAINT "Category_restaurantId_fkey";

-- DropForeignKey
ALTER TABLE "DaypartSchedule" DROP CONSTRAINT "DaypartSchedule_restaurantId_fkey";

-- DropForeignKey
ALTER TABLE "ModifierGroup" DROP CONSTRAINT "ModifierGroup_restaurantId_fkey";

-- DropForeignKey
ALTER TABLE "ModifierOption" DROP CONSTRAINT "ModifierOption_restaurantId_fkey";

-- DropForeignKey
ALTER TABLE "PairingRule" DROP CONSTRAINT "PairingRule_restaurantId_fkey";

-- DropForeignKey
ALTER TABLE "Product" DROP CONSTRAINT "Product_restaurantId_fkey";

-- DropForeignKey
ALTER TABLE "ProductVariant" DROP CONSTRAINT "ProductVariant_restaurantId_fkey";

-- DropForeignKey
ALTER TABLE "RestaurantDomain" DROP CONSTRAINT "RestaurantDomain_restaurantId_fkey";

-- DropForeignKey
ALTER TABLE "Table" DROP CONSTRAINT "Table_restaurantId_fkey";

-- DropForeignKey
ALTER TABLE "UpsellRule" DROP CONSTRAINT "UpsellRule_restaurantId_fkey";

-- DropIndex
DROP INDEX "AnalyticsEvent_restaurantId_type_occurredAt_idx";

-- DropIndex
DROP INDEX "BrandConfig_restaurantId_key";

-- DropIndex
DROP INDEX "Bundle_restaurantId_slug_key";

-- DropIndex
DROP INDEX "BundleItem_restaurantId_bundleId_idx";

-- DropIndex
DROP INDEX "Category_restaurantId_slug_key";

-- DropIndex
DROP INDEX "DaypartSchedule_restaurantId_idx";

-- DropIndex
DROP INDEX "ModifierGroup_restaurantId_productId_idx";

-- DropIndex
DROP INDEX "ModifierOption_restaurantId_groupId_idx";

-- DropIndex
DROP INDEX "PairingRule_restaurantId_idx";

-- DropIndex
DROP INDEX "Product_restaurantId_categoryId_idx";

-- DropIndex
DROP INDEX "Product_restaurantId_slug_key";

-- DropIndex
DROP INDEX "ProductVariant_restaurantId_productId_idx";

-- DropIndex
DROP INDEX "Restaurant_slug_key";

-- DropIndex
DROP INDEX "Table_restaurantId_number_key";

-- DropIndex
DROP INDEX "UpsellRule_restaurantId_sourceProductId_idx";

-- AlterTable
ALTER TABLE "AnalyticsEvent" DROP COLUMN "restaurantId",
ADD COLUMN     "menuId" TEXT NOT NULL,
ADD COLUMN     "qrCodeId" TEXT,
ADD COLUMN     "source" TEXT;

-- AlterTable
ALTER TABLE "BrandConfig" DROP COLUMN "restaurantId",
ADD COLUMN     "menuId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Bundle" DROP COLUMN "restaurantId",
ADD COLUMN     "menuId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "BundleItem" DROP COLUMN "restaurantId",
ADD COLUMN     "menuId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Category" DROP COLUMN "restaurantId",
ADD COLUMN     "menuId" TEXT NOT NULL,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "DaypartSchedule" DROP COLUMN "restaurantId",
ADD COLUMN     "menuId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "ModifierGroup" DROP COLUMN "restaurantId",
ADD COLUMN     "menuId" TEXT NOT NULL,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "ModifierOption" DROP COLUMN "restaurantId",
ADD COLUMN     "menuId" TEXT NOT NULL,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "PairingRule" DROP COLUMN "restaurantId",
ADD COLUMN     "menuId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Product" DROP COLUMN "restaurantId",
ADD COLUMN     "badges" TEXT[],
ADD COLUMN     "calories" INTEGER,
ADD COLUMN     "dietary" TEXT[],
ADD COLUMN     "isHidden" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "menuId" TEXT NOT NULL,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "ProductVariant" DROP COLUMN "restaurantId",
ADD COLUMN     "menuId" TEXT NOT NULL,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Restaurant" DROP COLUMN "currency",
DROP COLUMN "defaultLocale",
DROP COLUMN "engineConfig",
DROP COLUMN "locales",
DROP COLUMN "numeralSystem",
DROP COLUMN "slug",
DROP COLUMN "timezone",
ADD COLUMN     "address" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "city" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "clientNumber" SERIAL NOT NULL,
ADD COLUMN     "country" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "description" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "notes" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "permissionPolicy" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "phone" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "socialLinks" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "type" "RestaurantType" NOT NULL DEFAULT 'RESTAURANT',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "whatsapp" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "workingHours" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "Table" DROP COLUMN "restaurantId",
ADD COLUMN     "menuId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "UpsellRule" DROP COLUMN "restaurantId",
ADD COLUMN     "menuId" TEXT NOT NULL;

-- DropTable
DROP TABLE "RestaurantDomain";

-- CreateTable
CREATE TABLE "Branch" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL DEFAULT '',
    "city" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "workingHours" JSONB NOT NULL DEFAULT '{}',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Menu" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "MenuStatus" NOT NULL DEFAULT 'DRAFT',
    "statusBeforeArchive" "MenuStatus",
    "liveRevisionId" TEXT,
    "draftHash" TEXT,
    "liveHash" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "defaultLocale" TEXT NOT NULL DEFAULT 'en',
    "locales" TEXT[],
    "timezone" TEXT NOT NULL,
    "numeralSystem" "NumeralSystem" NOT NULL DEFAULT 'LATN',
    "engineConfig" JSONB NOT NULL DEFAULT '{}',
    "seo" JSONB NOT NULL DEFAULT '{}',
    "notes" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Menu_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuSlug" (
    "slug" TEXT NOT NULL,
    "menuId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MenuSlug_pkey" PRIMARY KEY ("slug")
);

-- CreateTable
CREATE TABLE "MenuRevision" (
    "id" TEXT NOT NULL,
    "menuId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "snapshotHash" TEXT NOT NULL,
    "goLiveAt" TIMESTAMP(3),
    "wentLiveAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdById" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MenuRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuDomain" (
    "id" TEXT NOT NULL,
    "menuId" TEXT NOT NULL,
    "host" TEXT NOT NULL,

    CONSTRAINT "MenuDomain_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Branch_restaurantId_idx" ON "Branch"("restaurantId");

-- CreateIndex
CREATE UNIQUE INDEX "Menu_slug_key" ON "Menu"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Menu_liveRevisionId_key" ON "Menu"("liveRevisionId");

-- CreateIndex
CREATE INDEX "Menu_restaurantId_idx" ON "Menu"("restaurantId");

-- CreateIndex
CREATE INDEX "Menu_status_idx" ON "Menu"("status");

-- CreateIndex
CREATE INDEX "Menu_createdAt_idx" ON "Menu"("createdAt");

-- CreateIndex
CREATE INDEX "Menu_name_idx" ON "Menu"("name");

-- CreateIndex
CREATE INDEX "MenuSlug_menuId_idx" ON "MenuSlug"("menuId");

-- CreateIndex
CREATE UNIQUE INDEX "MenuRevision_menuId_number_key" ON "MenuRevision"("menuId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "MenuDomain_host_key" ON "MenuDomain"("host");

-- CreateIndex
CREATE INDEX "MenuDomain_menuId_idx" ON "MenuDomain"("menuId");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_menuId_type_occurredAt_idx" ON "AnalyticsEvent"("menuId", "type", "occurredAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_type_occurredAt_idx" ON "AnalyticsEvent"("type", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "BrandConfig_menuId_key" ON "BrandConfig"("menuId");

-- CreateIndex
CREATE UNIQUE INDEX "Bundle_menuId_slug_key" ON "Bundle"("menuId", "slug");

-- CreateIndex
CREATE INDEX "BundleItem_menuId_bundleId_idx" ON "BundleItem"("menuId", "bundleId");

-- CreateIndex
CREATE UNIQUE INDEX "Category_menuId_slug_key" ON "Category"("menuId", "slug");

-- CreateIndex
CREATE INDEX "DaypartSchedule_menuId_idx" ON "DaypartSchedule"("menuId");

-- CreateIndex
CREATE INDEX "ModifierGroup_menuId_productId_idx" ON "ModifierGroup"("menuId", "productId");

-- CreateIndex
CREATE INDEX "ModifierOption_menuId_groupId_idx" ON "ModifierOption"("menuId", "groupId");

-- CreateIndex
CREATE INDEX "PairingRule_menuId_idx" ON "PairingRule"("menuId");

-- CreateIndex
CREATE INDEX "Product_menuId_categoryId_idx" ON "Product"("menuId", "categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_menuId_slug_key" ON "Product"("menuId", "slug");

-- CreateIndex
CREATE INDEX "ProductVariant_menuId_productId_idx" ON "ProductVariant"("menuId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "Restaurant_clientNumber_key" ON "Restaurant"("clientNumber");

-- CreateIndex
CREATE INDEX "Restaurant_name_idx" ON "Restaurant"("name");

-- CreateIndex
CREATE INDEX "Restaurant_city_idx" ON "Restaurant"("city");

-- CreateIndex
CREATE INDEX "Restaurant_status_idx" ON "Restaurant"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Table_menuId_number_key" ON "Table"("menuId", "number");

-- CreateIndex
CREATE INDEX "UpsellRule_menuId_sourceProductId_idx" ON "UpsellRule"("menuId", "sourceProductId");

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Menu" ADD CONSTRAINT "Menu_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Menu" ADD CONSTRAINT "Menu_liveRevisionId_fkey" FOREIGN KEY ("liveRevisionId") REFERENCES "MenuRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuSlug" ADD CONSTRAINT "MenuSlug_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "Menu"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuRevision" ADD CONSTRAINT "MenuRevision_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "Menu"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuDomain" ADD CONSTRAINT "MenuDomain_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "Menu"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandConfig" ADD CONSTRAINT "BrandConfig_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "Menu"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "Menu"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "Menu"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "Menu"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModifierGroup" ADD CONSTRAINT "ModifierGroup_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "Menu"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModifierOption" ADD CONSTRAINT "ModifierOption_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "Menu"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UpsellRule" ADD CONSTRAINT "UpsellRule_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "Menu"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PairingRule" ADD CONSTRAINT "PairingRule_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "Menu"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bundle" ADD CONSTRAINT "Bundle_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "Menu"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BundleItem" ADD CONSTRAINT "BundleItem_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "Menu"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DaypartSchedule" ADD CONSTRAINT "DaypartSchedule_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "Menu"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Table" ADD CONSTRAINT "Table_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "Menu"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "Menu"("id") ON DELETE CASCADE ON UPDATE CASCADE;

