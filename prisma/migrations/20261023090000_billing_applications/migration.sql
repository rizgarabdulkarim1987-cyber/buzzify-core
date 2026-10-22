-- The products a restaurant can subscribe to. Billing needs these two rows to exist, and `prisma migrate deploy` is all
-- a production build runs, so they are inserted here rather than only by the demo seed. The values match
-- `DEFAULT_APPLICATIONS` (src/server/domain/billing/catalog.ts); the ar and ckb names are machine-drafted. A row that
-- already exists (a database the seed reached first) keeps what it has.
INSERT INTO "Application" ("id", "name", "status", "sortOrder", "createdAt", "updatedAt")
VALUES
  ('menu', '{"en": "Menu", "ar": "المنيو", "ckb": "مێنو"}', 'ACTIVE', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('cashier', '{"en": "Cashier", "ar": "الكاشير", "ckb": "کاشێر"}', 'DISABLED', 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
