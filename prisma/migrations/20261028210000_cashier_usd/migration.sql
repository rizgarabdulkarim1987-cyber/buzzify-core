-- AlterEnum
ALTER TYPE "PosPaymentMethod" ADD VALUE 'CASH_USD';

-- AlterTable
ALTER TABLE "PosPaymentLeg" ADD COLUMN     "tenderedUsd" INTEGER,
ADD COLUMN     "rate" INTEGER;

-- AlterTable
ALTER TABLE "PosShift" ADD COLUMN     "countedUsd" INTEGER,
ADD COLUMN     "expectedUsdAtClose" INTEGER,
ADD COLUMN     "differenceUsd" INTEGER;
