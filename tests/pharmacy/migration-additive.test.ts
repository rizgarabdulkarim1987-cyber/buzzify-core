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
 * Cashier migrations that touch only POS tables and must backfill rows or change an index (payment legs copy each old
 * payment into one leg; a split bill needs `PosPayment` unique per order and part instead of per order). They never touch a pharmacy table. Add a name here only for that case.
 */
const POS_ONLY = new Set(['20261028100000_cashier_split_payments', '20261028110000_cashier_payment_parts', '20261029130000_printer_default_unique']);

function pharmacyMigrations(): { name: string; sql: string }[] {
  if (!existsSync(MIGRATIONS)) return [];
  return readdirSync(MIGRATIONS)
    .filter((name) => /^\d{14}_/.test(name) && name > LAST_BEFORE_PHARMACY && !POS_ONLY.has(name))
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
    for (const { name, sql } of migrations) expect(destructive(sql), name).toEqual([]);
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
