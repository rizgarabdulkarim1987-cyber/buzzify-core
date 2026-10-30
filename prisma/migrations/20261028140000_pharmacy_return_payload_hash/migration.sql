-- AlterTable
-- Additive: a nullable column (metadata only). A return made without a hash replays for the same branch and user only.
ALTER TABLE "PhReturn" ADD COLUMN     "payloadHash" TEXT;
