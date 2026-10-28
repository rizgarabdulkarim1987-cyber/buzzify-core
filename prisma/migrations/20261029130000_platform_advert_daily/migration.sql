CREATE TABLE "PlatformAdvertDaily" (
    "id" TEXT NOT NULL,
    "advertId" TEXT NOT NULL,
    "menuId" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PlatformAdvertDaily_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlatformAdvertDaily_advertId_menuId_day_key" ON "PlatformAdvertDaily"("advertId", "menuId", "day");
CREATE INDEX "PlatformAdvertDaily_day_idx" ON "PlatformAdvertDaily"("day");
CREATE INDEX "PlatformAdvertDaily_restaurantId_day_idx" ON "PlatformAdvertDaily"("restaurantId", "day");
