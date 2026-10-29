-- Phase 6: a sent transfer remembers whether it was sent out of expiry order, so a replay says the same as the first answer.
ALTER TABLE "PhTransfer" ADD COLUMN "sendOverride" BOOLEAN NOT NULL DEFAULT false;
