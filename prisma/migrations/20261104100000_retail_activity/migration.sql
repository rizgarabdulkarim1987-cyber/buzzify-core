-- Which Buzzify Retail product a RETAIL business is: Supermarket, Electronics or Clothing. Additive only: a new type and
-- one new column with a constant default, so every existing link (the shops made before the three products) reads
-- SUPERMARKET. The "BusinessSector" enum is not touched. On PostgreSQL 11 and later a NOT NULL column with a constant
-- default is a catalog change: the table is not rewritten and its lock is held only for that moment.

-- CreateEnum
CREATE TYPE "RetailActivity" AS ENUM ('SUPERMARKET', 'ELECTRONICS', 'CLOTHING');

-- AlterTable
ALTER TABLE "RetailLink" ADD COLUMN "activity" "RetailActivity" NOT NULL DEFAULT 'SUPERMARKET';
