-- CreateEnum
CREATE TYPE "CashierLinkStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "LinkEventType" AS ENUM ('CATALOG_CHANGED', 'LINK_REVOKED', 'PLAN_CHANGED');

-- CreateTable
CREATE TABLE "CashierLink" (
    "id" TEXT NOT NULL,
    "menuId" TEXT NOT NULL,
    "status" "CashierLinkStatus" NOT NULL DEFAULT 'ACTIVE',
    "secretCiphertext" TEXT NOT NULL,
    "cashierBaseUrl" TEXT NOT NULL,
    "cashierBusinessRef" TEXT NOT NULL,
    "cashierBusinessName" TEXT NOT NULL,
    "coreBusinessId" TEXT,
    "pairedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),

    CONSTRAINT "CashierLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashierPairingCode" (
    "id" TEXT NOT NULL,
    "menuId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashierPairingCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashierLinkEvent" (
    "id" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" "LinkEventType" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),
    "lastError" TEXT,

    CONSTRAINT "CashierLinkEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashierImportBatch" (
    "id" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "batchKey" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashierImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LinkRateLimit" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "LinkRateLimit_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "CashierLink_menuId_status_idx" ON "CashierLink"("menuId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CashierPairingCode_codeHash_key" ON "CashierPairingCode"("codeHash");

-- CreateIndex
CREATE INDEX "CashierPairingCode_menuId_idx" ON "CashierPairingCode"("menuId");

-- CreateIndex
CREATE UNIQUE INDEX "CashierLinkEvent_eventId_key" ON "CashierLinkEvent"("eventId");

-- CreateIndex
CREATE INDEX "CashierLinkEvent_deliveredAt_nextAttemptAt_idx" ON "CashierLinkEvent"("deliveredAt", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "CashierLinkEvent_linkId_idx" ON "CashierLinkEvent"("linkId");

-- CreateIndex
CREATE UNIQUE INDEX "CashierImportBatch_linkId_batchKey_key" ON "CashierImportBatch"("linkId", "batchKey");

-- AddForeignKey
ALTER TABLE "CashierLink" ADD CONSTRAINT "CashierLink_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "Menu"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashierPairingCode" ADD CONSTRAINT "CashierPairingCode_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "Menu"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashierLinkEvent" ADD CONSTRAINT "CashierLinkEvent_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "CashierLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashierImportBatch" ADD CONSTRAINT "CashierImportBatch_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "CashierLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;
