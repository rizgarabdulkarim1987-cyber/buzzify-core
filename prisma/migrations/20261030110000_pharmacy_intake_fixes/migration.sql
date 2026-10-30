-- AlterTable
ALTER TABLE "PhIntakeFile" ADD COLUMN     "extractingSince" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PhAiReservation" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "microUsd" BIGINT NOT NULL,
    "fileId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhAiReservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PhAiReservation_restaurantId_createdAt_idx" ON "PhAiReservation"("restaurantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PhAiReservation_restaurantId_id_key" ON "PhAiReservation"("restaurantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PhAiReservation_restaurantId_fileId_key" ON "PhAiReservation"("restaurantId", "fileId");

-- CreateIndex
CREATE INDEX "PhAiCall_restaurantId_fileId_idx" ON "PhAiCall"("restaurantId", "fileId");

-- CreateIndex
CREATE INDEX "PhIntakeFile_restaurantId_status_extractingSince_idx" ON "PhIntakeFile"("restaurantId", "status", "extractingSince");

-- CreateIndex
CREATE UNIQUE INDEX "PhReceipt_restaurantId_id_branchId_key" ON "PhReceipt"("restaurantId", "id", "branchId");

-- AddForeignKey
ALTER TABLE "PhIntakeBatch" ADD CONSTRAINT "PhIntakeBatch_restaurantId_receiptId_branchId_fkey" FOREIGN KEY ("restaurantId", "receiptId", "branchId") REFERENCES "PhReceipt"("restaurantId", "id", "branchId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhAiReservation" ADD CONSTRAINT "PhAiReservation_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhAiReservation" ADD CONSTRAINT "PhAiReservation_restaurantId_month_fkey" FOREIGN KEY ("restaurantId", "month") REFERENCES "PhAiUsageMonth"("restaurantId", "month") ON DELETE NO ACTION ON UPDATE CASCADE;


-- Hand-added CHECKs (no Prisma drift). Tables are new in phase 5, so existing rows satisfy them.
ALTER TABLE "PhIntakeBatch" ADD CONSTRAINT "PhIntakeBatch_cancelled_has_time" CHECK (("status" = 'CANCELLED') = ("cancelledAt" IS NOT NULL));
ALTER TABLE "PhIntakeBatch" ADD CONSTRAINT "PhIntakeBatch_open_has_no_receipt" CHECK ("status" <> 'OPEN' OR "receiptId" IS NULL);
ALTER TABLE "PhIntakeFile" ADD CONSTRAINT "PhIntakeFile_lease_only_when_extracting" CHECK (("status" = 'EXTRACTING') = ("extractingSince" IS NOT NULL));
ALTER TABLE "PhAiReservation" ADD CONSTRAINT "PhAiReservation_positive" CHECK ("microUsd" > 0);
ALTER TABLE "PhAiReservation" ADD CONSTRAINT "PhAiReservation_month_format" CHECK ("month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
ALTER TABLE "PhIntakeRow" ADD CONSTRAINT "PhIntakeRow_flags_not_null" CHECK ("flags" IS NOT NULL);
