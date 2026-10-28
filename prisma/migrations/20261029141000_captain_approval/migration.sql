-- AlterTable
ALTER TABLE "PosSettings" ADD COLUMN "captainApproval" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "PosCustomerOrder" ADD COLUMN "requiresCaptain" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "captainApprovedAt" TIMESTAMP(3),
ADD COLUMN "captainApprovedByUserId" TEXT,
ADD COLUMN "createdByUserId" TEXT;
