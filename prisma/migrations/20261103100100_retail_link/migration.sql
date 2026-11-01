-- CreateTable
CREATE TABLE "RetailLink" (
    "restaurantId" TEXT NOT NULL,
    "retailBusinessId" TEXT,
    "currencies" "Currency"[] DEFAULT ARRAY['IQD']::"Currency"[],
    "aiIntake" BOOLEAN NOT NULL DEFAULT false,
    "stateVersion" INTEGER NOT NULL DEFAULT 0,
    "acceptedVersion" INTEGER NOT NULL DEFAULT 0,
    "sentHash" TEXT,
    "provisionedAt" TIMESTAMP(3),
    "remoteVersion" INTEGER,
    "remoteStatus" TEXT,
    "aiUsageMonth" TEXT,
    "aiUsageHalfUnits" INTEGER,
    "reconciledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RetailLink_pkey" PRIMARY KEY ("restaurantId")
);

-- CreateTable
CREATE TABLE "RetailOutbox" (
    "restaurantId" TEXT NOT NULL,
    "dueVersion" INTEGER NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leasedUntil" TIMESTAMP(3),
    "waitingFor" TEXT,
    "lastError" TEXT,
    "lastAttemptAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RetailOutbox_pkey" PRIMARY KEY ("restaurantId")
);

-- CreateIndex
CREATE INDEX "RetailLink_reconciledAt_idx" ON "RetailLink"("reconciledAt");

-- CreateIndex
CREATE INDEX "RetailOutbox_failedAt_nextAttemptAt_idx" ON "RetailOutbox"("failedAt", "nextAttemptAt");

-- AddForeignKey
ALTER TABLE "RetailLink" ADD CONSTRAINT "RetailLink_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetailOutbox" ADD CONSTRAINT "RetailOutbox_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written CHECKs (Prisma cannot express them)
ALTER TABLE "RetailLink" ADD CONSTRAINT "RetailLink_stateVersion_check" CHECK ("stateVersion" >= 0);
ALTER TABLE "RetailLink" ADD CONSTRAINT "RetailLink_acceptedVersion_check" CHECK ("acceptedVersion" >= 0);
ALTER TABLE "RetailLink" ADD CONSTRAINT "RetailLink_currencies_check" CHECK (cardinality("currencies") BETWEEN 1 AND 2);
ALTER TABLE "RetailOutbox" ADD CONSTRAINT "RetailOutbox_dueVersion_check" CHECK ("dueVersion" >= 1);
ALTER TABLE "RetailOutbox" ADD CONSTRAINT "RetailOutbox_attempts_check" CHECK ("attempts" >= 0);

-- The retail product row: DISABLED until the owner creates plans and prices and enables it.
INSERT INTO "Application" ("id", "name", "status", "sortOrder", "createdAt", "updatedAt")
VALUES ('retail', '{"en": "Retail", "ar": "التجزئة", "ckb": "تاکفرۆشی"}', 'DISABLED', 4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
