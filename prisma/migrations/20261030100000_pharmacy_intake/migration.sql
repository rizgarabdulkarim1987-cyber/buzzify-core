-- CreateEnum
CREATE TYPE "PhIntakeBatchStatus" AS ENUM ('OPEN', 'APPROVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PhIntakeFileStatus" AS ENUM ('UPLOADED', 'REJECTED_QUALITY', 'EXTRACTING', 'EXTRACTED', 'FAILED', 'PURGED');

-- CreateTable
CREATE TABLE "PhIntakeBatch" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "supplierId" TEXT,
    "status" "PhIntakeBatchStatus" NOT NULL DEFAULT 'OPEN',
    "header" JSONB NOT NULL DEFAULT '{}',
    "receiptId" TEXT,
    "clientKey" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhIntakeBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhIntakeFile" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageKey" TEXT,
    "mediaType" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "pages" INTEGER NOT NULL,
    "quality" JSONB NOT NULL DEFAULT '{}',
    "status" "PhIntakeFileStatus" NOT NULL DEFAULT 'UPLOADED',
    "failureCode" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "extractedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhIntakeFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhIntakeRow" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "page" INTEGER NOT NULL,
    "extracted" JSONB NOT NULL,
    "edited" JSONB NOT NULL DEFAULT '{}',
    "matchedProductId" TEXT,
    "matchedUnitId" TEXT,
    "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reviewed" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,

    CONSTRAINT "PhIntakeRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhAiUsageMonth" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "spentMicroUsd" BIGINT NOT NULL DEFAULT 0,
    "reservedMicroUsd" BIGINT NOT NULL DEFAULT 0,
    "calls" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" BIGINT NOT NULL DEFAULT 0,
    "outputTokens" BIGINT NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhAiUsageMonth_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhAiCall" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "ms" INTEGER,
    "status" TEXT NOT NULL,
    "costMicroUsd" BIGINT NOT NULL DEFAULT 0,
    "fileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhAiCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PhIntakeBatch_restaurantId_branchId_status_createdAt_idx" ON "PhIntakeBatch"("restaurantId", "branchId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PhIntakeBatch_restaurantId_id_key" ON "PhIntakeBatch"("restaurantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PhIntakeBatch_restaurantId_clientKey_key" ON "PhIntakeBatch"("restaurantId", "clientKey");

-- CreateIndex
CREATE UNIQUE INDEX "PhIntakeBatch_restaurantId_receiptId_key" ON "PhIntakeBatch"("restaurantId", "receiptId");

-- CreateIndex
CREATE INDEX "PhIntakeFile_restaurantId_batchId_idx" ON "PhIntakeFile"("restaurantId", "batchId");

-- CreateIndex
CREATE INDEX "PhIntakeFile_status_expiresAt_idx" ON "PhIntakeFile"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PhIntakeFile_restaurantId_id_key" ON "PhIntakeFile"("restaurantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PhIntakeFile_restaurantId_sha256_key" ON "PhIntakeFile"("restaurantId", "sha256");

-- CreateIndex
CREATE INDEX "PhIntakeRow_restaurantId_matchedProductId_idx" ON "PhIntakeRow"("restaurantId", "matchedProductId");

-- CreateIndex
CREATE UNIQUE INDEX "PhIntakeRow_restaurantId_id_key" ON "PhIntakeRow"("restaurantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PhIntakeRow_fileId_lineNo_key" ON "PhIntakeRow"("fileId", "lineNo");

-- CreateIndex
CREATE UNIQUE INDEX "PhAiUsageMonth_restaurantId_id_key" ON "PhAiUsageMonth"("restaurantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PhAiUsageMonth_restaurantId_month_key" ON "PhAiUsageMonth"("restaurantId", "month");

-- CreateIndex
CREATE INDEX "PhAiCall_restaurantId_createdAt_idx" ON "PhAiCall"("restaurantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PhAiCall_restaurantId_id_key" ON "PhAiCall"("restaurantId", "id");

-- AddForeignKey
ALTER TABLE "PhIntakeBatch" ADD CONSTRAINT "PhIntakeBatch_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhIntakeBatch" ADD CONSTRAINT "PhIntakeBatch_restaurantId_branchId_fkey" FOREIGN KEY ("restaurantId", "branchId") REFERENCES "Branch"("restaurantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhIntakeBatch" ADD CONSTRAINT "PhIntakeBatch_restaurantId_supplierId_fkey" FOREIGN KEY ("restaurantId", "supplierId") REFERENCES "PhSupplier"("restaurantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhIntakeBatch" ADD CONSTRAINT "PhIntakeBatch_restaurantId_receiptId_fkey" FOREIGN KEY ("restaurantId", "receiptId") REFERENCES "PhReceipt"("restaurantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhIntakeFile" ADD CONSTRAINT "PhIntakeFile_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhIntakeFile" ADD CONSTRAINT "PhIntakeFile_restaurantId_batchId_fkey" FOREIGN KEY ("restaurantId", "batchId") REFERENCES "PhIntakeBatch"("restaurantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhIntakeRow" ADD CONSTRAINT "PhIntakeRow_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhIntakeRow" ADD CONSTRAINT "PhIntakeRow_restaurantId_fileId_fkey" FOREIGN KEY ("restaurantId", "fileId") REFERENCES "PhIntakeFile"("restaurantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhIntakeRow" ADD CONSTRAINT "PhIntakeRow_restaurantId_matchedProductId_fkey" FOREIGN KEY ("restaurantId", "matchedProductId") REFERENCES "PhProduct"("restaurantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhIntakeRow" ADD CONSTRAINT "PhIntakeRow_matchedProductId_matchedUnitId_fkey" FOREIGN KEY ("matchedProductId", "matchedUnitId") REFERENCES "PhProductUnit"("productId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhAiUsageMonth" ADD CONSTRAINT "PhAiUsageMonth_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhAiCall" ADD CONSTRAINT "PhAiCall_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Invoice intake (phase 5). Additive only: new tables, enums, constraints and one trigger on a new table.

-- An approved batch has made its receipt: the receipt and the approval time are both there.
ALTER TABLE "PhIntakeBatch" ADD CONSTRAINT "PhIntakeBatch_approved_needs_receipt" CHECK ("status" <> 'APPROVED' OR ("receiptId" IS NOT NULL AND "approvedAt" IS NOT NULL));

-- A file: the hash is 64 lower-case hex characters; four media types; 1 byte to 8 MiB; 1 to 10 pages; a purged file has
-- let go of its storage key; a failure code only where the file failed or was refused for its quality.
ALTER TABLE "PhIntakeFile" ADD CONSTRAINT "PhIntakeFile_sha256_format" CHECK ("sha256" ~ '^[0-9a-f]{64}$');
ALTER TABLE "PhIntakeFile" ADD CONSTRAINT "PhIntakeFile_mediaType_allowed" CHECK ("mediaType" IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf'));
ALTER TABLE "PhIntakeFile" ADD CONSTRAINT "PhIntakeFile_bytes_range" CHECK ("bytes" >= 1 AND "bytes" <= 8388608);
ALTER TABLE "PhIntakeFile" ADD CONSTRAINT "PhIntakeFile_pages_range" CHECK ("pages" >= 1 AND "pages" <= 10);
ALTER TABLE "PhIntakeFile" ADD CONSTRAINT "PhIntakeFile_attempts_not_negative" CHECK ("attempts" >= 0);
ALTER TABLE "PhIntakeFile" ADD CONSTRAINT "PhIntakeFile_purged_no_key" CHECK ("status" <> 'PURGED' OR "storageKey" IS NULL);
ALTER TABLE "PhIntakeFile" ADD CONSTRAINT "PhIntakeFile_failureCode_when_failed" CHECK ("failureCode" IS NULL OR "status" IN ('FAILED', 'REJECTED_QUALITY'));

-- A row: numbered and paged from 1; the matched product and unit come together; a short reviewer note.
ALTER TABLE "PhIntakeRow" ADD CONSTRAINT "PhIntakeRow_lineNo_positive" CHECK ("lineNo" >= 1);
ALTER TABLE "PhIntakeRow" ADD CONSTRAINT "PhIntakeRow_page_positive" CHECK ("page" >= 1);
ALTER TABLE "PhIntakeRow" ADD CONSTRAINT "PhIntakeRow_match_together" CHECK (("matchedProductId" IS NULL) = ("matchedUnitId" IS NULL));
ALTER TABLE "PhIntakeRow" ADD CONSTRAINT "PhIntakeRow_note_length" CHECK ("note" IS NULL OR length("note") <= 500);

-- Usage: a month as YYYY-MM (01..12); nothing below zero.
ALTER TABLE "PhAiUsageMonth" ADD CONSTRAINT "PhAiUsageMonth_month_format" CHECK ("month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
ALTER TABLE "PhAiUsageMonth" ADD CONSTRAINT "PhAiUsageMonth_not_negative" CHECK ("spentMicroUsd" >= 0 AND "reservedMicroUsd" >= 0 AND "calls" >= 0 AND "inputTokens" >= 0 AND "outputTokens" >= 0);

-- The call log: one of four outcomes; nothing below zero.
ALTER TABLE "PhAiCall" ADD CONSTRAINT "PhAiCall_status_allowed" CHECK ("status" IN ('OK', 'ERROR', 'BUDGET', 'TIMEOUT'));
ALTER TABLE "PhAiCall" ADD CONSTRAINT "PhAiCall_not_negative" CHECK ("costMicroUsd" >= 0 AND ("inputTokens" IS NULL OR "inputTokens" >= 0) AND ("outputTokens" IS NULL OR "outputTokens" >= 0) AND ("ms" IS NULL OR "ms" >= 0));

-- The call log is append-only (same function as the purchasing ledgers; the delete of a whole business is the one removal
-- allowed).
CREATE TRIGGER "PhAiCall_append_only" BEFORE UPDATE OR DELETE ON "PhAiCall" FOR EACH ROW EXECUTE FUNCTION "PhPurchasing_append_only"();
