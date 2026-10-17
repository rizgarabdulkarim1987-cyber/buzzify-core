-- CreateEnum
CREATE TYPE "MediaKind" AS ENUM ('IMAGE', 'SVG', 'ICON');

-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT,
    "kind" "MediaKind" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "storedBytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "variants" JSONB NOT NULL DEFAULT '{}',
    "placeholder" TEXT NOT NULL DEFAULT '',
    "alt" JSONB NOT NULL DEFAULT '{}',
    "folder" TEXT NOT NULL DEFAULT '',
    "tags" TEXT[],
    "uploadedById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MediaAsset_restaurantId_contentHash_idx" ON "MediaAsset"("restaurantId", "contentHash");

-- CreateIndex
CREATE INDEX "MediaAsset_restaurantId_folder_idx" ON "MediaAsset"("restaurantId", "folder");

-- CreateIndex
CREATE INDEX "MediaAsset_storageKey_idx" ON "MediaAsset"("storageKey");

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
