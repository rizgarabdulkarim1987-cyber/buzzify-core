ALTER TABLE "Menu" ADD COLUMN "introEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Menu" ADD COLUMN "aboutEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Menu" ADD COLUMN "wheelEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "MenuIntro" (
    "id" TEXT NOT NULL,
    "menuId" TEXT NOT NULL,
    "backgroundAssetId" TEXT,
    "overlay" INTEGER NOT NULL DEFAULT 50,
    "showLogo" BOOLEAN NOT NULL DEFAULT true,
    "showContact" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MenuIntro_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MenuIntro_menuId_key" ON "MenuIntro"("menuId");

ALTER TABLE "MenuIntro" ADD CONSTRAINT "MenuIntro_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "Menu"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PlatformAdvert" (
    "id" TEXT NOT NULL,
    "imageAssetId" TEXT NOT NULL,
    "alts" JSONB NOT NULL DEFAULT '{}',
    "href" TEXT NOT NULL DEFAULT '',
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "restaurantIds" TEXT[],
    "menuIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformAdvert_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlatformIntro" (
    "id" TEXT NOT NULL,
    "backgroundAssetId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformIntro_pkey" PRIMARY KEY ("id")
);
