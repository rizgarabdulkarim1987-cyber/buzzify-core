-- CreateEnum
CREATE TYPE "PlanTier" AS ENUM ('BASIC', 'PRO', 'PREMIUM');

-- AlterTable
ALTER TABLE "Restaurant" ADD COLUMN     "plan" "PlanTier" NOT NULL DEFAULT 'PREMIUM',
ADD COLUMN     "planExtras" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "planNote" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "isPlatformOwner" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Restaurant_plan_idx" ON "Restaurant"("plan");

-- At most one platform owner.
CREATE UNIQUE INDEX "user_one_platform_owner" ON "user" ("isPlatformOwner") WHERE "isPlatformOwner";

-- The platform owner is the first Super Admin created who is still active: on the live site, the account made with
-- `npm run studio:create-admin` when the Studio was set up. Every existing restaurant is on PREMIUM (the column default),
-- so no guest sees a change.
UPDATE "user" SET "isPlatformOwner" = true
WHERE "id" = (
  SELECT "id" FROM "user" WHERE "isSuperAdmin" AND "deactivatedAt" IS NULL ORDER BY "createdAt" ASC, "id" ASC LIMIT 1
);
