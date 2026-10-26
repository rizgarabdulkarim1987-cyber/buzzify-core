-- AlterEnum
ALTER TYPE "RestaurantType" ADD VALUE 'ICE_CREAM';

-- AlterTable
ALTER TABLE "BrandConfig" ADD COLUMN     "customTemplateId" TEXT,
ADD COLUMN     "design" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "templateId" TEXT;

-- AlterTable
ALTER TABLE "Restaurant" ADD COLUMN     "mapUrl" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "showPoweredBy" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "DesignTemplate" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT,
    "name" TEXT NOT NULL,
    "basePresetId" TEXT NOT NULL,
    "overrides" JSONB NOT NULL DEFAULT '{}',
    "createdById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DesignTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DesignTemplate_restaurantId_idx" ON "DesignTemplate"("restaurantId");

-- AddForeignKey
ALTER TABLE "DesignTemplate" ADD CONSTRAINT "DesignTemplate_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
