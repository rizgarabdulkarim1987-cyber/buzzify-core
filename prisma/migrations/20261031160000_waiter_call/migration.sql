-- A call from a table is for the bill or for a waiter.
ALTER TABLE "PosBillCall" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'BILL';
