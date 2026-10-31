-- A dated occasion can tint the menu (Ramadan, Newroz, Eid); null is no mood.
ALTER TABLE "Occasion" ADD COLUMN "mood" TEXT;
