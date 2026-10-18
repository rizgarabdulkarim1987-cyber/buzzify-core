-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MediaKind" ADD VALUE 'MODEL';
ALTER TYPE "MediaKind" ADD VALUE 'VIDEO';
ALTER TYPE "MediaKind" ADD VALUE 'LOTTIE';

-- AlterTable
ALTER TABLE "MediaAsset" ADD COLUMN     "durationMs" INTEGER,
ADD COLUMN     "meta" JSONB NOT NULL DEFAULT '{}';
