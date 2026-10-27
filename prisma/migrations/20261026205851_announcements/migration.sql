-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "titles" JSONB NOT NULL,
    "bodies" JSONB NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Announcement_archivedAt_startsAt_idx" ON "Announcement"("archivedAt", "startsAt");
