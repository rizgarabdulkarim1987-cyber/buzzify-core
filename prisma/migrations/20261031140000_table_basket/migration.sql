-- The table basket (project 5, plan feature ordering.tableBasket): one guest's part of a table's shared basket.
CREATE TABLE "TableBasketPart" (
    "id" TEXT NOT NULL,
    "menuId" TEXT NOT NULL,
    "tableNumber" INTEGER NOT NULL,
    "ownerKey" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "lines" JSONB NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentPublicId" TEXT,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "TableBasketPart_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TableBasketPart_menuId_tableNumber_ownerKey_key" ON "TableBasketPart"("menuId", "tableNumber", "ownerKey");

CREATE INDEX "TableBasketPart_menuId_tableNumber_updatedAt_idx" ON "TableBasketPart"("menuId", "tableNumber", "updatedAt");

ALTER TABLE "TableBasketPart" ADD CONSTRAINT "TableBasketPart_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "Menu"("id") ON DELETE CASCADE ON UPDATE CASCADE;
