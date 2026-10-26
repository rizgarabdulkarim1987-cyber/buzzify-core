-- CreateEnum
CREATE TYPE "PosAiFeature" AS ENUM ('ASK', 'SUMMARY', 'ALERTS', 'SUPPLY_ENTRY', 'COMPLAINTS');

-- CreateEnum
CREATE TYPE "PosAiCallStatus" AS ENUM ('OK', 'PROVIDER_ERROR', 'TIMEOUT', 'REFUSED', 'REJECTED_OUTPUT');

-- CreateEnum
CREATE TYPE "PosAiSummaryKind" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'ALERTS');

-- AlterTable
ALTER TABLE "PosComplaint" ADD COLUMN     "aiCategory" "PosComplaintCategory",
ADD COLUMN     "aiLabeledAt" TIMESTAMP(3),
ADD COLUMN     "aiSummary" TEXT,
ADD COLUMN     "languageGuess" TEXT;

-- CreateTable
CREATE TABLE "PosAiPackage" (
    "restaurantId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "monthlyLimit" INTEGER NOT NULL DEFAULT 0,
    "syncedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosAiPackage_pkey" PRIMARY KEY ("restaurantId")
);

-- CreateTable
CREATE TABLE "PosAiUsageMonth" (
    "restaurantId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosAiUsageMonth_pkey" PRIMARY KEY ("restaurantId","month")
);

-- CreateTable
CREATE TABLE "PosAiCall" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "staffId" TEXT,
    "feature" "PosAiFeature" NOT NULL,
    "model" TEXT NOT NULL,
    "status" "PosAiCallStatus" NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "toolCalls" INTEGER NOT NULL DEFAULT 0,
    "ms" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosAiCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosAiSummary" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "kind" "PosAiSummaryKind" NOT NULL,
    "periodFrom" TEXT NOT NULL,
    "periodTo" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "factsHash" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosAiSummary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PosAiCall_restaurantId_createdAt_idx" ON "PosAiCall"("restaurantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PosAiSummary_restaurantId_kind_periodFrom_periodTo_locale_key" ON "PosAiSummary"("restaurantId", "kind", "periodFrom", "periodTo", "locale");

-- CreateIndex
CREATE INDEX "PosComplaint_restaurantId_aiLabeledAt_idx" ON "PosComplaint"("restaurantId", "aiLabeledAt");

-- AddForeignKey
ALTER TABLE "PosAiPackage" ADD CONSTRAINT "PosAiPackage_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosAiUsageMonth" ADD CONSTRAINT "PosAiUsageMonth_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosAiCall" ADD CONSTRAINT "PosAiCall_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosAiSummary" ADD CONSTRAINT "PosAiSummary_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
