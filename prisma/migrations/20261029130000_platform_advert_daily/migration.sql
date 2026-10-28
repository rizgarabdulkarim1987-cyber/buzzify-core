CREATE TABLE "PlatformAdvertDaily" (
    "id" TEXT NOT NULL,
    "advertId" TEXT NOT NULL,
    "shownMenuId" TEXT NOT NULL,
    "shownRestaurantId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PlatformAdvertDaily_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlatformAdvertDaily_advertId_shownMenuId_day_key" ON "PlatformAdvertDaily"("advertId", "shownMenuId", "day");
CREATE INDEX "PlatformAdvertDaily_day_idx" ON "PlatformAdvertDaily"("day");
CREATE INDEX "PlatformAdvertDaily_shownRestaurantId_day_idx" ON "PlatformAdvertDaily"("shownRestaurantId", "day");
