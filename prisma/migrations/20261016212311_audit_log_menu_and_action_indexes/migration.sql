-- CreateIndex
CREATE INDEX "AuditLog_menuId_occurredAt_idx" ON "AuditLog"("menuId", "occurredAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_occurredAt_idx" ON "AuditLog"("action", "occurredAt");
