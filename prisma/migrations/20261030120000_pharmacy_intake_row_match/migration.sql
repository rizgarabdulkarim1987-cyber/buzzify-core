-- AlterTable: what the matcher decided for a line, the acknowledgement a reviewer gave (bound to the flags and difference they saw),
-- a version for optimistic edits and the last repeat key. All additive, with defaults: no existing row changes meaning.
ALTER TABLE "PhIntakeRow" ADD COLUMN     "matchState" TEXT NOT NULL DEFAULT 'UNMATCHED',
ADD COLUMN     "candidates" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "acknowledged" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "lastKey" TEXT,
ADD COLUMN     "lastKeyHash" TEXT;

-- Hand-added CHECK (no Prisma drift): the state is one of the four the matcher and a person can give.
ALTER TABLE "PhIntakeRow" ADD CONSTRAINT "PhIntakeRow_matchState_allowed" CHECK ("matchState" IN ('MATCHED', 'UNMATCHED', 'AMBIGUOUS', 'CHOSEN'));
