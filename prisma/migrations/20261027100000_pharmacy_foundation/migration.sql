-- CreateEnum
CREATE TYPE "BusinessSector" AS ENUM ('FOOD', 'PHARMACY');

-- CreateEnum
CREATE TYPE "PhRole" AS ENUM ('OWNER', 'BRANCH_MANAGER', 'PHARMACIST_IN_CHARGE', 'PHARMACIST', 'CASHIER', 'STOCK', 'ACCOUNTANT');

-- AlterTable
ALTER TABLE "Restaurant" ADD COLUMN     "sector" "BusinessSector" NOT NULL DEFAULT 'FOOD';

-- CreateTable
CREATE TABLE "PhSettings" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "enabledCurrencies" "Currency"[] DEFAULT ARRAY['IQD']::"Currency"[],
    "defaultCurrency" "Currency" NOT NULL DEFAULT 'IQD',
    "rxRetentionDays" INTEGER,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhStaff" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "PhRole" NOT NULL,
    "deactivatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhStaff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhStaffBranch" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhStaffBranch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppPlan" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" JSONB NOT NULL,
    "features" JSONB NOT NULL DEFAULT '{}',
    "limits" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportAccessGrant" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "granteeUserId" TEXT NOT NULL,
    "scopes" TEXT[],
    "reason" TEXT NOT NULL,
    "approvedByUserId" TEXT,
    "consentRef" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportAccessGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PhSettings_restaurantId_key" ON "PhSettings"("restaurantId");

-- CreateIndex
CREATE INDEX "PhStaff_restaurantId_idx" ON "PhStaff"("restaurantId");

-- CreateIndex
CREATE INDEX "PhStaff_userId_idx" ON "PhStaff"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PhStaff_restaurantId_userId_key" ON "PhStaff"("restaurantId", "userId");

-- CreateIndex
CREATE INDEX "PhStaffBranch_restaurantId_idx" ON "PhStaffBranch"("restaurantId");

-- CreateIndex
CREATE INDEX "PhStaffBranch_branchId_idx" ON "PhStaffBranch"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "PhStaffBranch_staffId_branchId_key" ON "PhStaffBranch"("staffId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "AppPlan_applicationId_code_key" ON "AppPlan"("applicationId", "code");

-- CreateIndex
CREATE INDEX "SupportAccessGrant_restaurantId_idx" ON "SupportAccessGrant"("restaurantId");

-- CreateIndex
CREATE INDEX "SupportAccessGrant_granteeUserId_idx" ON "SupportAccessGrant"("granteeUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Branch_restaurantId_id_key" ON "Branch"("restaurantId", "id");

-- AddForeignKey
ALTER TABLE "PhSettings" ADD CONSTRAINT "PhSettings_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhStaff" ADD CONSTRAINT "PhStaff_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhStaff" ADD CONSTRAINT "PhStaff_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhStaffBranch" ADD CONSTRAINT "PhStaffBranch_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhStaffBranch" ADD CONSTRAINT "PhStaffBranch_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "PhStaff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhStaffBranch" ADD CONSTRAINT "PhStaffBranch_restaurantId_branchId_fkey" FOREIGN KEY ("restaurantId", "branchId") REFERENCES "Branch"("restaurantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppPlan" ADD CONSTRAINT "AppPlan_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportAccessGrant" ADD CONSTRAINT "SupportAccessGrant_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportAccessGrant" ADD CONSTRAINT "SupportAccessGrant_granteeUserId_fkey" FOREIGN KEY ("granteeUserId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The pharmacy product row, DISABLED until it is switched on. Inserted by hand (not generated); a row that already
-- exists keeps what it has. The ar and ckb names are machine-drafted.
INSERT INTO "Application" ("id", "name", "status", "sortOrder", "createdAt", "updatedAt")
VALUES
  ('pharmacy', '{"en": "Pharmacy", "ar": "الصيدلية", "ckb": "دەرمانخانە"}', 'DISABLED', 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;