-- Restaurant stories (project 3, plan feature guest.stories): one library picture, a caption, an end time.
CREATE TABLE "MenuStory" (
    "id" TEXT NOT NULL,
    "menuId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "productId" TEXT,
    "captions" JSONB NOT NULL DEFAULT '{}',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MenuStory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MenuStory_menuId_createdAt_idx" ON "MenuStory"("menuId", "createdAt");

ALTER TABLE "MenuStory" ADD CONSTRAINT "MenuStory_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "Menu"("id") ON DELETE CASCADE ON UPDATE CASCADE;
