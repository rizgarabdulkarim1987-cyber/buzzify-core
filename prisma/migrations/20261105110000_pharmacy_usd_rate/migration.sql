-- AlterTable (additive: a defaulted column, no existing data is touched)
ALTER TABLE "PhSettings" ADD COLUMN "usdRate" INTEGER NOT NULL DEFAULT 1450;

-- Display-only exchange rate: IQD per 1 USD.
ALTER TABLE "PhSettings" ADD CONSTRAINT "PhSettings_usdRate_check" CHECK ("usdRate" >= 1 AND "usdRate" <= 1000000);
