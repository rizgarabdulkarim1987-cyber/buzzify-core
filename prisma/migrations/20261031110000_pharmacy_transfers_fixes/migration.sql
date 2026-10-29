-- Pharmacy transfers, review fixes of the schema (phase 6, task 1 review). The tables were created by the migration before this
-- one and nothing is deployed: this migration reshapes objects of PhTransfer and PhTransferLine only, drops no data of any other
-- table, and the tables hold no rows when it runs (a line gains required columns without a default). It adds:
--   * send and receive idempotency keys (sendKey/sendHash, receiveKey/receiveHash) on the transfer;
--   * line ends (fromBranchId/toBranchId) tied to the parent's by a composite FK, so a line is confined like its transfer;
--   * a batch of the line's own product (composite FK through a new unique on PhBatch), one line per batch of a transfer;
--   * request lines (what was asked) apart from sent lines (one per batch, requestLineId set, requestedQty 0);
--   * lostReason (LOST | OTHER) in place of the single diffReason: a damaged quantity needs no reason, it is the reason;
--   * exact status shapes, ordered times, a number on every transfer;
--   * triggers: a sent transfer and its lines cannot be deleted or rewound, ends never change, sent lines change only their
--     receive columns while SENT, and the sent quantities of a request line never exceed what was requested.

-- CreateEnum
CREATE TYPE "PhTransferLostReason" AS ENUM ('LOST', 'OTHER');

-- DropForeignKey
ALTER TABLE "PhTransferLine" DROP CONSTRAINT "PhTransferLine_restaurantId_batchId_fkey";

-- DropForeignKey
ALTER TABLE "PhTransferLine" DROP CONSTRAINT "PhTransferLine_restaurantId_transferId_fkey";

-- Old rules replaced below.
ALTER TABLE "PhTransferLine" DROP CONSTRAINT "PhTransferLine_loss_needs_reason";
ALTER TABLE "PhTransferLine" DROP CONSTRAINT "PhTransferLine_requestedQty_positive";
ALTER TABLE "PhTransferLine" DROP CONSTRAINT "PhTransferLine_unsent_has_no_batch";
ALTER TABLE "PhTransfer" DROP CONSTRAINT "PhTransfer_sent_needs_sender";
ALTER TABLE "PhTransfer" DROP CONSTRAINT "PhTransfer_received_needs_time";
ALTER TABLE "PhTransfer" DROP CONSTRAINT "PhTransfer_cancelled_never_sent";
ALTER TABLE "PhTransfer" DROP CONSTRAINT "PhTransfer_requested_not_sent";

-- AlterTable
ALTER TABLE "PhTransfer" ADD COLUMN     "receiveHash" TEXT,
ADD COLUMN     "receiveKey" TEXT,
ADD COLUMN     "sendHash" TEXT,
ADD COLUMN     "sendKey" TEXT;

-- AlterTable
ALTER TABLE "PhTransferLine" DROP COLUMN "diffReason",
ADD COLUMN     "fromBranchId" TEXT NOT NULL,
ADD COLUMN     "lostReason" "PhTransferLostReason",
ADD COLUMN     "requestLineId" TEXT,
ADD COLUMN     "toBranchId" TEXT NOT NULL;

-- DropEnum
DROP TYPE "PhTransferDiffReason";

