-- CreateEnum
CREATE TYPE "PhSaleStatus" AS ENUM ('HELD', 'COMPLETED', 'RETURNED_PARTIAL', 'RETURNED_FULL', 'HOLD_EXPIRED');

-- CreateEnum
CREATE TYPE "PhPaymentMethod" AS ENUM ('CASH', 'CARD_MANUAL', 'TRANSFER_MANUAL');

-- CreateEnum
CREATE TYPE "PhShiftStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "PhCashMovementType" AS ENUM ('FLOAT_OPEN', 'SALE_CASH', 'CHANGE_OUT', 'REFUND_CASH', 'PAID_IN', 'PAID_OUT');

-- AlterTable
ALTER TABLE "PhSettings" ADD COLUMN     "maxDiscountPercent" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "returnWindowDays" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "roundingStepMinor" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "shiftVarianceLimitMinor" BIGINT NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "PhShift" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "openingFloatMinor" BIGINT NOT NULL DEFAULT 0,
    "currency" "Currency" NOT NULL,
    "status" "PhShiftStatus" NOT NULL DEFAULT 'OPEN',
    "countedMinor" BIGINT,
    "expectedMinor" BIGINT,
    "varianceMinor" BIGINT,
    "closeReason" TEXT NOT NULL DEFAULT '',
    "approvedById" TEXT,

    CONSTRAINT "PhShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhCashMovement" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "type" "PhCashMovementType" NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" "Currency" NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "refType" TEXT,
    "refId" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhCashMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhSale" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "number" TEXT,
    "status" "PhSaleStatus" NOT NULL DEFAULT 'HELD',
    "currency" "Currency" NOT NULL,
    "subtotalMinor" BIGINT NOT NULL DEFAULT 0,
    "discountMinor" BIGINT NOT NULL DEFAULT 0,
    "roundingMinor" BIGINT NOT NULL DEFAULT 0,
    "totalMinor" BIGINT NOT NULL DEFAULT 0,
    "paidMinor" BIGINT NOT NULL DEFAULT 0,
    "changeMinor" BIGINT NOT NULL DEFAULT 0,
    "clientKey" TEXT NOT NULL,
    "soldById" TEXT NOT NULL,
    "pharmacistId" TEXT,
    "heldUntil" TIMESTAMP(3),
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "PhSale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhSaleLine" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "productId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "priceId" TEXT,
    "qty" INTEGER NOT NULL,
    "baseQty" INTEGER NOT NULL,
    "unitPriceMinor" BIGINT NOT NULL,
    "discountMinor" BIGINT NOT NULL DEFAULT 0,
    "totalMinor" BIGINT NOT NULL,
    "rxLevel" "PhRxLevel" NOT NULL DEFAULT 'OTC',
    "pharmacistId" TEXT,
    "priceOverrideReason" TEXT NOT NULL DEFAULT '',
    "discountReason" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "PhSaleLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhSaleLineAllocation" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "saleLineId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "baseQty" INTEGER NOT NULL,
    "costSnapshotMinor" BIGINT,
    "costCurrency" "Currency",
    "expirySnapshot" DATE NOT NULL,
    "returnedBaseQty" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PhSaleLineAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhPayment" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "method" "PhPaymentMethod" NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" "Currency" NOT NULL,
    "clientKey" TEXT NOT NULL,
    "reference" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhReturn" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "number" TEXT,
    "reason" TEXT NOT NULL,
    "approvedById" TEXT NOT NULL,
    "refundMethod" "PhPaymentMethod" NOT NULL,
    "refundMinor" BIGINT NOT NULL,
    "currency" "Currency" NOT NULL,
    "clientKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhReturnLine" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "saleLineAllocationId" TEXT NOT NULL,
    "baseQty" INTEGER NOT NULL,
    "refundMinor" BIGINT NOT NULL,

    CONSTRAINT "PhReturnLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhReceiptReprint" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "saleId" TEXT,
    "returnId" TEXT,
    "userId" TEXT NOT NULL,
    "copyNumber" INTEGER NOT NULL,
    "printedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhReceiptReprint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PhShift_restaurantId_branchId_status_idx" ON "PhShift"("restaurantId", "branchId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PhShift_restaurantId_id_key" ON "PhShift"("restaurantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PhShift_id_branchId_key" ON "PhShift"("id", "branchId");

-- CreateIndex
CREATE INDEX "PhCashMovement_restaurantId_shiftId_createdAt_idx" ON "PhCashMovement"("restaurantId", "shiftId", "createdAt");

-- CreateIndex
CREATE INDEX "PhSale_restaurantId_branchId_createdAt_idx" ON "PhSale"("restaurantId", "branchId", "createdAt");

-- CreateIndex
CREATE INDEX "PhSale_shiftId_idx" ON "PhSale"("shiftId");

-- CreateIndex
CREATE UNIQUE INDEX "PhSale_restaurantId_clientKey_key" ON "PhSale"("restaurantId", "clientKey");

-- CreateIndex
CREATE UNIQUE INDEX "PhSale_restaurantId_id_key" ON "PhSale"("restaurantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PhSale_id_branchId_key" ON "PhSale"("id", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "PhSale_id_currency_key" ON "PhSale"("id", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "PhSale_branchId_number_key" ON "PhSale"("branchId", "number");

-- CreateIndex
CREATE INDEX "PhSaleLine_restaurantId_productId_idx" ON "PhSaleLine"("restaurantId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "PhSaleLine_saleId_lineNo_key" ON "PhSaleLine"("saleId", "lineNo");

-- CreateIndex
CREATE UNIQUE INDEX "PhSaleLine_restaurantId_id_key" ON "PhSaleLine"("restaurantId", "id");

-- CreateIndex
CREATE INDEX "PhSaleLineAllocation_saleLineId_idx" ON "PhSaleLineAllocation"("saleLineId");

-- CreateIndex
CREATE INDEX "PhSaleLineAllocation_restaurantId_batchId_idx" ON "PhSaleLineAllocation"("restaurantId", "batchId");

-- CreateIndex
CREATE UNIQUE INDEX "PhSaleLineAllocation_restaurantId_id_key" ON "PhSaleLineAllocation"("restaurantId", "id");

-- CreateIndex
CREATE INDEX "PhPayment_saleId_idx" ON "PhPayment"("saleId");

-- CreateIndex
CREATE UNIQUE INDEX "PhPayment_restaurantId_clientKey_key" ON "PhPayment"("restaurantId", "clientKey");

-- CreateIndex
CREATE INDEX "PhReturn_restaurantId_branchId_createdAt_idx" ON "PhReturn"("restaurantId", "branchId", "createdAt");

-- CreateIndex
CREATE INDEX "PhReturn_saleId_idx" ON "PhReturn"("saleId");

-- CreateIndex
CREATE UNIQUE INDEX "PhReturn_restaurantId_clientKey_key" ON "PhReturn"("restaurantId", "clientKey");

-- CreateIndex
CREATE UNIQUE INDEX "PhReturn_restaurantId_id_key" ON "PhReturn"("restaurantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PhReturn_branchId_number_key" ON "PhReturn"("branchId", "number");

-- CreateIndex
CREATE INDEX "PhReturnLine_saleLineAllocationId_idx" ON "PhReturnLine"("saleLineAllocationId");

-- CreateIndex
CREATE UNIQUE INDEX "PhReturnLine_returnId_saleLineAllocationId_key" ON "PhReturnLine"("returnId", "saleLineAllocationId");

-- CreateIndex
CREATE UNIQUE INDEX "PhReceiptReprint_saleId_copyNumber_key" ON "PhReceiptReprint"("saleId", "copyNumber");

-- CreateIndex
CREATE UNIQUE INDEX "PhReceiptReprint_returnId_copyNumber_key" ON "PhReceiptReprint"("returnId", "copyNumber");

-- CreateIndex
CREATE UNIQUE INDEX "PhPrice_restaurantId_id_key" ON "PhPrice"("restaurantId", "id");

-- AddForeignKey
ALTER TABLE "PhShift" ADD CONSTRAINT "PhShift_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhShift" ADD CONSTRAINT "PhShift_restaurantId_branchId_fkey" FOREIGN KEY ("restaurantId", "branchId") REFERENCES "Branch"("restaurantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhCashMovement" ADD CONSTRAINT "PhCashMovement_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhCashMovement" ADD CONSTRAINT "PhCashMovement_restaurantId_shiftId_fkey" FOREIGN KEY ("restaurantId", "shiftId") REFERENCES "PhShift"("restaurantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhSale" ADD CONSTRAINT "PhSale_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhSale" ADD CONSTRAINT "PhSale_restaurantId_branchId_fkey" FOREIGN KEY ("restaurantId", "branchId") REFERENCES "Branch"("restaurantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhSale" ADD CONSTRAINT "PhSale_shiftId_branchId_fkey" FOREIGN KEY ("shiftId", "branchId") REFERENCES "PhShift"("id", "branchId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhSaleLine" ADD CONSTRAINT "PhSaleLine_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhSaleLine" ADD CONSTRAINT "PhSaleLine_restaurantId_saleId_fkey" FOREIGN KEY ("restaurantId", "saleId") REFERENCES "PhSale"("restaurantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhSaleLine" ADD CONSTRAINT "PhSaleLine_restaurantId_productId_fkey" FOREIGN KEY ("restaurantId", "productId") REFERENCES "PhProduct"("restaurantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhSaleLine" ADD CONSTRAINT "PhSaleLine_productId_unitId_fkey" FOREIGN KEY ("productId", "unitId") REFERENCES "PhProductUnit"("productId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhSaleLine" ADD CONSTRAINT "PhSaleLine_restaurantId_priceId_fkey" FOREIGN KEY ("restaurantId", "priceId") REFERENCES "PhPrice"("restaurantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhSaleLineAllocation" ADD CONSTRAINT "PhSaleLineAllocation_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhSaleLineAllocation" ADD CONSTRAINT "PhSaleLineAllocation_restaurantId_saleLineId_fkey" FOREIGN KEY ("restaurantId", "saleLineId") REFERENCES "PhSaleLine"("restaurantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhSaleLineAllocation" ADD CONSTRAINT "PhSaleLineAllocation_restaurantId_batchId_fkey" FOREIGN KEY ("restaurantId", "batchId") REFERENCES "PhBatch"("restaurantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhPayment" ADD CONSTRAINT "PhPayment_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhPayment" ADD CONSTRAINT "PhPayment_restaurantId_saleId_fkey" FOREIGN KEY ("restaurantId", "saleId") REFERENCES "PhSale"("restaurantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhPayment" ADD CONSTRAINT "PhPayment_saleId_currency_fkey" FOREIGN KEY ("saleId", "currency") REFERENCES "PhSale"("id", "currency") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhReturn" ADD CONSTRAINT "PhReturn_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhReturn" ADD CONSTRAINT "PhReturn_restaurantId_branchId_fkey" FOREIGN KEY ("restaurantId", "branchId") REFERENCES "Branch"("restaurantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhReturn" ADD CONSTRAINT "PhReturn_saleId_branchId_fkey" FOREIGN KEY ("saleId", "branchId") REFERENCES "PhSale"("id", "branchId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhReturn" ADD CONSTRAINT "PhReturn_saleId_currency_fkey" FOREIGN KEY ("saleId", "currency") REFERENCES "PhSale"("id", "currency") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhReturn" ADD CONSTRAINT "PhReturn_shiftId_branchId_fkey" FOREIGN KEY ("shiftId", "branchId") REFERENCES "PhShift"("id", "branchId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhReturnLine" ADD CONSTRAINT "PhReturnLine_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhReturnLine" ADD CONSTRAINT "PhReturnLine_restaurantId_returnId_fkey" FOREIGN KEY ("restaurantId", "returnId") REFERENCES "PhReturn"("restaurantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhReturnLine" ADD CONSTRAINT "PhReturnLine_restaurantId_saleLineAllocationId_fkey" FOREIGN KEY ("restaurantId", "saleLineAllocationId") REFERENCES "PhSaleLineAllocation"("restaurantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhReceiptReprint" ADD CONSTRAINT "PhReceiptReprint_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhReceiptReprint" ADD CONSTRAINT "PhReceiptReprint_restaurantId_saleId_fkey" FOREIGN KEY ("restaurantId", "saleId") REFERENCES "PhSale"("restaurantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhReceiptReprint" ADD CONSTRAINT "PhReceiptReprint_restaurantId_returnId_fkey" FOREIGN KEY ("restaurantId", "returnId") REFERENCES "PhReturn"("restaurantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;


-- Lock note: the four PhSettings columns above are ADD COLUMN with a constant DEFAULT, which Postgres 11+ records in the
-- catalog without rewriting the table (a brief ACCESS EXCLUSIVE lock, no scan). The CHECKs on them below scan the table,
-- which holds one row per business. The unique index on PhPrice("restaurantId", "id") is built by the index statement
-- above: it blocks writes to PhPrice while it builds. It is unique already because "id" is the primary key.

-- Settings: a step, a limit and a window are never negative, a discount percent is 0 to 100.
ALTER TABLE "PhSettings" ADD CONSTRAINT "PhSettings_roundingStepMinor_nonnegative" CHECK ("roundingStepMinor" >= 0);
ALTER TABLE "PhSettings" ADD CONSTRAINT "PhSettings_maxDiscountPercent_range" CHECK ("maxDiscountPercent" BETWEEN 0 AND 100);
ALTER TABLE "PhSettings" ADD CONSTRAINT "PhSettings_shiftVarianceLimitMinor_nonnegative" CHECK ("shiftVarianceLimitMinor" >= 0);
ALTER TABLE "PhSettings" ADD CONSTRAINT "PhSettings_returnWindowDays_nonnegative" CHECK ("returnWindowDays" >= 0);

-- A user has at most one open shift per branch. A closed shift frees the slot.
CREATE UNIQUE INDEX "PhShift_one_open_per_user" ON "PhShift" ("restaurantId", "branchId", "userId") WHERE "status" = 'OPEN';

-- A shift: a float and a count are never negative ("variance" is signed), and it is closed exactly when it has a closing time.
ALTER TABLE "PhShift" ADD CONSTRAINT "PhShift_openingFloatMinor_nonnegative" CHECK ("openingFloatMinor" >= 0);
ALTER TABLE "PhShift" ADD CONSTRAINT "PhShift_countedMinor_nonnegative" CHECK ("countedMinor" IS NULL OR "countedMinor" >= 0);
ALTER TABLE "PhShift" ADD CONSTRAINT "PhShift_closed_together" CHECK (("status" = 'CLOSED') = ("closedAt" IS NOT NULL));

-- A cash movement is never zero: money in is positive, money out is negative.
ALTER TABLE "PhCashMovement" ADD CONSTRAINT "PhCashMovement_amount_sign" CHECK (
  ("type" IN ('FLOAT_OPEN', 'SALE_CASH', 'PAID_IN') AND "amountMinor" > 0)
  OR ("type" IN ('CHANGE_OUT', 'REFUND_CASH', 'PAID_OUT') AND "amountMinor" < 0)
);

-- A sale: nothing negative except the rounding difference, a discount within the subtotal, and a completed or returned
-- sale is paid in full and numbered. A hold may be neither. (PhSale_within_subtotal sorts after the single-column checks,
-- so a negative subtotal is reported as that.)
ALTER TABLE "PhSale" ADD CONSTRAINT "PhSale_subtotalMinor_nonnegative" CHECK ("subtotalMinor" >= 0);
ALTER TABLE "PhSale" ADD CONSTRAINT "PhSale_discountMinor_nonnegative" CHECK ("discountMinor" >= 0);
ALTER TABLE "PhSale" ADD CONSTRAINT "PhSale_totalMinor_nonnegative" CHECK ("totalMinor" >= 0);
ALTER TABLE "PhSale" ADD CONSTRAINT "PhSale_paidMinor_nonnegative" CHECK ("paidMinor" >= 0);
ALTER TABLE "PhSale" ADD CONSTRAINT "PhSale_changeMinor_nonnegative" CHECK ("changeMinor" >= 0);
ALTER TABLE "PhSale" ADD CONSTRAINT "PhSale_within_subtotal" CHECK ("discountMinor" <= "subtotalMinor");
ALTER TABLE "PhSale" ADD CONSTRAINT "PhSale_paid_covers_total" CHECK ("status" NOT IN ('COMPLETED', 'RETURNED_PARTIAL', 'RETURNED_FULL') OR "paidMinor" >= "totalMinor");
ALTER TABLE "PhSale" ADD CONSTRAINT "PhSale_numbered_when_done" CHECK ("status" NOT IN ('COMPLETED', 'RETURNED_PARTIAL', 'RETURNED_FULL') OR "number" IS NOT NULL);

-- A sale line: at least one unit and one base unit, nothing negative, a discount within quantity x price.
ALTER TABLE "PhSaleLine" ADD CONSTRAINT "PhSaleLine_qty_positive" CHECK ("qty" >= 1);
ALTER TABLE "PhSaleLine" ADD CONSTRAINT "PhSaleLine_baseQty_positive" CHECK ("baseQty" >= 1);
ALTER TABLE "PhSaleLine" ADD CONSTRAINT "PhSaleLine_unitPriceMinor_nonnegative" CHECK ("unitPriceMinor" >= 0);
ALTER TABLE "PhSaleLine" ADD CONSTRAINT "PhSaleLine_discountMinor_nonnegative" CHECK ("discountMinor" >= 0);
ALTER TABLE "PhSaleLine" ADD CONSTRAINT "PhSaleLine_totalMinor_nonnegative" CHECK ("totalMinor" >= 0);
ALTER TABLE "PhSaleLine" ADD CONSTRAINT "PhSaleLine_within_gross" CHECK ("discountMinor" <= "unitPriceMinor" * "qty");

-- An allocation: at least one base unit, the cost and its currency together and not negative, returned between 0 and sold.
ALTER TABLE "PhSaleLineAllocation" ADD CONSTRAINT "PhSaleLineAllocation_baseQty_positive" CHECK ("baseQty" >= 1);
ALTER TABLE "PhSaleLineAllocation" ADD CONSTRAINT "PhSaleLineAllocation_costSnapshotMinor_nonnegative" CHECK ("costSnapshotMinor" IS NULL OR "costSnapshotMinor" >= 0);
ALTER TABLE "PhSaleLineAllocation" ADD CONSTRAINT "PhSaleLineAllocation_cost_together" CHECK (("costSnapshotMinor" IS NULL) = ("costCurrency" IS NULL));
ALTER TABLE "PhSaleLineAllocation" ADD CONSTRAINT "PhSaleLineAllocation_returned_within_sold" CHECK ("returnedBaseQty" BETWEEN 0 AND "baseQty");

-- A payment is a positive amount.
ALTER TABLE "PhPayment" ADD CONSTRAINT "PhPayment_amountMinor_positive" CHECK ("amountMinor" > 0);

-- A return refunds nothing or more, never a negative amount, a return line gives back at least one base unit.
ALTER TABLE "PhReturn" ADD CONSTRAINT "PhReturn_refundMinor_nonnegative" CHECK ("refundMinor" >= 0);
ALTER TABLE "PhReturnLine" ADD CONSTRAINT "PhReturnLine_baseQty_positive" CHECK ("baseQty" >= 1);
ALTER TABLE "PhReturnLine" ADD CONSTRAINT "PhReturnLine_refundMinor_nonnegative" CHECK ("refundMinor" >= 0);

-- A reprint names a sale or a return, one of the two, and is a copy number of at least one.
ALTER TABLE "PhReceiptReprint" ADD CONSTRAINT "PhReceiptReprint_one_target" CHECK (num_nonnulls("saleId", "returnId") = 1);
ALTER TABLE "PhReceiptReprint" ADD CONSTRAINT "PhReceiptReprint_copyNumber_positive" CHECK ("copyNumber" >= 1);
