-- A return of a credit sale lowers the customer's balance first (phase 7, R7-5): how much of the refund went there.
-- AlterTable
ALTER TABLE "PhReturn" ADD COLUMN     "creditMinor" BIGINT NOT NULL DEFAULT 0;

-- The part taken off the balance is between nothing and the whole refund; the rest is what was handed back. (Named to sort after PhReturn_refundMinor_nonnegative, so a negative refund is still reported by that check first.)
ALTER TABLE "PhReturn" ADD CONSTRAINT "PhReturn_refund_credit_within" CHECK ("creditMinor" >= 0 AND "creditMinor" <= "refundMinor");
