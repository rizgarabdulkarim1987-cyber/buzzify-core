-- CreateEnum
CREATE TYPE "PhPurchaseOrderStatus" AS ENUM ('DRAFT', 'ORDERED', 'PARTIAL', 'RECEIVED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PhSupplierInvoiceStatus" AS ENUM ('OPEN', 'PARTIAL', 'PAID', 'VOID');

-- CreateEnum
CREATE TYPE "PhSupplierPaymentMethod" AS ENUM ('CASH', 'TRANSFER_MANUAL', 'CHEQUE_MANUAL', 'CARD_MANUAL');

-- AlterTable
ALTER TABLE "PhReceipt" ADD COLUMN     "purchaseOrderId" TEXT,
ADD COLUMN     "supplierId" TEXT;

-- AlterTable
ALTER TABLE "PhReceiptLine" ADD COLUMN     "invoicedQty" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "purchaseOrderLineId" TEXT;

-- CreateTable
CREATE TABLE "PhSupplier" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "phone" TEXT NOT NULL DEFAULT '',
    "contactName" TEXT NOT NULL DEFAULT '',
    "addressNote" TEXT NOT NULL DEFAULT '',
    "defaultCurrency" "Currency" NOT NULL,
    "termsDays" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT NOT NULL DEFAULT '',
    "clientKey" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhSupplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhPurchaseOrder" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "status" "PhPurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" "Currency" NOT NULL,
    "number" TEXT,
    "clientKey" TEXT NOT NULL,
    "payloadHash" TEXT,
    "expectedOn" DATE,
    "note" TEXT NOT NULL DEFAULT '',
    "orderedAt" TIMESTAMP(3),
    "orderedById" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "closeReason" TEXT NOT NULL DEFAULT '',
    "cancelledAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhPurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhPurchaseOrderLine" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "productId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "qtyOrdered" INTEGER NOT NULL,
    "bonusOrdered" INTEGER NOT NULL DEFAULT 0,
    "unitCostMinor" BIGINT NOT NULL,
    "receivedQty" INTEGER NOT NULL DEFAULT 0,
    "receivedBonus" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PhPurchaseOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhSupplierInvoice" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "numberRaw" TEXT NOT NULL,
    "invoiceDate" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "currency" "Currency" NOT NULL,
    "adjustmentMinor" BIGINT NOT NULL DEFAULT 0,
    "adjustmentReason" TEXT NOT NULL DEFAULT '',
    "totalMinor" BIGINT NOT NULL,
    "paidMinor" BIGINT NOT NULL DEFAULT 0,
    "creditedMinor" BIGINT NOT NULL DEFAULT 0,
    "status" "PhSupplierInvoiceStatus" NOT NULL DEFAULT 'OPEN',
    "fingerprint" TEXT NOT NULL,
    "clientKey" TEXT NOT NULL,
    "payloadHash" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidReason" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhSupplierInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhSupplierInvoiceLine" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "receiptLineId" TEXT NOT NULL,
    "qtyInvoiced" INTEGER NOT NULL,
    "unitCostMinor" BIGINT NOT NULL,
    "lineTotalMinor" BIGINT NOT NULL,

    CONSTRAINT "PhSupplierInvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhSupplierPayment" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "method" "PhSupplierPaymentMethod" NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "paidOn" DATE NOT NULL,
    "reference" TEXT NOT NULL DEFAULT '',
    "clientKey" TEXT NOT NULL,
    "payloadHash" TEXT,
    "isReversal" BOOLEAN NOT NULL DEFAULT false,
    "reversesId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhSupplierPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhSupplierPaymentAllocation" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhSupplierPaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhSupplierReturn" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "number" TEXT,
    "reason" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "clientKey" TEXT NOT NULL,
    "payloadHash" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhSupplierReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhSupplierReturnLine" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "batchId" TEXT NOT NULL,
    "bucket" "PhStockBucket" NOT NULL,
    "qty" INTEGER NOT NULL,
    "unitCostMinor" BIGINT,
    "costCurrency" "Currency",

    CONSTRAINT "PhSupplierReturnLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhCreditNote" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "appliedMinor" BIGINT NOT NULL DEFAULT 0,
    "noteDate" DATE NOT NULL,
    "supplierReturnId" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "clientKey" TEXT NOT NULL,
    "payloadHash" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhCreditNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhCreditAllocation" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "creditNoteId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhCreditAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PhSupplier_restaurantId_active_name_idx" ON "PhSupplier"("restaurantId", "active", "name");

-- CreateIndex
CREATE UNIQUE INDEX "PhSupplier_restaurantId_id_key" ON "PhSupplier"("restaurantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PhSupplier_restaurantId_nameKey_key" ON "PhSupplier"("restaurantId", "nameKey");

-- CreateIndex
CREATE UNIQUE INDEX "PhSupplier_restaurantId_clientKey_key" ON "PhSupplier"("restaurantId", "clientKey");

-- CreateIndex
CREATE INDEX "PhPurchaseOrder_restaurantId_branchId_status_createdAt_idx" ON "PhPurchaseOrder"("restaurantId", "branchId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PhPurchaseOrder_restaurantId_supplierId_idx" ON "PhPurchaseOrder"("restaurantId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "PhPurchaseOrder_restaurantId_clientKey_key" ON "PhPurchaseOrder"("restaurantId", "clientKey");

-- CreateIndex
CREATE UNIQUE INDEX "PhPurchaseOrder_restaurantId_id_key" ON "PhPurchaseOrder"("restaurantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PhPurchaseOrder_restaurantId_id_branchId_key" ON "PhPurchaseOrder"("restaurantId", "id", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "PhPurchaseOrder_branchId_number_key" ON "PhPurchaseOrder"("branchId", "number");

-- CreateIndex
CREATE INDEX "PhPurchaseOrderLine_restaurantId_productId_idx" ON "PhPurchaseOrderLine"("restaurantId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "PhPurchaseOrderLine_purchaseOrderId_lineNo_key" ON "PhPurchaseOrderLine"("purchaseOrderId", "lineNo");

-- CreateIndex
CREATE UNIQUE INDEX "PhPurchaseOrderLine_restaurantId_id_key" ON "PhPurchaseOrderLine"("restaurantId", "id");

-- CreateIndex
CREATE INDEX "PhSupplierInvoice_restaurantId_supplierId_status_dueDate_idx" ON "PhSupplierInvoice"("restaurantId", "supplierId", "status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "PhSupplierInvoice_restaurantId_id_key" ON "PhSupplierInvoice"("restaurantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PhSupplierInvoice_restaurantId_id_supplierId_currency_key" ON "PhSupplierInvoice"("restaurantId", "id", "supplierId", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "PhSupplierInvoice_restaurantId_supplierId_number_key" ON "PhSupplierInvoice"("restaurantId", "supplierId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "PhSupplierInvoice_restaurantId_fingerprint_key" ON "PhSupplierInvoice"("restaurantId", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "PhSupplierInvoice_restaurantId_clientKey_key" ON "PhSupplierInvoice"("restaurantId", "clientKey");

-- CreateIndex
CREATE INDEX "PhSupplierInvoiceLine_restaurantId_receiptLineId_idx" ON "PhSupplierInvoiceLine"("restaurantId", "receiptLineId");

-- CreateIndex
CREATE UNIQUE INDEX "PhSupplierInvoiceLine_invoiceId_lineNo_key" ON "PhSupplierInvoiceLine"("invoiceId", "lineNo");

-- CreateIndex
CREATE INDEX "PhSupplierPayment_restaurantId_supplierId_paidOn_idx" ON "PhSupplierPayment"("restaurantId", "supplierId", "paidOn");

-- CreateIndex
CREATE UNIQUE INDEX "PhSupplierPayment_restaurantId_id_key" ON "PhSupplierPayment"("restaurantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PhSupplierPayment_restaurantId_id_supplierId_currency_key" ON "PhSupplierPayment"("restaurantId", "id", "supplierId", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "PhSupplierPayment_restaurantId_clientKey_key" ON "PhSupplierPayment"("restaurantId", "clientKey");

-- CreateIndex
CREATE INDEX "PhSupplierPaymentAllocation_restaurantId_invoiceId_idx" ON "PhSupplierPaymentAllocation"("restaurantId", "invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "PhSupplierPaymentAllocation_paymentId_invoiceId_key" ON "PhSupplierPaymentAllocation"("paymentId", "invoiceId");

-- CreateIndex
CREATE INDEX "PhSupplierReturn_restaurantId_branchId_createdAt_idx" ON "PhSupplierReturn"("restaurantId", "branchId", "createdAt");

-- CreateIndex
CREATE INDEX "PhSupplierReturn_restaurantId_supplierId_idx" ON "PhSupplierReturn"("restaurantId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "PhSupplierReturn_restaurantId_clientKey_key" ON "PhSupplierReturn"("restaurantId", "clientKey");

-- CreateIndex
CREATE UNIQUE INDEX "PhSupplierReturn_restaurantId_id_key" ON "PhSupplierReturn"("restaurantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PhSupplierReturn_branchId_number_key" ON "PhSupplierReturn"("branchId", "number");

-- CreateIndex
CREATE INDEX "PhSupplierReturnLine_restaurantId_batchId_idx" ON "PhSupplierReturnLine"("restaurantId", "batchId");

-- CreateIndex
CREATE UNIQUE INDEX "PhSupplierReturnLine_returnId_lineNo_key" ON "PhSupplierReturnLine"("returnId", "lineNo");

-- CreateIndex
CREATE UNIQUE INDEX "PhCreditNote_restaurantId_id_key" ON "PhCreditNote"("restaurantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PhCreditNote_restaurantId_id_supplierId_currency_key" ON "PhCreditNote"("restaurantId", "id", "supplierId", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "PhCreditNote_restaurantId_supplierId_number_key" ON "PhCreditNote"("restaurantId", "supplierId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "PhCreditNote_restaurantId_clientKey_key" ON "PhCreditNote"("restaurantId", "clientKey");

-- CreateIndex
CREATE INDEX "PhCreditAllocation_restaurantId_invoiceId_idx" ON "PhCreditAllocation"("restaurantId", "invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "PhCreditAllocation_creditNoteId_invoiceId_key" ON "PhCreditAllocation"("creditNoteId", "invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "PhReceiptLine_restaurantId_id_key" ON "PhReceiptLine"("restaurantId", "id");

-- AddForeignKey
ALTER TABLE "PhReceipt" ADD CONSTRAINT "PhReceipt_restaurantId_supplierId_fkey" FOREIGN KEY ("restaurantId", "supplierId") REFERENCES "PhSupplier"("restaurantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhReceipt" ADD CONSTRAINT "PhReceipt_restaurantId_purchaseOrderId_branchId_fkey" FOREIGN KEY ("restaurantId", "purchaseOrderId", "branchId") REFERENCES "PhPurchaseOrder"("restaurantId", "id", "branchId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhReceiptLine" ADD CONSTRAINT "PhReceiptLine_restaurantId_purchaseOrderLineId_fkey" FOREIGN KEY ("restaurantId", "purchaseOrderLineId") REFERENCES "PhPurchaseOrderLine"("restaurantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhSupplier" ADD CONSTRAINT "PhSupplier_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhPurchaseOrder" ADD CONSTRAINT "PhPurchaseOrder_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhPurchaseOrder" ADD CONSTRAINT "PhPurchaseOrder_restaurantId_branchId_fkey" FOREIGN KEY ("restaurantId", "branchId") REFERENCES "Branch"("restaurantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhPurchaseOrder" ADD CONSTRAINT "PhPurchaseOrder_restaurantId_supplierId_fkey" FOREIGN KEY ("restaurantId", "supplierId") REFERENCES "PhSupplier"("restaurantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhPurchaseOrderLine" ADD CONSTRAINT "PhPurchaseOrderLine_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhPurchaseOrderLine" ADD CONSTRAINT "PhPurchaseOrderLine_restaurantId_purchaseOrderId_fkey" FOREIGN KEY ("restaurantId", "purchaseOrderId") REFERENCES "PhPurchaseOrder"("restaurantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhPurchaseOrderLine" ADD CONSTRAINT "PhPurchaseOrderLine_restaurantId_productId_fkey" FOREIGN KEY ("restaurantId", "productId") REFERENCES "PhProduct"("restaurantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhPurchaseOrderLine" ADD CONSTRAINT "PhPurchaseOrderLine_productId_unitId_fkey" FOREIGN KEY ("productId", "unitId") REFERENCES "PhProductUnit"("productId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhSupplierInvoice" ADD CONSTRAINT "PhSupplierInvoice_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhSupplierInvoice" ADD CONSTRAINT "PhSupplierInvoice_restaurantId_supplierId_fkey" FOREIGN KEY ("restaurantId", "supplierId") REFERENCES "PhSupplier"("restaurantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhSupplierInvoiceLine" ADD CONSTRAINT "PhSupplierInvoiceLine_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhSupplierInvoiceLine" ADD CONSTRAINT "PhSupplierInvoiceLine_restaurantId_invoiceId_fkey" FOREIGN KEY ("restaurantId", "invoiceId") REFERENCES "PhSupplierInvoice"("restaurantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhSupplierInvoiceLine" ADD CONSTRAINT "PhSupplierInvoiceLine_restaurantId_receiptLineId_fkey" FOREIGN KEY ("restaurantId", "receiptLineId") REFERENCES "PhReceiptLine"("restaurantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhSupplierPayment" ADD CONSTRAINT "PhSupplierPayment_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhSupplierPayment" ADD CONSTRAINT "PhSupplierPayment_restaurantId_supplierId_fkey" FOREIGN KEY ("restaurantId", "supplierId") REFERENCES "PhSupplier"("restaurantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhSupplierPayment" ADD CONSTRAINT "PhSupplierPayment_restaurantId_reversesId_supplierId_curre_fkey" FOREIGN KEY ("restaurantId", "reversesId", "supplierId", "currency") REFERENCES "PhSupplierPayment"("restaurantId", "id", "supplierId", "currency") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhSupplierPaymentAllocation" ADD CONSTRAINT "PhSupplierPaymentAllocation_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhSupplierPaymentAllocation" ADD CONSTRAINT "PhSupplierPaymentAllocation_restaurantId_paymentId_supplie_fkey" FOREIGN KEY ("restaurantId", "paymentId", "supplierId", "currency") REFERENCES "PhSupplierPayment"("restaurantId", "id", "supplierId", "currency") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhSupplierPaymentAllocation" ADD CONSTRAINT "PhSupplierPaymentAllocation_restaurantId_invoiceId_supplie_fkey" FOREIGN KEY ("restaurantId", "invoiceId", "supplierId", "currency") REFERENCES "PhSupplierInvoice"("restaurantId", "id", "supplierId", "currency") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhSupplierReturn" ADD CONSTRAINT "PhSupplierReturn_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhSupplierReturn" ADD CONSTRAINT "PhSupplierReturn_restaurantId_branchId_fkey" FOREIGN KEY ("restaurantId", "branchId") REFERENCES "Branch"("restaurantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhSupplierReturn" ADD CONSTRAINT "PhSupplierReturn_restaurantId_supplierId_fkey" FOREIGN KEY ("restaurantId", "supplierId") REFERENCES "PhSupplier"("restaurantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhSupplierReturnLine" ADD CONSTRAINT "PhSupplierReturnLine_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhSupplierReturnLine" ADD CONSTRAINT "PhSupplierReturnLine_restaurantId_returnId_fkey" FOREIGN KEY ("restaurantId", "returnId") REFERENCES "PhSupplierReturn"("restaurantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhSupplierReturnLine" ADD CONSTRAINT "PhSupplierReturnLine_restaurantId_batchId_fkey" FOREIGN KEY ("restaurantId", "batchId") REFERENCES "PhBatch"("restaurantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhCreditNote" ADD CONSTRAINT "PhCreditNote_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhCreditNote" ADD CONSTRAINT "PhCreditNote_restaurantId_supplierId_fkey" FOREIGN KEY ("restaurantId", "supplierId") REFERENCES "PhSupplier"("restaurantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhCreditNote" ADD CONSTRAINT "PhCreditNote_restaurantId_supplierReturnId_fkey" FOREIGN KEY ("restaurantId", "supplierReturnId") REFERENCES "PhSupplierReturn"("restaurantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhCreditAllocation" ADD CONSTRAINT "PhCreditAllocation_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhCreditAllocation" ADD CONSTRAINT "PhCreditAllocation_restaurantId_creditNoteId_supplierId_cu_fkey" FOREIGN KEY ("restaurantId", "creditNoteId", "supplierId", "currency") REFERENCES "PhCreditNote"("restaurantId", "id", "supplierId", "currency") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhCreditAllocation" ADD CONSTRAINT "PhCreditAllocation_restaurantId_invoiceId_supplierId_curre_fkey" FOREIGN KEY ("restaurantId", "invoiceId", "supplierId", "currency") REFERENCES "PhSupplierInvoice"("restaurantId", "id", "supplierId", "currency") ON DELETE NO ACTION ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------------------------------------------------
-- Integrity that Prisma cannot express: CHECKs, partial unique indexes, append-only triggers and the invoice total
-- identity. Nothing here touches an existing row: the new columns have defaults and the new CHECKs are on them.
-- ---------------------------------------------------------------------------------------------------------------------

-- A supplier: a name, its key, payment terms of 0..365 days.
ALTER TABLE "PhSupplier" ADD CONSTRAINT "PhSupplier_name_present" CHECK (length(btrim("name")) > 0 AND length("nameKey") > 0);
ALTER TABLE "PhSupplier" ADD CONSTRAINT "PhSupplier_termsDays_range" CHECK ("termsDays" >= 0 AND "termsDays" <= 365);

-- An order line: at least one ordered, no negative bonus or cost, and received never passes ordered (units and bonus apart).
ALTER TABLE "PhPurchaseOrderLine" ADD CONSTRAINT "PhPurchaseOrderLine_qtyOrdered_positive" CHECK ("qtyOrdered" >= 1);
ALTER TABLE "PhPurchaseOrderLine" ADD CONSTRAINT "PhPurchaseOrderLine_bonusOrdered_nonnegative" CHECK ("bonusOrdered" >= 0);
ALTER TABLE "PhPurchaseOrderLine" ADD CONSTRAINT "PhPurchaseOrderLine_unitCostMinor_nonnegative" CHECK ("unitCostMinor" >= 0);
ALTER TABLE "PhPurchaseOrderLine" ADD CONSTRAINT "PhPurchaseOrderLine_received_nonnegative" CHECK ("receivedQty" >= 0 AND "receivedBonus" >= 0);
ALTER TABLE "PhPurchaseOrderLine" ADD CONSTRAINT "PhPurchaseOrderLine_receivedQty_within_ordered" CHECK ("receivedQty" <= "qtyOrdered");
ALTER TABLE "PhPurchaseOrderLine" ADD CONSTRAINT "PhPurchaseOrderLine_receivedBonus_within_ordered" CHECK ("receivedBonus" <= "bonusOrdered");

-- A receipt answers an order only for a known supplier; a receipt line never has more invoiced than it received.
ALTER TABLE "PhReceipt" ADD CONSTRAINT "PhReceipt_order_needs_supplier" CHECK ("purchaseOrderId" IS NULL OR "supplierId" IS NOT NULL);
ALTER TABLE "PhReceiptLine" ADD CONSTRAINT "PhReceiptLine_invoicedQty_within_received" CHECK ("invoicedQty" >= 0 AND "invoicedQty" <= "qty" + "bonusQty");

-- A supplier invoice: money that is not negative; paid and credited together never pass the total; a void one has nothing
-- paid or credited; a non-zero adjustment (freight, discount) says why.
ALTER TABLE "PhSupplierInvoice" ADD CONSTRAINT "PhSupplierInvoice_number_present" CHECK (length("number") > 0 AND length("fingerprint") > 0);
ALTER TABLE "PhSupplierInvoice" ADD CONSTRAINT "PhSupplierInvoice_totalMinor_nonnegative" CHECK ("totalMinor" >= 0);
ALTER TABLE "PhSupplierInvoice" ADD CONSTRAINT "PhSupplierInvoice_paidMinor_nonnegative" CHECK ("paidMinor" >= 0);
ALTER TABLE "PhSupplierInvoice" ADD CONSTRAINT "PhSupplierInvoice_creditedMinor_nonnegative" CHECK ("creditedMinor" >= 0);
ALTER TABLE "PhSupplierInvoice" ADD CONSTRAINT "PhSupplierInvoice_settled_within_total" CHECK ("paidMinor" + "creditedMinor" <= "totalMinor");
ALTER TABLE "PhSupplierInvoice" ADD CONSTRAINT "PhSupplierInvoice_void_unsettled" CHECK ("status" <> 'VOID' OR ("paidMinor" = 0 AND "creditedMinor" = 0));
ALTER TABLE "PhSupplierInvoice" ADD CONSTRAINT "PhSupplierInvoice_adjustment_reason" CHECK ("adjustmentMinor" = 0 OR length(btrim("adjustmentReason")) > 0);

-- An invoice line: at least one unit, a cost that is not negative, and the line total is quantity times cost.
ALTER TABLE "PhSupplierInvoiceLine" ADD CONSTRAINT "PhSupplierInvoiceLine_qtyInvoiced_positive" CHECK ("qtyInvoiced" >= 1);
ALTER TABLE "PhSupplierInvoiceLine" ADD CONSTRAINT "PhSupplierInvoiceLine_unitCostMinor_nonnegative" CHECK ("unitCostMinor" >= 0);
ALTER TABLE "PhSupplierInvoiceLine" ADD CONSTRAINT "PhSupplierInvoiceLine_lineTotalMinor_nonnegative" CHECK ("lineTotalMinor" >= 0);
ALTER TABLE "PhSupplierInvoiceLine" ADD CONSTRAINT "PhSupplierInvoiceLine_total_identity" CHECK ("lineTotalMinor" = "qtyInvoiced" * "unitCostMinor");

-- The invoice total is its lines plus its adjustment. It spans two tables, so it is a constraint trigger checked when the
-- transaction commits: an invoice and its lines are written together, in any order. An invoice that is gone (a business
-- removed by cascade) has nothing left to check.
CREATE FUNCTION "PhSupplierInvoice_total_identity"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  inv_id text;
  inv RECORD;
  lines_sum numeric;
BEGIN
  IF TG_TABLE_NAME = 'PhSupplierInvoice' THEN
    inv_id := NEW."id";
  ELSIF TG_OP = 'DELETE' THEN
    inv_id := OLD."invoiceId";
  ELSE
    inv_id := NEW."invoiceId";
  END IF;
  SELECT "totalMinor", "adjustmentMinor" INTO inv FROM "PhSupplierInvoice" WHERE "id" = inv_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT COALESCE(SUM("lineTotalMinor"), 0) INTO lines_sum FROM "PhSupplierInvoiceLine" WHERE "invoiceId" = inv_id;
  IF inv."totalMinor" <> lines_sum + inv."adjustmentMinor" THEN
    RAISE EXCEPTION 'PhSupplierInvoice_total_identity: total % is not lines % plus adjustment %', inv."totalMinor", lines_sum, inv."adjustmentMinor" USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "PhSupplierInvoice_total_identity" AFTER INSERT OR UPDATE OF "totalMinor", "adjustmentMinor" ON "PhSupplierInvoice" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "PhSupplierInvoice_total_identity"();
CREATE CONSTRAINT TRIGGER "PhSupplierInvoiceLine_total_sum" AFTER INSERT OR UPDATE OR DELETE ON "PhSupplierInvoiceLine" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "PhSupplierInvoice_total_identity"();

-- A payment: an amount above zero. A reversal says which payment it undoes, and only a reversal does; a payment is
-- reversed once.
ALTER TABLE "PhSupplierPayment" ADD CONSTRAINT "PhSupplierPayment_amountMinor_positive" CHECK ("amountMinor" > 0);
ALTER TABLE "PhSupplierPayment" ADD CONSTRAINT "PhSupplierPayment_reversal_flag" CHECK ("isReversal" = ("reversesId" IS NOT NULL));
CREATE UNIQUE INDEX "PhSupplierPayment_one_reversal" ON "PhSupplierPayment" ("reversesId") WHERE "reversesId" IS NOT NULL;

-- An allocation (payment or credit note to an invoice): an amount above zero.
ALTER TABLE "PhSupplierPaymentAllocation" ADD CONSTRAINT "PhSupplierPaymentAllocation_amountMinor_positive" CHECK ("amountMinor" > 0);
ALTER TABLE "PhCreditAllocation" ADD CONSTRAINT "PhCreditAllocation_amountMinor_positive" CHECK ("amountMinor" > 0);

-- A supplier return says why; each line takes at least one unit from a bucket that can be sent back, with its cost and
-- currency both or neither.
ALTER TABLE "PhSupplierReturn" ADD CONSTRAINT "PhSupplierReturn_reason_present" CHECK (length(btrim("reason")) > 0);
ALTER TABLE "PhSupplierReturnLine" ADD CONSTRAINT "PhSupplierReturnLine_qty_positive" CHECK ("qty" >= 1);
ALTER TABLE "PhSupplierReturnLine" ADD CONSTRAINT "PhSupplierReturnLine_bucket_returnable" CHECK ("bucket" IN ('AVAILABLE', 'QUARANTINE'));
ALTER TABLE "PhSupplierReturnLine" ADD CONSTRAINT "PhSupplierReturnLine_unitCostMinor_nonnegative" CHECK ("unitCostMinor" IS NULL OR "unitCostMinor" >= 0);
ALTER TABLE "PhSupplierReturnLine" ADD CONSTRAINT "PhSupplierReturnLine_cost_together" CHECK (("unitCostMinor" IS NULL) = ("costCurrency" IS NULL));

-- A credit note: an amount above zero, of which 0..amount has been applied.
ALTER TABLE "PhCreditNote" ADD CONSTRAINT "PhCreditNote_number_present" CHECK (length("number") > 0);
ALTER TABLE "PhCreditNote" ADD CONSTRAINT "PhCreditNote_amountMinor_positive" CHECK ("amountMinor" > 0);
ALTER TABLE "PhCreditNote" ADD CONSTRAINT "PhCreditNote_applied_within_amount" CHECK ("appliedMinor" >= 0 AND "appliedMinor" <= "amountMinor");

-- Payments and the allocations of payments and credit notes are append-only. A direct UPDATE or DELETE is refused; the
-- delete of a whole business (a cascade, which runs inside the foreign key's own trigger) is the one removal allowed.
CREATE FUNCTION "PhPurchasing_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% is append-only: % refused', TG_TABLE_NAME, TG_OP;
END;
$$;
CREATE TRIGGER "PhSupplierPayment_append_only" BEFORE UPDATE OR DELETE ON "PhSupplierPayment" FOR EACH ROW EXECUTE FUNCTION "PhPurchasing_append_only"();
CREATE TRIGGER "PhSupplierPaymentAllocation_append_only" BEFORE UPDATE OR DELETE ON "PhSupplierPaymentAllocation" FOR EACH ROW EXECUTE FUNCTION "PhPurchasing_append_only"();
CREATE TRIGGER "PhCreditAllocation_append_only" BEFORE UPDATE OR DELETE ON "PhCreditAllocation" FOR EACH ROW EXECUTE FUNCTION "PhPurchasing_append_only"();
