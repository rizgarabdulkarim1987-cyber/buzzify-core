-- AlterTable
-- Additive: who closed the shift (the signed-in actor), nullable. Shifts closed before it keep NULL (the screen then falls back to approvedById / the cashier).
-- A plain user id like "userId" and "approvedById" on the same table (no foreign key to the user table).
ALTER TABLE "PhShift" ADD COLUMN     "closedById" TEXT;
