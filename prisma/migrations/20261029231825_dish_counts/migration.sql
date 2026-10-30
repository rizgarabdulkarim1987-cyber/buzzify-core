-- AlterTable
ALTER TABLE "Menu" ADD COLUMN     "dishCountsEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ProductViewTotal" (
    "id" TEXT NOT NULL,
    "menuId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductViewTotal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductViewMark" (
    "id" TEXT NOT NULL,
    "menuId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "guestKey" TEXT NOT NULL,
    "ipHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductViewMark_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductViewTotal_menuId_productId_key" ON "ProductViewTotal"("menuId", "productId");

-- CreateIndex
CREATE INDEX "ProductViewMark_menuId_productId_day_ipHash_idx" ON "ProductViewMark"("menuId", "productId", "day", "ipHash");

-- CreateIndex
CREATE INDEX "ProductViewMark_createdAt_idx" ON "ProductViewMark"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProductViewMark_menuId_productId_day_guestKey_key" ON "ProductViewMark"("menuId", "productId", "day", "guestKey");

-- AddForeignKey
ALTER TABLE "ProductViewTotal" ADD CONSTRAINT "ProductViewTotal_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "Menu"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductViewMark" ADD CONSTRAINT "ProductViewMark_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "Menu"("id") ON DELETE CASCADE ON UPDATE CASCADE;
