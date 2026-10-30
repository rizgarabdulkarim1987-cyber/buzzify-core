-- CreateEnum
CREATE TYPE "PhControlledKind" AS ENUM ('SALE', 'RETURN');

-- CreateEnum
CREATE TYPE "PhCustomerPaymentMethod" AS ENUM ('CASH', 'CARD', 'TRANSFER');

-- CreateEnum
CREATE TYPE "PhCustomerLedgerKind" AS ENUM ('CHARGE', 'PAYMENT', 'REVERSAL', 'REFUND');

-- CreateEnum
CREATE TYPE "PhAiProposalKind" AS ENUM ('TRANSFER', 'REORDER', 'SUPPLIER_RETURN');

-- CreateEnum
CREATE TYPE "PhAiProposalStatus" AS ENUM ('PROPOSED', 'ACCEPTED', 'DISMISSED');

-- AlterEnum
ALTER TYPE "PhCashMovementType" ADD VALUE IF NOT EXISTS 'CUSTOMER_PAYMENT';

-- AlterEnum
ALTER TYPE "PhPaymentMethod" ADD VALUE IF NOT EXISTS 'CREDIT';

-- AlterTable
ALTER TABLE "PhSale" ADD COLUMN     "customerId" TEXT;

-- AlterTable
ALTER TABLE "PhSettings" ADD COLUMN     "controlledEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "controlledMaxQty" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "creditEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "print" JSONB,
ALTER COLUMN "rxRetentionDays" SET DEFAULT 3650;

-- CreateTable
CREATE TABLE "PhPrescription" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "prescriberName" TEXT NOT NULL,
    "prescriberLicense" TEXT,
    "patientName" TEXT,
    "patientIdNote" TEXT,
    "issuedOn" DATE NOT NULL,
    "saleId" TEXT,
    "clientKey" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhPrescription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhRxAttachment" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "prescriptionId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhRxAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhControlledEntry" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "saleLineId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "prescriptionId" TEXT NOT NULL,
    "baseQty" INTEGER NOT NULL,
    "kind" "PhControlledKind" NOT NULL,
    "dispensedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhControlledEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhCustomer" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "creditLimitMinor" BIGINT NOT NULL DEFAULT 0,
    "currency" "Currency" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhCustomer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhCustomerLedger" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "kind" "PhCustomerLedgerKind" NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" "Currency" NOT NULL,
    "saleId" TEXT,
    "paymentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhCustomerLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhCustomerPayment" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "method" "PhCustomerPaymentMethod" NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" "Currency" NOT NULL,
    "clientKey" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "shiftId" TEXT,
    "reversesId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhCustomerPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhAiProposal" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "kind" "PhAiProposalKind" NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "PhAiProposalStatus" NOT NULL DEFAULT 'PROPOSED',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "PhAiProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PhPrescription_restaurantId_number_idx" ON "PhPrescription"("restaurantId", "number");

