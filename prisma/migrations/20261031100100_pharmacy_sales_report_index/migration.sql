-- Reports read sales by the day they were completed, per branch (phase 6, R6-10). The existing index is on createdAt, which
-- differs for a sale that was held first; EXPLAIN over 100,000 sales showed the month scan of two branches reading 40,000
-- rows (2,080 buffers) to keep 3,401, against 3,401 rows (184 buffers) with this index. Additive: one new index.

-- CreateIndex
CREATE INDEX "PhSale_restaurantId_branchId_completedAt_idx" ON "PhSale"("restaurantId", "branchId", "completedAt");
