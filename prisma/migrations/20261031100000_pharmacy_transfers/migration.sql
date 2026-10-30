-- CreateEnum
CREATE TYPE "PhTransferStatus" AS ENUM ('REQUESTED', 'SENT', 'RECEIVED', 'PARTIAL', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PhTransferDiffReason" AS ENUM ('LOST', 'DAMAGED_IN_TRANSIT', 'OTHER');

-- CreateTable
CREATE TABLE "PhTransfer" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "fromBranchId" TEXT NOT NULL,
    "toBranchId" TEXT NOT NULL,
    "status" "PhTransferStatus" NOT NULL DEFAULT 'REQUESTED',
    "number" TEXT,
    "clientKey" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "requestedById" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentById" TEXT,
    "sentAt" TIMESTAMP(3),
    "receivedById" TEXT,
    "receivedAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhTransferLine" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "transferId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "productId" TEXT NOT NULL,
    "batchId" TEXT,
    "requestedQty" INTEGER NOT NULL,
    "sentQty" INTEGER NOT NULL DEFAULT 0,
    "receivedQty" INTEGER NOT NULL DEFAULT 0,
    "lostQty" INTEGER NOT NULL DEFAULT 0,
    "damagedQty" INTEGER NOT NULL DEFAULT 0,
    "diffReason" "PhTransferDiffReason",
    "quarantine" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PhTransferLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PhTransfer_restaurantId_fromBranchId_status_idx" ON "PhTransfer"("restaurantId", "fromBranchId", "status");

-- CreateIndex
CREATE INDEX "PhTransfer_restaurantId_toBranchId_status_idx" ON "PhTransfer"("restaurantId", "toBranchId", "status");

-- CreateIndex
CREATE INDEX "PhTransfer_restaurantId_status_sentAt_idx" ON "PhTransfer"("restaurantId", "status", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "PhTransfer_restaurantId_id_key" ON "PhTransfer"("restaurantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PhTransfer_restaurantId_clientKey_key" ON "PhTransfer"("restaurantId", "clientKey");

-- CreateIndex
CREATE UNIQUE INDEX "PhTransfer_fromBranchId_number_key" ON "PhTransfer"("fromBranchId", "number");

-- CreateIndex
CREATE INDEX "PhTransferLine_restaurantId_batchId_idx" ON "PhTransferLine"("restaurantId", "batchId");

-- CreateIndex
CREATE INDEX "PhTransferLine_restaurantId_productId_idx" ON "PhTransferLine"("restaurantId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "PhTransferLine_restaurantId_id_key" ON "PhTransferLine"("restaurantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PhTransferLine_transferId_lineNo_key" ON "PhTransferLine"("transferId", "lineNo");

-- AddForeignKey
ALTER TABLE "PhTransfer" ADD CONSTRAINT "PhTransfer_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhTransfer" ADD CONSTRAINT "PhTransfer_restaurantId_fromBranchId_fkey" FOREIGN KEY ("restaurantId", "fromBranchId") REFERENCES "Branch"("restaurantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhTransfer" ADD CONSTRAINT "PhTransfer_restaurantId_toBranchId_fkey" FOREIGN KEY ("restaurantId", "toBranchId") REFERENCES "Branch"("restaurantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhTransferLine" ADD CONSTRAINT "PhTransferLine_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhTransferLine" ADD CONSTRAINT "PhTransferLine_restaurantId_transferId_fkey" FOREIGN KEY ("restaurantId", "transferId") REFERENCES "PhTransfer"("restaurantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhTransferLine" ADD CONSTRAINT "PhTransferLine_restaurantId_productId_fkey" FOREIGN KEY ("restaurantId", "productId") REFERENCES "PhProduct"("restaurantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhTransferLine" ADD CONSTRAINT "PhTransferLine_restaurantId_batchId_fkey" FOREIGN KEY ("restaurantId", "batchId") REFERENCES "PhBatch"("restaurantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;



-- Stock transfers between two branches (phase 6). Additive only: new enums, tables, indexes and constraints.

-- A transfer goes from one branch to a different one.
ALTER TABLE "PhTransfer" ADD CONSTRAINT "PhTransfer_two_branches" CHECK ("fromBranchId" <> "toBranchId");
ALTER TABLE "PhTransfer" ADD CONSTRAINT "PhTransfer_note_length" CHECK (length("note") <= 500);

-- Each status implies its timestamps: sent (and later) says who sent it and when; received or partial has a receive time;
-- cancelled has a cancel time and was never sent; a request is neither sent nor received.
ALTER TABLE "PhTransfer" ADD CONSTRAINT "PhTransfer_sent_needs_sender" CHECK ("status" NOT IN ('SENT', 'RECEIVED', 'PARTIAL') OR ("sentAt" IS NOT NULL AND "sentById" IS NOT NULL));
ALTER TABLE "PhTransfer" ADD CONSTRAINT "PhTransfer_received_needs_time" CHECK ("status" NOT IN ('RECEIVED', 'PARTIAL') OR "receivedAt" IS NOT NULL);
ALTER TABLE "PhTransfer" ADD CONSTRAINT "PhTransfer_cancelled_never_sent" CHECK ("status" <> 'CANCELLED' OR ("cancelledAt" IS NOT NULL AND "sentAt" IS NULL));
ALTER TABLE "PhTransfer" ADD CONSTRAINT "PhTransfer_requested_not_sent" CHECK ("status" <> 'REQUESTED' OR ("sentAt" IS NULL AND "receivedAt" IS NULL));

-- A line: numbered from 1; at least one unit requested; no quantity below zero; what was received, lost or damaged in transit
-- never exceeds what was sent; a lost or damaged quantity says why; a line with no batch has not been sent.
ALTER TABLE "PhTransferLine" ADD CONSTRAINT "PhTransferLine_lineNo_positive" CHECK ("lineNo" >= 1);
ALTER TABLE "PhTransferLine" ADD CONSTRAINT "PhTransferLine_requestedQty_positive" CHECK ("requestedQty" >= 1);
ALTER TABLE "PhTransferLine" ADD CONSTRAINT "PhTransferLine_qty_not_negative" CHECK ("sentQty" >= 0 AND "receivedQty" >= 0 AND "lostQty" >= 0 AND "damagedQty" >= 0);
ALTER TABLE "PhTransferLine" ADD CONSTRAINT "PhTransferLine_accounted_within_sent" CHECK ("receivedQty" + "lostQty" + "damagedQty" <= "sentQty");
ALTER TABLE "PhTransferLine" ADD CONSTRAINT "PhTransferLine_loss_needs_reason" CHECK (("lostQty" = 0 AND "damagedQty" = 0) OR "diffReason" IS NOT NULL);
ALTER TABLE "PhTransferLine" ADD CONSTRAINT "PhTransferLine_unsent_has_no_batch" CHECK ("batchId" IS NOT NULL OR "sentQty" = 0);
