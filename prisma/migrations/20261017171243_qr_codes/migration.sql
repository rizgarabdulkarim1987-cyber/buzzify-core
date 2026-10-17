-- CreateTable
CREATE TABLE "QrCode" (
    "id" TEXT NOT NULL,
    "menuId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "tableNumber" INTEGER,
    "style" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QrCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QrCode_menuId_idx" ON "QrCode"("menuId");

-- CreateIndex
CREATE UNIQUE INDEX "QrCode_menuId_tableNumber_key" ON "QrCode"("menuId", "tableNumber");

-- AddForeignKey
ALTER TABLE "QrCode" ADD CONSTRAINT "QrCode_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "Menu"("id") ON DELETE CASCADE ON UPDATE CASCADE;
