-- At most one default receipt printer per restaurant (two simultaneous saves used to leave two).
UPDATE "PosPrinter" p
SET "isDefault" = false
WHERE p."isDefault"
  AND EXISTS (
    SELECT 1 FROM "PosPrinter" q
    WHERE q."restaurantId" = p."restaurantId" AND q."isDefault" AND (q."createdAt", q."id") < (p."createdAt", p."id")
  );

CREATE UNIQUE INDEX "PosPrinter_restaurantId_default_key" ON "PosPrinter"("restaurantId") WHERE "isDefault";
