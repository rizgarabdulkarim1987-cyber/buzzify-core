-- CreateEnum
CREATE TYPE "PromotionKind" AS ENUM ('SPECIAL', 'DISCOUNT');

-- AlterTable
ALTER TABLE "Bundle" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "completesMeal" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "PairingRule" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "serves" INTEGER;

-- AlterTable
ALTER TABLE "UpsellRule" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "Promotion" (
    "id" TEXT NOT NULL,
    "menuId" TEXT NOT NULL,
    "kind" "PromotionKind" NOT NULL,
    "percentOff" INTEGER,
    "productIds" TEXT[],
    "categoryIds" TEXT[],
    "startsOn" TEXT,
    "endsOn" TEXT,
    "startMinute" INTEGER,
    "endMinute" INTEGER,
    "daysOfWeek" INTEGER NOT NULL DEFAULT 127,
    "translations" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Promotion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Promotion_menuId_idx" ON "Promotion"("menuId");

-- AddForeignKey
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "Menu"("id") ON DELETE CASCADE ON UPDATE CASCADE;
