CREATE TABLE "MenuAbout" (
    "id" TEXT NOT NULL,
    "menuId" TEXT NOT NULL,
    "titles" JSONB NOT NULL DEFAULT '{}',
    "coverAssetId" TEXT,
    "story" JSONB NOT NULL DEFAULT '{}',
    "galleryAssetIds" TEXT[],
    "showHours" BOOLEAN NOT NULL DEFAULT true,
    "showContact" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MenuAbout_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MenuAbout_menuId_key" ON "MenuAbout"("menuId");

ALTER TABLE "MenuAbout" ADD CONSTRAINT "MenuAbout_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "Menu"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AboutOffer" (
    "id" TEXT NOT NULL,
    "menuId" TEXT NOT NULL,
    "titles" JSONB NOT NULL DEFAULT '{}',
    "bodies" JSONB NOT NULL DEFAULT '{}',
    "label" JSONB NOT NULL DEFAULT '{}',
    "imageAssetId" TEXT,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "productId" TEXT,
    "categoryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AboutOffer_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AboutOffer_menuId_sortOrder_idx" ON "AboutOffer"("menuId", "sortOrder");

ALTER TABLE "AboutOffer" ADD CONSTRAINT "AboutOffer_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "Menu"("id") ON DELETE CASCADE ON UPDATE CASCADE;
