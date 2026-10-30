-- Phase 6 task 4b: indexes the reports and a cascade delete need (additive). The damaged report reads the ledger by branch and day, and asks of every
-- movement whether a reversal points at it; without these two indexes both are scans of the whole movement table.
CREATE INDEX "PhStockMovement_restaurantId_branchId_createdAt_idx" ON "PhStockMovement"("restaurantId", "branchId", "createdAt");
CREATE INDEX "PhStockMovement_reversesId_idx" ON "PhStockMovement"("reversesId");