-- CreateIndex
CREATE INDEX "PhPrescription_restaurantId_branchId_createdAt_idx" ON "PhPrescription"("restaurantId", "branchId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PhPrescription_restaurantId_id_key" ON "PhPrescription"("restaurantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PhPrescription_restaurantId_id_branchId_key" ON "PhPrescription"("restaurantId", "id", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "PhPrescription_restaurantId_clientKey_key" ON "PhPrescription"("restaurantId", "clientKey");

-- CreateIndex
CREATE UNIQUE INDEX "PhPrescription_saleId_key" ON "PhPrescription"("saleId");

-- CreateIndex
CREATE UNIQUE INDEX "PhPrescription_restaurantId_saleId_branchId_key" ON "PhPrescription"("restaurantId", "saleId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "PhRxAttachment_storageKey_key" ON "PhRxAttachment"("storageKey");

-- CreateIndex
CREATE INDEX "PhRxAttachment_restaurantId_prescriptionId_idx" ON "PhRxAttachment"("restaurantId", "prescriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "PhRxAttachment_restaurantId_id_key" ON "PhRxAttachment"("restaurantId", "id");

-- CreateIndex
CREATE INDEX "PhControlledEntry_restaurantId_branchId_productId_createdAt_idx" ON "PhControlledEntry"("restaurantId", "branchId", "productId", "createdAt");

-- CreateIndex
CREATE INDEX "PhControlledEntry_restaurantId_prescriptionId_idx" ON "PhControlledEntry"("restaurantId", "prescriptionId");

-- CreateIndex
CREATE INDEX "PhControlledEntry_restaurantId_saleLineId_idx" ON "PhControlledEntry"("restaurantId", "saleLineId");

-- CreateIndex
CREATE UNIQUE INDEX "PhControlledEntry_restaurantId_id_key" ON "PhControlledEntry"("restaurantId", "id");

-- CreateIndex
CREATE INDEX "PhCustomer_restaurantId_name_idx" ON "PhCustomer"("restaurantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "PhCustomer_restaurantId_id_key" ON "PhCustomer"("restaurantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PhCustomer_restaurantId_id_currency_key" ON "PhCustomer"("restaurantId", "id", "currency");

-- CreateIndex
CREATE INDEX "PhCustomerLedger_restaurantId_customerId_createdAt_idx" ON "PhCustomerLedger"("restaurantId", "customerId", "createdAt");

-- CreateIndex
CREATE INDEX "PhCustomerLedger_restaurantId_saleId_idx" ON "PhCustomerLedger"("restaurantId", "saleId");

-- CreateIndex
CREATE UNIQUE INDEX "PhCustomerLedger_paymentId_key" ON "PhCustomerLedger"("paymentId");

-- CreateIndex
CREATE INDEX "PhCustomerPayment_restaurantId_customerId_createdAt_idx" ON "PhCustomerPayment"("restaurantId", "customerId", "createdAt");

-- CreateIndex
CREATE INDEX "PhCustomerPayment_restaurantId_branchId_createdAt_idx" ON "PhCustomerPayment"("restaurantId", "branchId", "createdAt");

-- CreateIndex
CREATE INDEX "PhCustomerPayment_shiftId_idx" ON "PhCustomerPayment"("shiftId");

-- CreateIndex
CREATE UNIQUE INDEX "PhCustomerPayment_restaurantId_id_key" ON "PhCustomerPayment"("restaurantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PhCustomerPayment_restaurantId_id_customerId_currency_key" ON "PhCustomerPayment"("restaurantId", "id", "customerId", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "PhCustomerPayment_restaurantId_clientKey_key" ON "PhCustomerPayment"("restaurantId", "clientKey");

-- CreateIndex
CREATE UNIQUE INDEX "PhCustomerPayment_reversesId_key" ON "PhCustomerPayment"("reversesId");

-- CreateIndex
CREATE INDEX "PhAiProposal_restaurantId_branchId_status_createdAt_idx" ON "PhAiProposal"("restaurantId", "branchId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PhAiProposal_restaurantId_id_key" ON "PhAiProposal"("restaurantId", "id");

-- CreateIndex
CREATE INDEX "PhSale_restaurantId_customerId_idx" ON "PhSale"("restaurantId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "PhSale_restaurantId_id_branchId_key" ON "PhSale"("restaurantId", "id", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "PhSale_restaurantId_id_currency_key" ON "PhSale"("restaurantId", "id", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "PhSaleLine_restaurantId_saleId_id_key" ON "PhSaleLine"("restaurantId", "saleId", "id");

-- AddForeignKey
ALTER TABLE "PhSale" ADD CONSTRAINT "PhSale_restaurantId_customerId_fkey" FOREIGN KEY ("restaurantId", "customerId") REFERENCES "PhCustomer"("restaurantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhPrescription" ADD CONSTRAINT "PhPrescription_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhPrescription" ADD CONSTRAINT "PhPrescription_restaurantId_branchId_fkey" FOREIGN KEY ("restaurantId", "branchId") REFERENCES "Branch"("restaurantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhPrescription" ADD CONSTRAINT "PhPrescription_restaurantId_saleId_branchId_fkey" FOREIGN KEY ("restaurantId", "saleId", "branchId") REFERENCES "PhSale"("restaurantId", "id", "branchId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhRxAttachment" ADD CONSTRAINT "PhRxAttachment_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhRxAttachment" ADD CONSTRAINT "PhRxAttachment_restaurantId_branchId_fkey" FOREIGN KEY ("restaurantId", "branchId") REFERENCES "Branch"("restaurantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhRxAttachment" ADD CONSTRAINT "PhRxAttachment_restaurantId_prescriptionId_branchId_fkey" FOREIGN KEY ("restaurantId", "prescriptionId", "branchId") REFERENCES "PhPrescription"("restaurantId", "id", "branchId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhControlledEntry" ADD CONSTRAINT "PhControlledEntry_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhControlledEntry" ADD CONSTRAINT "PhControlledEntry_restaurantId_branchId_fkey" FOREIGN KEY ("restaurantId", "branchId") REFERENCES "Branch"("restaurantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhControlledEntry" ADD CONSTRAINT "PhControlledEntry_restaurantId_saleId_branchId_fkey" FOREIGN KEY ("restaurantId", "saleId", "branchId") REFERENCES "PhSale"("restaurantId", "id", "branchId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhControlledEntry" ADD CONSTRAINT "PhControlledEntry_restaurantId_saleId_saleLineId_fkey" FOREIGN KEY ("restaurantId", "saleId", "saleLineId") REFERENCES "PhSaleLine"("restaurantId", "saleId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhControlledEntry" ADD CONSTRAINT "PhControlledEntry_restaurantId_productId_fkey" FOREIGN KEY ("restaurantId", "productId") REFERENCES "PhProduct"("restaurantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhControlledEntry" ADD CONSTRAINT "PhControlledEntry_restaurantId_productId_batchId_fkey" FOREIGN KEY ("restaurantId", "productId", "batchId") REFERENCES "PhBatch"("restaurantId", "productId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhControlledEntry" ADD CONSTRAINT "PhControlledEntry_restaurantId_prescriptionId_branchId_fkey" FOREIGN KEY ("restaurantId", "prescriptionId", "branchId") REFERENCES "PhPrescription"("restaurantId", "id", "branchId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhCustomer" ADD CONSTRAINT "PhCustomer_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhCustomerLedger" ADD CONSTRAINT "PhCustomerLedger_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhCustomerLedger" ADD CONSTRAINT "PhCustomerLedger_restaurantId_customerId_currency_fkey" FOREIGN KEY ("restaurantId", "customerId", "currency") REFERENCES "PhCustomer"("restaurantId", "id", "currency") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhCustomerLedger" ADD CONSTRAINT "PhCustomerLedger_restaurantId_saleId_currency_fkey" FOREIGN KEY ("restaurantId", "saleId", "currency") REFERENCES "PhSale"("restaurantId", "id", "currency") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhCustomerLedger" ADD CONSTRAINT "PhCustomerLedger_restaurantId_paymentId_customerId_currenc_fkey" FOREIGN KEY ("restaurantId", "paymentId", "customerId", "currency") REFERENCES "PhCustomerPayment"("restaurantId", "id", "customerId", "currency") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhCustomerPayment" ADD CONSTRAINT "PhCustomerPayment_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhCustomerPayment" ADD CONSTRAINT "PhCustomerPayment_restaurantId_branchId_fkey" FOREIGN KEY ("restaurantId", "branchId") REFERENCES "Branch"("restaurantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhCustomerPayment" ADD CONSTRAINT "PhCustomerPayment_restaurantId_customerId_currency_fkey" FOREIGN KEY ("restaurantId", "customerId", "currency") REFERENCES "PhCustomer"("restaurantId", "id", "currency") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhCustomerPayment" ADD CONSTRAINT "PhCustomerPayment_shiftId_branchId_fkey" FOREIGN KEY ("shiftId", "branchId") REFERENCES "PhShift"("id", "branchId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhCustomerPayment" ADD CONSTRAINT "PhCustomerPayment_restaurantId_reversesId_customerId_curre_fkey" FOREIGN KEY ("restaurantId", "reversesId", "customerId", "currency") REFERENCES "PhCustomerPayment"("restaurantId", "id", "customerId", "currency") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhAiProposal" ADD CONSTRAINT "PhAiProposal_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhAiProposal" ADD CONSTRAINT "PhAiProposal_restaurantId_branchId_fkey" FOREIGN KEY ("restaurantId", "branchId") REFERENCES "Branch"("restaurantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------------------------------------------------
-- Hand-written part (phase 7). Additive only: CHECKs and indexes of the new tables, one partial unique index, the append-only
-- triggers of the register, the ledger and the customer payments. No row of the new enum values is written here (a new value
-- cannot be used in the transaction that adds it); the CHECK of the cash movement that must know CUSTOMER_PAYMENT is replaced by
-- the next migration.
-- ---------------------------------------------------------------------------------------------------------------------

-- Settings: the controlled-drug limit (0 = no limit) is never negative; retention is above zero (NULL = never set).
ALTER TABLE "PhSettings" ADD CONSTRAINT "PhSettings_controlledMaxQty_nonnegative" CHECK ("controlledMaxQty" >= 0);
ALTER TABLE "PhSettings" ADD CONSTRAINT "PhSettings_rxRetentionDays_positive" CHECK ("rxRetentionDays" IS NULL OR "rxRetentionDays" > 0);

-- A prescription needs the number on the paper and who wrote it.
ALTER TABLE "PhPrescription" ADD CONSTRAINT "PhPrescription_number_present" CHECK (length(btrim("number")) > 0);
ALTER TABLE "PhPrescription" ADD CONSTRAINT "PhPrescription_prescriberName_present" CHECK (length(btrim("prescriberName")) > 0);

-- An attachment: 1 byte to 5 MB, an image or a PDF, a SHA-256 in lower-case hex.
ALTER TABLE "PhRxAttachment" ADD CONSTRAINT "PhRxAttachment_size_range" CHECK ("sizeBytes" BETWEEN 1 AND 5242880);
ALTER TABLE "PhRxAttachment" ADD CONSTRAINT "PhRxAttachment_mime_allowed" CHECK ("mime" LIKE 'image/%' OR "mime" = 'application/pdf');
ALTER TABLE "PhRxAttachment" ADD CONSTRAINT "PhRxAttachment_sha256_hex" CHECK ("sha256" ~ '^[0-9a-f]{64}$');

-- The controlled register: never zero; a sale adds units, a return takes them back.
ALTER TABLE "PhControlledEntry" ADD CONSTRAINT "PhControlledEntry_baseQty_nonzero" CHECK ("baseQty" <> 0);
ALTER TABLE "PhControlledEntry" ADD CONSTRAINT "PhControlledEntry_baseQty_sign" CHECK (("kind" = 'SALE' AND "baseQty" > 0) OR ("kind" = 'RETURN' AND "baseQty" < 0));

-- A customer: a name, and a limit of zero or more.
ALTER TABLE "PhCustomer" ADD CONSTRAINT "PhCustomer_name_present" CHECK (length(btrim("name")) > 0);
ALTER TABLE "PhCustomer" ADD CONSTRAINT "PhCustomer_creditLimit_nonnegative" CHECK ("creditLimitMinor" >= 0);

-- The ledger: never zero; a charge raises the debt, a payment or refund lowers it, a reversal undoes a payment (either sign).
-- A charge and a refund name their sale; a payment and a reversal name their payment row.
ALTER TABLE "PhCustomerLedger" ADD CONSTRAINT "PhCustomerLedger_amount_nonzero" CHECK ("amountMinor" <> 0);
ALTER TABLE "PhCustomerLedger" ADD CONSTRAINT "PhCustomerLedger_kind_sign" CHECK (
  ("kind" = 'CHARGE' AND "amountMinor" > 0)
  OR ("kind" IN ('PAYMENT', 'REFUND') AND "amountMinor" < 0)
  OR "kind" = 'REVERSAL'
);
ALTER TABLE "PhCustomerLedger" ADD CONSTRAINT "PhCustomerLedger_kind_reference" CHECK (
  ("kind" IN ('CHARGE', 'REFUND') AND "saleId" IS NOT NULL AND "paymentId" IS NULL)
  OR ("kind" IN ('PAYMENT', 'REVERSAL') AND "paymentId" IS NOT NULL AND "saleId" IS NULL)
);
-- One charge per sale (refunds of a sale may be many).
CREATE UNIQUE INDEX "PhCustomerLedger_one_charge_per_sale" ON "PhCustomerLedger"("saleId") WHERE "kind" = 'CHARGE';

-- A customer payment is above zero, and a cash one lands in a shift's drawer.
ALTER TABLE "PhCustomerPayment" ADD CONSTRAINT "PhCustomerPayment_amount_positive" CHECK ("amountMinor" > 0);
ALTER TABLE "PhCustomerPayment" ADD CONSTRAINT "PhCustomerPayment_cash_needs_shift" CHECK ("method" <> 'CASH' OR "shiftId" IS NOT NULL);

-- A proposal is decided exactly when it is no longer PROPOSED.
ALTER TABLE "PhAiProposal" ADD CONSTRAINT "PhAiProposal_decided_together" CHECK (("status" = 'PROPOSED') = ("decidedAt" IS NULL));

-- The register, the ledger and the customer payments are append-only (the function is the purchasing one): a direct UPDATE or
-- DELETE is refused; the delete of a whole business (a cascade) is the one removal allowed.
CREATE TRIGGER "PhControlledEntry_append_only" BEFORE UPDATE OR DELETE ON "PhControlledEntry" FOR EACH ROW EXECUTE FUNCTION "PhPurchasing_append_only"();
CREATE TRIGGER "PhCustomerLedger_append_only" BEFORE UPDATE OR DELETE ON "PhCustomerLedger" FOR EACH ROW EXECUTE FUNCTION "PhPurchasing_append_only"();
CREATE TRIGGER "PhCustomerPayment_append_only" BEFORE UPDATE OR DELETE ON "PhCustomerPayment" FOR EACH ROW EXECUTE FUNCTION "PhPurchasing_append_only"();
