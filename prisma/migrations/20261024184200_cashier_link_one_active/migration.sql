-- One ACTIVE link per menu: a revoked link stays as history, a second pairing needs the first one gone.
CREATE UNIQUE INDEX "CashierLink_one_active_per_menu" ON "CashierLink"("menuId") WHERE "status" = 'ACTIVE';
