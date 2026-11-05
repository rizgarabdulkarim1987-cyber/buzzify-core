-- AlterTable: accounts Buzzify Retail asked for (additive, defaulted; existing accounts are ordinary Studio accounts).
ALTER TABLE "user" ADD COLUMN     "identityOnly" BOOLEAN NOT NULL DEFAULT false;
