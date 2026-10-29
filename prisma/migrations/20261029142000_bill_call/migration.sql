-- CreateTable
CREATE TABLE "PosBillCall" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "tableNumber" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seenAt" TIMESTAMP(3),
    "seenByUserId" TEXT,

    CONSTRAINT "PosBillCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PosBillCall_restaurantId_seenAt_idx" ON "PosBillCall"("restaurantId", "seenAt");

-- CreateIndex
CREATE INDEX "PosBillCall_tableId_createdAt_idx" ON "PosBillCall"("tableId", "createdAt");

-- AddForeignKey
ALTER TABLE "PosBillCall" ADD CONSTRAINT "PosBillCall_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosBillCall" ADD CONSTRAINT "PosBillCall_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "PosTable"("id") ON DELETE CASCADE ON UPDATE CASCADE;
