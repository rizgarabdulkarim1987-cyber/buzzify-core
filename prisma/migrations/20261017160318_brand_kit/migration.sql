-- AlterTable
ALTER TABLE "BrandConfig" ADD COLUMN     "faviconAssetId" TEXT,
ADD COLUMN     "faviconFromLogo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "fontPairId" TEXT NOT NULL DEFAULT 'classic',
ADD COLUMN     "logoAssetId" TEXT,
ADD COLUMN     "logoDarkAssetId" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Restaurant" ADD COLUMN     "logoAssetId" TEXT;
