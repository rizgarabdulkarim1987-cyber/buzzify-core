-- AlterTable
-- Additive: the business's IANA time zone for what is printed (receipts). A constant default (metadata only); the stored instants stay UTC.
-- The value is validated as a real zone by the application (Intl); the database only keeps it non-empty.
ALTER TABLE "PhSettings" ADD COLUMN     "timeZone" TEXT NOT NULL DEFAULT 'Asia/Baghdad';

-- Checks
ALTER TABLE "PhSettings" ADD CONSTRAINT "PhSettings_timeZone_not_blank" CHECK (length(btrim("timeZone")) > 0);
