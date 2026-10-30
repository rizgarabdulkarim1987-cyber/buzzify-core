-- AlterTable
-- Additive: a nullable column (metadata only). Sales made before it have no hash; a replay of their key compares branch and user only.
ALTER TABLE "PhSale" ADD COLUMN     "payloadHash" TEXT;
