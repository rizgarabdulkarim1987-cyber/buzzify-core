-- A barcode that is not marked shared belongs to one unit of one product per business: two saves racing for the
-- same code cannot both keep it. Shared codes (several products on purpose) are left out.
CREATE UNIQUE INDEX "PhBarcode_one_unshared_code" ON "PhBarcode" ("restaurantId", "code") WHERE NOT "shared";
