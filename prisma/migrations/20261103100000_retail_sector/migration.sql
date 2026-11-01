-- AlterEnum
-- A new enum value cannot be used in the transaction that adds it: the tables and the product row that use it are in the next migration.
ALTER TYPE "BusinessSector" ADD VALUE 'RETAIL';
