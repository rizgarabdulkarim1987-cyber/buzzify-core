-- The menu's live offer at the till: whole IQD taken off one unit when a line is added. A constant default, so adding the
-- column rewrites no row; every line that exists keeps pricing as before.
ALTER TABLE "PosOrderLine" ADD COLUMN "promoDiscountPerUnit" INTEGER NOT NULL DEFAULT 0;
