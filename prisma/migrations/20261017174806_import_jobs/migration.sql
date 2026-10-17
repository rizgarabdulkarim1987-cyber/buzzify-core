-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PARSED', 'APPLIED', 'DISCARDED', 'FAILED');

-- CreateTable
CREATE TABLE "ImportJob" (
    "id" TEXT NOT NULL,
    "menuId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'PARSED',
    "preview" JSONB NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "draftHash" TEXT NOT NULL,
    "hideMissing" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImportJob_menuId_createdAt_idx" ON "ImportJob"("menuId", "createdAt");

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "Menu"("id") ON DELETE CASCADE ON UPDATE CASCADE;