-- CreateIndex
CREATE UNIQUE INDEX "PhBatch_restaurantId_productId_id_key" ON "PhBatch"("restaurantId", "productId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PhTransfer_restaurantId_id_fromBranchId_toBranchId_key" ON "PhTransfer"("restaurantId", "id", "fromBranchId", "toBranchId");

-- CreateIndex
CREATE UNIQUE INDEX "PhTransfer_restaurantId_sendKey_key" ON "PhTransfer"("restaurantId", "sendKey");

-- CreateIndex
CREATE UNIQUE INDEX "PhTransfer_restaurantId_receiveKey_key" ON "PhTransfer"("restaurantId", "receiveKey");

-- CreateIndex
CREATE UNIQUE INDEX "PhTransferLine_restaurantId_transferId_id_key" ON "PhTransferLine"("restaurantId", "transferId", "id");

-- AddForeignKey
ALTER TABLE "PhTransferLine" ADD CONSTRAINT "PhTransferLine_restaurantId_transferId_fromBranchId_toBran_fkey" FOREIGN KEY ("restaurantId", "transferId", "fromBranchId", "toBranchId") REFERENCES "PhTransfer"("restaurantId", "id", "fromBranchId", "toBranchId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhTransferLine" ADD CONSTRAINT "PhTransferLine_restaurantId_productId_batchId_fkey" FOREIGN KEY ("restaurantId", "productId", "batchId") REFERENCES "PhBatch"("restaurantId", "productId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhTransferLine" ADD CONSTRAINT "PhTransferLine_restaurantId_transferId_requestLineId_fkey" FOREIGN KEY ("restaurantId", "transferId", "requestLineId") REFERENCES "PhTransferLine"("restaurantId", "transferId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- One line per batch in a transfer (a batch cannot be on two lines of it).
CREATE UNIQUE INDEX "PhTransferLine_transfer_batch_key" ON "PhTransferLine"("transferId", "batchId") WHERE "batchId" IS NOT NULL;

-- Every transfer is numbered when it is requested.
ALTER TABLE "PhTransfer" ADD CONSTRAINT "PhTransfer_number_set" CHECK ("number" IS NOT NULL AND length("number") > 0);

-- Idempotency of send and receive: a key and its payload hash come together; a sent transfer has its send key, a closed one
-- its receive key, and no other has either.
ALTER TABLE "PhTransfer" ADD CONSTRAINT "PhTransfer_send_key_pair" CHECK (("sendKey" IS NULL) = ("sendHash" IS NULL));
ALTER TABLE "PhTransfer" ADD CONSTRAINT "PhTransfer_receive_key_pair" CHECK (("receiveKey" IS NULL) = ("receiveHash" IS NULL));
ALTER TABLE "PhTransfer" ADD CONSTRAINT "PhTransfer_keys_by_status" CHECK (
  ("sendKey" IS NOT NULL) = ("status" IN ('SENT', 'RECEIVED', 'PARTIAL'))
  AND ("receiveKey" IS NOT NULL) = ("status" IN ('RECEIVED', 'PARTIAL'))
);

-- Each status is an exact shape of who and when: nothing stray, nothing missing.
ALTER TABLE "PhTransfer" ADD CONSTRAINT "PhTransfer_status_shape" CHECK (
  CASE "status"
    WHEN 'REQUESTED' THEN "sentAt" IS NULL AND "sentById" IS NULL AND "receivedAt" IS NULL AND "receivedById" IS NULL AND "cancelledAt" IS NULL AND "cancelledById" IS NULL
    WHEN 'SENT' THEN "sentAt" IS NOT NULL AND "sentById" IS NOT NULL AND "receivedAt" IS NULL AND "receivedById" IS NULL AND "cancelledAt" IS NULL AND "cancelledById" IS NULL
    WHEN 'CANCELLED' THEN "cancelledAt" IS NOT NULL AND "cancelledById" IS NOT NULL AND "sentAt" IS NULL AND "sentById" IS NULL AND "receivedAt" IS NULL AND "receivedById" IS NULL
    ELSE "sentAt" IS NOT NULL AND "sentById" IS NOT NULL AND "receivedAt" IS NOT NULL AND "receivedById" IS NOT NULL AND "cancelledAt" IS NULL AND "cancelledById" IS NULL
  END
);
ALTER TABLE "PhTransfer" ADD CONSTRAINT "PhTransfer_times_ordered" CHECK (
  ("sentAt" IS NULL OR "sentAt" >= "requestedAt") AND ("receivedAt" IS NULL OR "receivedAt" >= "sentAt") AND ("cancelledAt" IS NULL OR "cancelledAt" >= "requestedAt")
);

-- A line is a request line (what was asked of a product: no batch, nothing sent) or a sent line (one batch FEFO took from, tied to its
-- request line, asking nothing itself, at least one unit sent).
ALTER TABLE "PhTransferLine" ADD CONSTRAINT "PhTransferLine_kind_shape" CHECK (
  ("requestLineId" IS NULL AND "batchId" IS NULL AND "requestedQty" >= 1 AND "sentQty" = 0 AND "receivedQty" = 0 AND "lostQty" = 0 AND "damagedQty" = 0 AND "quarantine" = false)
  OR ("requestLineId" IS NOT NULL AND "batchId" IS NOT NULL AND "requestedQty" = 0 AND "sentQty" >= 1)
);

-- A lost quantity says LOST or OTHER, and a reason only comes with one. A damaged quantity needs no reason: it is the reason.
ALTER TABLE "PhTransferLine" ADD CONSTRAINT "PhTransferLine_lost_reason" CHECK (("lostQty" > 0) = ("lostReason" IS NOT NULL));

-- Rows of a transfer cannot be deleted once it was sent, and a transfer never goes back or moves. The delete of a whole business (a
-- cascade, which runs inside the foreign key's own trigger, so the trigger depth is above 1) is the one removal allowed.
CREATE FUNCTION "PhTransfer_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF pg_trigger_depth() > 1 OR OLD."status" IN ('REQUESTED', 'CANCELLED') THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'PhTransfer: a sent transfer cannot be deleted';
  END IF;
  IF NEW."id" <> OLD."id" OR NEW."restaurantId" <> OLD."restaurantId" OR NEW."fromBranchId" <> OLD."fromBranchId" OR NEW."toBranchId" <> OLD."toBranchId"
     OR NEW."clientKey" <> OLD."clientKey" OR NEW."payloadHash" <> OLD."payloadHash" OR NEW."number" IS DISTINCT FROM OLD."number"
     OR NEW."requestedById" <> OLD."requestedById" OR NEW."requestedAt" <> OLD."requestedAt" THEN
    RAISE EXCEPTION 'PhTransfer: the ends, the keys, the number and the request of a transfer never change';
  END IF;
  IF OLD."status" IN ('RECEIVED', 'PARTIAL', 'CANCELLED') THEN
    RAISE EXCEPTION 'PhTransfer: a closed transfer cannot change';
  END IF;
  IF OLD."status" = 'REQUESTED' AND NEW."status" NOT IN ('REQUESTED', 'SENT', 'CANCELLED') THEN
    RAISE EXCEPTION 'PhTransfer: a request is sent or cancelled';
  END IF;
  IF OLD."status" = 'SENT' THEN
    IF NEW."status" NOT IN ('RECEIVED', 'PARTIAL') THEN
      RAISE EXCEPTION 'PhTransfer: a sent transfer is received, in full or in part';
    END IF;
    IF NEW."sentAt" IS DISTINCT FROM OLD."sentAt" OR NEW."sentById" IS DISTINCT FROM OLD."sentById"
       OR NEW."sendKey" IS DISTINCT FROM OLD."sendKey" OR NEW."sendHash" IS DISTINCT FROM OLD."sendHash" THEN
      RAISE EXCEPTION 'PhTransfer: the send of a transfer never changes';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "PhTransfer_guard" BEFORE UPDATE OR DELETE ON "PhTransfer" FOR EACH ROW EXECUTE FUNCTION "PhTransfer_guard"();

-- Lines follow their transfer: added and removed while it is a request (a cancelled one may go), and while it is SENT only the
-- receive columns of a line change. A sent line never asks for more than its request line, and is of the request line's product.
CREATE FUNCTION "PhTransferLine_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  parent "PhTransferStatus";
  asked INTEGER;
  askedProduct TEXT;
  already BIGINT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF pg_trigger_depth() > 1 THEN
      RETURN OLD;
    END IF;
    SELECT "status" INTO parent FROM "PhTransfer" WHERE "id" = OLD."transferId";
    IF parent IS NULL OR parent IN ('REQUESTED', 'CANCELLED') THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'PhTransferLine: the lines of a sent transfer cannot be deleted';
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT "status" INTO parent FROM "PhTransfer" WHERE "id" = NEW."transferId";
    IF parent IS DISTINCT FROM 'REQUESTED' THEN
      RAISE EXCEPTION 'PhTransferLine: lines are added while the transfer is a request';
    END IF;
  ELSE
    SELECT "status" INTO parent FROM "PhTransfer" WHERE "id" = OLD."transferId";
    IF parent = 'SENT' THEN
      IF NEW."id" <> OLD."id" OR NEW."restaurantId" <> OLD."restaurantId" OR NEW."transferId" <> OLD."transferId"
         OR NEW."fromBranchId" <> OLD."fromBranchId" OR NEW."toBranchId" <> OLD."toBranchId" OR NEW."lineNo" <> OLD."lineNo"
         OR NEW."productId" <> OLD."productId" OR NEW."batchId" IS DISTINCT FROM OLD."batchId"
         OR NEW."requestLineId" IS DISTINCT FROM OLD."requestLineId" OR NEW."requestedQty" <> OLD."requestedQty" OR NEW."sentQty" <> OLD."sentQty" THEN
        RAISE EXCEPTION 'PhTransferLine: only the receive columns of a line of a sent transfer change';
      END IF;
    ELSIF parent IS DISTINCT FROM 'REQUESTED' THEN
      RAISE EXCEPTION 'PhTransferLine: the lines of a closed transfer cannot change';
    END IF;
  END IF;

  IF NEW."requestLineId" IS NOT NULL THEN
    SELECT "requestedQty", "productId" INTO asked, askedProduct FROM "PhTransferLine" WHERE "id" = NEW."requestLineId";
    IF askedProduct IS DISTINCT FROM NEW."productId" THEN
      RAISE EXCEPTION 'PhTransferLine: a sent line is of the product that was requested';
    END IF;
    SELECT COALESCE(SUM("sentQty"), 0) INTO already FROM "PhTransferLine" WHERE "requestLineId" = NEW."requestLineId" AND "id" <> NEW."id";
    IF already + NEW."sentQty" > asked THEN
      RAISE EXCEPTION 'PhTransferLine: more was sent than was requested';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "PhTransferLine_guard" BEFORE INSERT OR UPDATE OR DELETE ON "PhTransferLine" FOR EACH ROW EXECUTE FUNCTION "PhTransferLine_guard"();
