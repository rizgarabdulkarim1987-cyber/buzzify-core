import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Pharmacy ships additive migrations only: new tables, columns with defaults, new rows. This guard reads every migration
 * created after the last pre-pharmacy one and refuses anything that would drop, rename, delete or rewrite existing data.
 * Each rule is a matcher run on inline samples (so it is known to flag a bad statement) and on the real folders.
 */

const MIGRATIONS = join(process.cwd(), 'prisma', 'migrations');
const LAST_BEFORE_PHARMACY = '20261026300000_complaint_suggestion';

/** Strips `--` line comments and splits into statements. */
function statements(sql: string): string[] {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Statements that drop, delete, truncate, rename, or update an existing table. */
function destructive(sql: string): string[] {
  return statements(sql).filter((s) => /\b(DROP|TRUNCATE|RENAME)\b/i.test(s) || /^DELETE\s+FROM\b/i.test(s) || /^UPDATE\b/i.test(s));
}

/** Inserts into any table but `Application`. */
function insertsOutsideApplication(sql: string): string[] {
  return statements(sql).filter((s) => /^INSERT\s+INTO\b/i.test(s) && !/^INSERT\s+INTO\s+"Application"/i.test(s));
}

function applicationInserts(sql: string): string[] {
  return statements(sql).filter((s) => /^INSERT\s+INTO\s+"Application"/i.test(s));
}

/**
 * One narrow exemption. The transfer tables were created by an earlier migration of the same unreleased phase (nothing is
 * deployed, they hold no rows), and the review of that schema needed constraints, a column and an enum of those two tables
 * replaced, which cannot be said without a DROP. This migration may drop objects of PhTransfer and PhTransferLine, and the enum
 * it replaces, and nothing else: any other destructive statement in it is still refused.
 */
const REWORK_OF_UNRELEASED_TABLES: Record<string, RegExp> = {
  '20261031110000_pharmacy_transfers_fixes': /^(ALTER TABLE "PhTransfer(Line)?" DROP (CONSTRAINT|COLUMN)|DROP TYPE "PhTransferDiffReason"$)/i,
};

/** The destructive statements of a migration that its exemption (if any) does not cover. */
function refusedIn(name: string, sql: string): string[] {
  const allowed = REWORK_OF_UNRELEASED_TABLES[name];
  return destructive(sql).filter((statement) => !(allowed && allowed.test(statement.replace(/\s+/g, ' '))));
}

function pharmacyMigrations(): { name: string; sql: string }[] {
  if (!existsSync(MIGRATIONS)) return [];
  return readdirSync(MIGRATIONS)
    .filter((name) => /^\d{14}_/.test(name) && name > LAST_BEFORE_PHARMACY)
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(MIGRATIONS, name, 'migration.sql'), 'utf8') }));
}

describe('the additive-migration matchers', () => {
  it('flag drops, renames, deletes, truncates, column drops and updates', () => {
    for (const bad of [
      'DROP TABLE "Branch"',
      'ALTER TABLE "Branch" DROP COLUMN "city"',
      'ALTER TABLE "Branch" RENAME COLUMN "city" TO "town"',
      'ALTER TABLE "Branch" RENAME TO "Site"',
      'DELETE FROM "Application"',
      'TRUNCATE "Branch"',
      'UPDATE "Restaurant" SET "name" = \'x\'',
    ]) {
      expect(destructive(bad), bad).toHaveLength(1);
    }
  });

  it('accept additive statements and ignore comments', () => {
    const ok = `-- DROP in a comment\nCREATE TABLE "PhStaff" ("id" TEXT NOT NULL);\nALTER TABLE "Restaurant" ADD COLUMN "sector" "BusinessSector" NOT NULL DEFAULT 'FOOD';\nCREATE UNIQUE INDEX "x" ON "Branch"("restaurantId", "id");`;
    expect(destructive(ok)).toEqual([]);
  });

  it('flag an insert into any table but Application', () => {
    expect(insertsOutsideApplication('INSERT INTO "Restaurant" ("id") VALUES (\'a\')')).toHaveLength(1);
    expect(insertsOutsideApplication('INSERT INTO "Application" ("id") VALUES (\'pharmacy\')')).toEqual([]);
  });
});

describe('pharmacy migrations', () => {
  const migrations = pharmacyMigrations();

  it('a pharmacy migration never drops or renames', () => {
    for (const { name, sql } of migrations) expect(refusedIn(name, sql), name).toEqual([]);
  });

  it('the one exemption covers the transfer rework and nothing else', () => {
    const name = '20261031110000_pharmacy_transfers_fixes';
    const rework = ['ALTER TABLE "PhTransferLine" DROP CONSTRAINT "x"', 'ALTER TABLE "PhTransfer" DROP COLUMN "y"', 'DROP TYPE "PhTransferDiffReason"'];
    expect(refusedIn(name, rework.join(';\n'))).toEqual([]);
    expect(refusedIn(name, 'ALTER TABLE "PhBatch" DROP COLUMN "lot"')).toHaveLength(1);
    expect(refusedIn(name, 'DROP TABLE "PhTransfer"')).toHaveLength(1);
    expect(refusedIn(name, 'UPDATE "PhTransfer" SET "note" = \'x\'')).toHaveLength(1);
    expect(refusedIn(name, 'DROP TYPE "PhMovementType"')).toHaveLength(1);
    // any other migration gets no exemption
    expect(refusedIn('20261031100000_pharmacy_transfers', 'ALTER TABLE "PhTransferLine" DROP COLUMN "y"')).toHaveLength(1);
  });

  it('a pharmacy migration only inserts the pharmacy application row', () => {
    for (const { name, sql } of migrations) {
      expect(insertsOutsideApplication(sql), name).toEqual([]);
      for (const insert of applicationInserts(sql)) {
        expect(insert, name).toMatch(/'pharmacy'/);
        expect(insert, name).toMatch(/\bON CONFLICT\b/i);
      }
    }
  });
});
