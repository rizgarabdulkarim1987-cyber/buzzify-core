-- Central product search. pg_trgm's GIN operator class lets Postgres answer LIKE '%q%' and LIKE 'q%' from an index
-- instead of reading every product. Neon supports pg_trgm; check it on the target branch before deploying.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- The normalised text search reads (trade name, generic name, active ingredient, strength, form, manufacturer, each
-- normalised as the identity key is and joined by '|'). The product service writes it on every save. A product saved
-- before this column existed keeps '' until it is saved again: barcode search still finds it, name search does not.
-- (No such product exists: the pharmacy has not shipped.)
ALTER TABLE "PhProduct" ADD COLUMN "searchText" TEXT NOT NULL DEFAULT '';

CREATE INDEX "PhProduct_searchText_trgm" ON "PhProduct" USING GIN ("searchText" gin_trgm_ops);
