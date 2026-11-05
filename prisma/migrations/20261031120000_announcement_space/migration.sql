-- An announcement belongs to the project (space) it was written in; the existing ones are Menu and Cashier's.
ALTER TABLE "Announcement" ADD COLUMN "space" TEXT NOT NULL DEFAULT 'food';
