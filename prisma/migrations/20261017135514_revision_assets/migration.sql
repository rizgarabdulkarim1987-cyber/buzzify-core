-- AlterTable
ALTER TABLE "MenuRevision" ADD COLUMN     "assetIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
