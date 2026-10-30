-- Phase 6 whole-phase review I1 (additive). PhTransferLine.requestLineId had no index: the line trigger sums the sent lines of a request line
-- (WHERE "requestLineId" = ...) on every send and receive, and the self foreign key (restaurantId, transferId, requestLineId) is checked row by
-- row when request lines are deleted (a transfer edit, a business delete). Without an index both are scans of the whole table (the same shape as
-- the PhStockMovement.reversesId finding). The first index serves the foreign key, the second the trigger's single-column filter.
CREATE INDEX "PhTransferLine_restaurantId_transferId_requestLineId_idx" ON "PhTransferLine"("restaurantId", "transferId", "requestLineId");
CREATE INDEX "PhTransferLine_requestLineId_idx" ON "PhTransferLine"("requestLineId");
-- The transfers list and report read a window of PhTransfer by requestedAt (newest first). EXPLAIN on 20,000 transfers: Seq Scan + Sort (cost 841) without,
-- Index Scan + Incremental Sort (cost 35) with this index (tests/pharmacy/transfers-perf.test.ts).
CREATE INDEX "PhTransfer_restaurantId_requestedAt_idx" ON "PhTransfer"("restaurantId", "requestedAt");
