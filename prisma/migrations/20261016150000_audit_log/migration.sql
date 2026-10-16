-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "restaurantId" TEXT,
    "menuId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "changes" JSONB NOT NULL DEFAULT '{}',
    "ip" TEXT NOT NULL DEFAULT '',
    "userAgent" TEXT NOT NULL DEFAULT '',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditLog_restaurantId_occurredAt_idx" ON "AuditLog"("restaurantId", "occurredAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_occurredAt_idx" ON "AuditLog"("actorId", "occurredAt");

-- CreateIndex
CREATE INDEX "AuditLog_occurredAt_idx" ON "AuditLog"("occurredAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_occurredAt_idx" ON "AuditLog"("entityType", "entityId", "occurredAt");
