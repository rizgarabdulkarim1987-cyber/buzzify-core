-- CreateEnum
CREATE TYPE "PhBatchStatus" AS ENUM ('ACTIVE', 'RECALLED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "PhExpiryPrecision" AS ENUM ('DAY', 'MONTH');

-- CreateEnum
CREATE TYPE "PhMovementType" AS ENUM ('RECEIPT', 'SALE', 'RETURN_IN', 'RETURN_QUARANTINE', 'ADJUST', 'DAMAGE', 'TRANSFER_OUT', 'TRANSFER_IN', 'SUPPLIER_RETURN', 'COUNT', 'QUARANTINE_RELEASE');

-- CreateEnum
CREATE TYPE "PhStockBucket" AS ENUM ('AVAILABLE', 'RESERVED', 'QUARANTINE', 'DAMAGED');

-- CreateEnum
CREATE TYPE "PhReceiptStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'VOID');

-- CreateEnum
CREATE TYPE "PhCountStatus" AS ENUM ('OPEN', 'SUBMITTED', 'APPROVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PhCountScope" AS ENUM ('BRANCH', 'CATEGORY', 'LOCATION');

-- CreateEnum
CREATE TYPE "PhExpiryStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'MOVED', 'DISPOSED', 'RETURNED');

-- CreateTable
CREATE TABLE "PhBatch" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "lot" TEXT NOT NULL,
    "expiryDate" DATE NOT NULL,
    "expiryPrecision" "PhExpiryPrecision" NOT NULL DEFAULT 'DAY',
    "supplierName" TEXT NOT NULL DEFAULT '',
    "status" "PhBatchStatus" NOT NULL DEFAULT 'ACTIVE',
    "unitCostMinor" BIGINT,
    "costCurrency" "Currency",
    "costUnitId" TEXT,
    "receiptLineId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhStockBalance" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "available" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "quarantine" INTEGER NOT NULL DEFAULT 0,
    "damaged" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhStockBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhStockMovement" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "type" "PhMovementType" NOT NULL,
    "availableDelta" INTEGER NOT NULL DEFAULT 0,
    "reservedDelta" INTEGER NOT NULL DEFAULT 0,
    "quarantineDelta" INTEGER NOT NULL DEFAULT 0,
    "damagedDelta" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT NOT NULL DEFAULT '',
    "userId" TEXT NOT NULL,
    "reversesId" TEXT,
    "receiptId" TEXT,
    "countId" TEXT,
    "refType" TEXT,
    "refId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhStockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhReceipt" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "status" "PhReceiptStatus" NOT NULL DEFAULT 'DRAFT',
    "clientKey" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL DEFAULT '',
    "invoiceRef" TEXT NOT NULL DEFAULT '',
    "receivedOn" DATE NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT NOT NULL,
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhReceiptLine" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "productId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "baseQty" INTEGER NOT NULL,
    "lot" TEXT NOT NULL,
    "expiryDate" DATE NOT NULL,
    "expiryPrecision" "PhExpiryPrecision" NOT NULL DEFAULT 'DAY',
    "unitCostMinor" BIGINT,
    "costCurrency" "Currency",
    "batchId" TEXT,

    CONSTRAINT "PhReceiptLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhStockCount" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "status" "PhCountStatus" NOT NULL DEFAULT 'OPEN',
    "scope" "PhCountScope" NOT NULL DEFAULT 'BRANCH',
    "scopeValue" TEXT NOT NULL DEFAULT '',
    "blind" BOOLEAN NOT NULL DEFAULT false,
    "countedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "reason" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhStockCount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhStockCountLine" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "countId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "expectedQty" INTEGER NOT NULL,
    "countedQty" INTEGER,

    CONSTRAINT "PhStockCountLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhExpiryAction" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "status" "PhExpiryStatus" NOT NULL DEFAULT 'NEW',
    "assigneeId" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhExpiryAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PhBatch_restaurantId_productId_idx" ON "PhBatch"("restaurantId", "productId");

-- CreateIndex
CREATE INDEX "PhBatch_restaurantId_expiryDate_idx" ON "PhBatch"("restaurantId", "expiryDate");

-- CreateIndex
CREATE UNIQUE INDEX "PhBatch_restaurantId_productId_lot_expiryDate_supplierName_key" ON "PhBatch"("restaurantId", "productId", "lot", "expiryDate", "supplierName");

-- CreateIndex
CREATE UNIQUE INDEX "PhBatch_restaurantId_id_key" ON "PhBatch"("restaurantId", "id");

-- CreateIndex
CREATE INDEX "PhStockBalance_restaurantId_branchId_productId_idx" ON "PhStockBalance"("restaurantId", "branchId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "PhStockBalance_batchId_branchId_key" ON "PhStockBalance"("batchId", "branchId");

-- CreateIndex
CREATE INDEX "PhStockMovement_restaurantId_branchId_productId_createdAt_idx" ON "PhStockMovement"("restaurantId", "branchId", "productId", "createdAt");

-- CreateIndex
CREATE INDEX "PhStockMovement_restaurantId_batchId_createdAt_idx" ON "PhStockMovement"("restaurantId", "batchId", "createdAt");

-- CreateIndex
CREATE INDEX "PhStockMovement_receiptId_idx" ON "PhStockMovement"("receiptId");

-- CreateIndex
CREATE INDEX "PhStockMovement_countId_idx" ON "PhStockMovement"("countId");

-- CreateIndex
CREATE INDEX "PhReceipt_restaurantId_branchId_status_createdAt_idx" ON "PhReceipt"("restaurantId", "branchId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PhReceipt_restaurantId_clientKey_key" ON "PhReceipt"("restaurantId", "clientKey");

-- CreateIndex
CREATE UNIQUE INDEX "PhReceipt_restaurantId_id_key" ON "PhReceipt"("restaurantId", "id");

-- CreateIndex
CREATE INDEX "PhReceiptLine_restaurantId_productId_idx" ON "PhReceiptLine"("restaurantId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "PhReceiptLine_receiptId_lineNo_key" ON "PhReceiptLine"("receiptId", "lineNo");

-- CreateIndex
CREATE INDEX "PhStockCount_restaurantId_branchId_status_createdAt_idx" ON "PhStockCount"("restaurantId", "branchId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PhStockCount_restaurantId_id_key" ON "PhStockCount"("restaurantId", "id");

-- CreateIndex
CREATE INDEX "PhStockCountLine_restaurantId_productId_idx" ON "PhStockCountLine"("restaurantId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "PhStockCountLine_countId_batchId_key" ON "PhStockCountLine"("countId", "batchId");

-- CreateIndex
CREATE INDEX "PhExpiryAction_restaurantId_branchId_status_idx" ON "PhExpiryAction"("restaurantId", "branchId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PhExpiryAction_batchId_branchId_key" ON "PhExpiryAction"("batchId", "branchId");

-- AddForeignKey
ALTER TABLE "PhBatch" ADD CONSTRAINT "PhBatch_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhBatch" ADD CONSTRAINT "PhBatch_restaurantId_productId_fkey" FOREIGN KEY ("restaurantId", "productId") REFERENCES "PhProduct"("restaurantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhBatch" ADD CONSTRAINT "PhBatch_productId_costUnitId_fkey" FOREIGN KEY ("productId", "costUnitId") REFERENCES "PhProductUnit"("productId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhStockBalance" ADD CONSTRAINT "PhStockBalance_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhStockBalance" ADD CONSTRAINT "PhStockBalance_restaurantId_branchId_fkey" FOREIGN KEY ("restaurantId", "branchId") REFERENCES "Branch"("restaurantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhStockBalance" ADD CONSTRAINT "PhStockBalance_restaurantId_productId_fkey" FOREIGN KEY ("restaurantId", "productId") REFERENCES "PhProduct"("restaurantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhStockBalance" ADD CONSTRAINT "PhStockBalance_restaurantId_batchId_fkey" FOREIGN KEY ("restaurantId", "batchId") REFERENCES "PhBatch"("restaurantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhStockMovement" ADD CONSTRAINT "PhStockMovement_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhStockMovement" ADD CONSTRAINT "PhStockMovement_restaurantId_branchId_fkey" FOREIGN KEY ("restaurantId", "branchId") REFERENCES "Branch"("restaurantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhStockMovement" ADD CONSTRAINT "PhStockMovement_restaurantId_productId_fkey" FOREIGN KEY ("restaurantId", "productId") REFERENCES "PhProduct"("restaurantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhStockMovement" ADD CONSTRAINT "PhStockMovement_restaurantId_batchId_fkey" FOREIGN KEY ("restaurantId", "batchId") REFERENCES "PhBatch"("restaurantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhStockMovement" ADD CONSTRAINT "PhStockMovement_reversesId_fkey" FOREIGN KEY ("reversesId") REFERENCES "PhStockMovement"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhStockMovement" ADD CONSTRAINT "PhStockMovement_restaurantId_receiptId_fkey" FOREIGN KEY ("restaurantId", "receiptId") REFERENCES "PhReceipt"("restaurantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhStockMovement" ADD CONSTRAINT "PhStockMovement_restaurantId_countId_fkey" FOREIGN KEY ("restaurantId", "countId") REFERENCES "PhStockCount"("restaurantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhReceipt" ADD CONSTRAINT "PhReceipt_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhReceipt" ADD CONSTRAINT "PhReceipt_restaurantId_branchId_fkey" FOREIGN KEY ("restaurantId", "branchId") REFERENCES "Branch"("restaurantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhReceiptLine" ADD CONSTRAINT "PhReceiptLine_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhReceiptLine" ADD CONSTRAINT "PhReceiptLine_restaurantId_receiptId_fkey" FOREIGN KEY ("restaurantId", "receiptId") REFERENCES "PhReceipt"("restaurantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhReceiptLine" ADD CONSTRAINT "PhReceiptLine_restaurantId_productId_fkey" FOREIGN KEY ("restaurantId", "productId") REFERENCES "PhProduct"("restaurantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhReceiptLine" ADD CONSTRAINT "PhReceiptLine_productId_unitId_fkey" FOREIGN KEY ("productId", "unitId") REFERENCES "PhProductUnit"("productId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhReceiptLine" ADD CONSTRAINT "PhReceiptLine_restaurantId_batchId_fkey" FOREIGN KEY ("restaurantId", "batchId") REFERENCES "PhBatch"("restaurantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhStockCount" ADD CONSTRAINT "PhStockCount_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhStockCount" ADD CONSTRAINT "PhStockCount_restaurantId_branchId_fkey" FOREIGN KEY ("restaurantId", "branchId") REFERENCES "Branch"("restaurantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhStockCountLine" ADD CONSTRAINT "PhStockCountLine_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhStockCountLine" ADD CONSTRAINT "PhStockCountLine_restaurantId_countId_fkey" FOREIGN KEY ("restaurantId", "countId") REFERENCES "PhStockCount"("restaurantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhStockCountLine" ADD CONSTRAINT "PhStockCountLine_restaurantId_productId_fkey" FOREIGN KEY ("restaurantId", "productId") REFERENCES "PhProduct"("restaurantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhStockCountLine" ADD CONSTRAINT "PhStockCountLine_restaurantId_batchId_fkey" FOREIGN KEY ("restaurantId", "batchId") REFERENCES "PhBatch"("restaurantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhExpiryAction" ADD CONSTRAINT "PhExpiryAction_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhExpiryAction" ADD CONSTRAINT "PhExpiryAction_restaurantId_branchId_fkey" FOREIGN KEY ("restaurantId", "branchId") REFERENCES "Branch"("restaurantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhExpiryAction" ADD CONSTRAINT "PhExpiryAction_restaurantId_batchId_fkey" FOREIGN KEY ("restaurantId", "batchId") REFERENCES "PhBatch"("restaurantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- Stock rules the schema language cannot say. Every bucket of a balance is a whole number of base units, never below zero:
-- the conditional update in applyMovement relies on it, and it holds even if code forgets.
ALTER TABLE "PhStockBalance" ADD CONSTRAINT "PhStockBalance_available_nonnegative" CHECK ("available" >= 0);
ALTER TABLE "PhStockBalance" ADD CONSTRAINT "PhStockBalance_reserved_nonnegative" CHECK ("reserved" >= 0);
ALTER TABLE "PhStockBalance" ADD CONSTRAINT "PhStockBalance_quarantine_nonnegative" CHECK ("quarantine" >= 0);
ALTER TABLE "PhStockBalance" ADD CONSTRAINT "PhStockBalance_damaged_nonnegative" CHECK ("damaged" >= 0);

-- A batch's cost: not negative, and cost, currency and the unit it was bought in are all set or all null.
ALTER TABLE "PhBatch" ADD CONSTRAINT "PhBatch_unitCostMinor_nonnegative" CHECK ("unitCostMinor" IS NULL OR "unitCostMinor" >= 0);
ALTER TABLE "PhBatch" ADD CONSTRAINT "PhBatch_cost_together" CHECK (("unitCostMinor" IS NULL) = ("costCurrency" IS NULL) AND ("unitCostMinor" IS NULL) = ("costUnitId" IS NULL));

-- A movement changes something; a receipt (not a reversal) only adds to available.
ALTER TABLE "PhStockMovement" ADD CONSTRAINT "PhStockMovement_some_delta" CHECK ("availableDelta" <> 0 OR "reservedDelta" <> 0 OR "quarantineDelta" <> 0 OR "damagedDelta" <> 0);
ALTER TABLE "PhStockMovement" ADD CONSTRAINT "PhStockMovement_receipt_adds" CHECK ("type" <> 'RECEIPT' OR "reversesId" IS NOT NULL OR ("availableDelta" > 0 AND "reservedDelta" = 0 AND "quarantineDelta" = 0 AND "damagedDelta" = 0));

-- A movement is corrected once: one reversal per original.
CREATE UNIQUE INDEX "PhStockMovement_one_reversal" ON "PhStockMovement" ("reversesId") WHERE "reversesId" IS NOT NULL;

-- The ledger is append-only. A direct UPDATE or DELETE is refused; the delete of a whole business (a cascade, which runs
-- inside the foreign key's own trigger) is the one removal allowed.
CREATE FUNCTION "PhStockMovement_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'PhStockMovement is append-only: % refused', TG_OP;
END;
$$;
CREATE TRIGGER "PhStockMovement_append_only" BEFORE UPDATE OR DELETE ON "PhStockMovement" FOR EACH ROW EXECUTE FUNCTION "PhStockMovement_append_only"();

-- A receipt line: a quantity of at least one, the same in base units, a cost that is not negative and comes with its currency.
ALTER TABLE "PhReceiptLine" ADD CONSTRAINT "PhReceiptLine_qty_positive" CHECK ("qty" >= 1);
ALTER TABLE "PhReceiptLine" ADD CONSTRAINT "PhReceiptLine_baseQty_positive" CHECK ("baseQty" >= 1);
ALTER TABLE "PhReceiptLine" ADD CONSTRAINT "PhReceiptLine_unitCostMinor_nonnegative" CHECK ("unitCostMinor" IS NULL OR "unitCostMinor" >= 0);
ALTER TABLE "PhReceiptLine" ADD CONSTRAINT "PhReceiptLine_cost_together" CHECK (("unitCostMinor" IS NULL) = ("costCurrency" IS NULL));

-- A count line: nothing negative, expected or counted.
ALTER TABLE "PhStockCountLine" ADD CONSTRAINT "PhStockCountLine_expectedQty_nonnegative" CHECK ("expectedQty" >= 0);
ALTER TABLE "PhStockCountLine" ADD CONSTRAINT "PhStockCountLine_countedQty_nonnegative" CHECK ("countedQty" IS NULL OR "countedQty" >= 0);
