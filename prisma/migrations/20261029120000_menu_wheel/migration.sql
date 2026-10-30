-- CreateTable
CREATE TABLE "MenuWheel" (
    "id" TEXT NOT NULL,
    "menuId" TEXT NOT NULL,
    "spinsPerDay" INTEGER NOT NULL DEFAULT 1,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "title" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MenuWheel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WheelSlice" (
    "id" TEXT NOT NULL,
    "wheelId" TEXT NOT NULL,
    "menuId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "label" JSONB NOT NULL DEFAULT '{}',
    "weight" INTEGER NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "WheelSlice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WheelSpin" (
    "id" TEXT NOT NULL,
    "menuId" TEXT NOT NULL,
    "guestKey" TEXT NOT NULL,
    "ipHash" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WheelSpin_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MenuWheel_menuId_key" ON "MenuWheel"("menuId");

-- CreateIndex
CREATE INDEX "WheelSlice_menuId_idx" ON "WheelSlice"("menuId");

-- CreateIndex
CREATE UNIQUE INDEX "WheelSlice_wheelId_productId_key" ON "WheelSlice"("wheelId", "productId");

-- CreateIndex
CREATE INDEX "WheelSpin_menuId_day_ipHash_idx" ON "WheelSpin"("menuId", "day", "ipHash");

-- CreateIndex
CREATE INDEX "WheelSpin_createdAt_idx" ON "WheelSpin"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WheelSpin_menuId_day_guestKey_slot_key" ON "WheelSpin"("menuId", "day", "guestKey", "slot");

-- AddForeignKey
ALTER TABLE "MenuWheel" ADD CONSTRAINT "MenuWheel_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "Menu"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WheelSlice" ADD CONSTRAINT "WheelSlice_wheelId_fkey" FOREIGN KEY ("wheelId") REFERENCES "MenuWheel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WheelSlice" ADD CONSTRAINT "WheelSlice_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "Menu"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WheelSpin" ADD CONSTRAINT "WheelSpin_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "Menu"("id") ON DELETE CASCADE ON UPDATE CASCADE;

