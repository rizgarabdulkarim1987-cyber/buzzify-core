-- CreateEnum
CREATE TYPE "ShowcaseSlot" AS ENUM ('ABOVE_SEARCH', 'BELOW_SEARCH');

-- CreateEnum
CREATE TYPE "ShowcaseKind" AS ENUM ('OFFER', 'SET', 'BUFFET');

-- AlterTable
ALTER TABLE "Bundle" ADD COLUMN     "people" INTEGER;

-- CreateTable
CREATE TABLE "Occasion" (
    "id" TEXT NOT NULL,
    "menuId" TEXT NOT NULL,
    "startsOn" TEXT NOT NULL,
    "endsOn" TEXT NOT NULL,
    "translations" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Occasion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShowcaseCard" (
    "id" TEXT NOT NULL,
    "menuId" TEXT NOT NULL,
    "slot" "ShowcaseSlot" NOT NULL,
    "kind" "ShowcaseKind" NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "occasionId" TEXT,
    "promotionId" TEXT,
    "bundleId" TEXT,
    "price" INTEGER,
    "startMinute" INTEGER,
    "endMinute" INTEGER,
    "daysOfWeek" INTEGER NOT NULL DEFAULT 127,
    "translations" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShowcaseCard_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Occasion_menuId_idx" ON "Occasion"("menuId");

-- CreateIndex
CREATE INDEX "ShowcaseCard_menuId_slot_idx" ON "ShowcaseCard"("menuId", "slot");

-- AddForeignKey
ALTER TABLE "Occasion" ADD CONSTRAINT "Occasion_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "Menu"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShowcaseCard" ADD CONSTRAINT "ShowcaseCard_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "Menu"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShowcaseCard" ADD CONSTRAINT "ShowcaseCard_occasionId_fkey" FOREIGN KEY ("occasionId") REFERENCES "Occasion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShowcaseCard" ADD CONSTRAINT "ShowcaseCard_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShowcaseCard" ADD CONSTRAINT "ShowcaseCard_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "Bundle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
