-- AlterTable
-- Additive: a text with a default (metadata only).
ALTER TABLE "PhReceiptReprint" ADD COLUMN     "reason" TEXT NOT NULL DEFAULT '';
