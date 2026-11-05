-- AlterTable
ALTER TABLE "PhStaff" ADD COLUMN     "aiDoctor" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "PhDoctorLog" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "questionText" TEXT,
    "answer" JSONB NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "outcome" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhDoctorLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PhDoctorLog_restaurantId_branchId_createdAt_idx" ON "PhDoctorLog"("restaurantId", "branchId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PhDoctorLog_restaurantId_id_key" ON "PhDoctorLog"("restaurantId", "id");

-- AddForeignKey
ALTER TABLE "PhDoctorLog" ADD CONSTRAINT "PhDoctorLog_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhDoctorLog" ADD CONSTRAINT "PhDoctorLog_restaurantId_branchId_fkey" FOREIGN KEY ("restaurantId", "branchId") REFERENCES "Branch"("restaurantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;
