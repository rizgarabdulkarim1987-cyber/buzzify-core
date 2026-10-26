-- CreateTable
CREATE TABLE "MenuMotion" (
    "id" TEXT NOT NULL,
    "menuId" TEXT NOT NULL,
    "slot" TEXT NOT NULL,
    "categoryId" TEXT,
    "motionId" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "texts" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MenuMotion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MenuMotion_categoryId_idx" ON "MenuMotion"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "MenuMotion_menuId_slot_key" ON "MenuMotion"("menuId", "slot");

-- AddForeignKey
ALTER TABLE "MenuMotion" ADD CONSTRAINT "MenuMotion_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "Menu"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuMotion" ADD CONSTRAINT "MenuMotion_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;
