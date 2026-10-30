import { createHash } from 'node:crypto';
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
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Statements that drop, delete, truncate, rename, or update an existing table. */
function destructive(sql: string): string[] {
  return statements(sql).filter((s) => /\b(DROP|TRUNCATE|RENAME)\b/i.test(s) || /\bDELETE\s+FROM\b/i.test(s) || /\bUPDATE\s+"?\w+"?\s+SET\b/i.test(s));
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
 * replaced, which cannot be said without a DROP. That one migration may drop exactly those objects and nothing else, and ONLY
 * while its file is the one reviewed: the exemption is pinned to the sha256 of the file (line ends normalised), so any later edit
 * of it, however small, loses the exemption and the guard fails. Each pattern is anchored at both ends, and a CASCADE is never
 * covered. The migration itself starts with a check that stops it when either table has rows. Squashing it into the migration
 * before it (and deleting this exemption) is a choice for the owner, before the first deploy.
 */
const REWORK_OF_UNRELEASED_TABLES: Record<string, { sha256: string; allowed: RegExp }> = {
  '20261031110000_pharmacy_transfers_fixes': {
    sha256: '731bd2a40f48dc2e9b32c5e53d45c215329cc57309f64561df45bec995eab08a',
    allowed: /^(?:ALTER TABLE "PhTransfer(?:Line)?" DROP CONSTRAINT "\w+"|ALTER TABLE "PhTransferLine" DROP COLUMN "diffReason"(?:, ADD COLUMN "\w+" (?:TEXT|"PhTransferLostReason")(?: NOT NULL)?)*|DROP TYPE "PhTransferDiffReason")$/i,
  },
  // Phase 7: a new enum value cannot be used in the transaction that adds it, so the drawer's sign CHECK (which must know
  // CUSTOMER_PAYMENT) is replaced by the next migration, in ONE statement that drops it and adds the same name back, widened by that
  // one type. The whole statement is pinned, along with the file.
  '20261101100100_pharmacy_cash_movement_customer_payment': {
    sha256: '8b7d927b4777031f190eafa91724e98b3a7d9233e0fdb37ee76b483be2c21770',
    allowed: /^ALTER TABLE "PhCashMovement" DROP CONSTRAINT "PhCashMovement_amount_sign", ADD CONSTRAINT "PhCashMovement_amount_sign" CHECK \( \("type" IN \('FLOAT_OPEN', 'SALE_CASH', 'PAID_IN', 'CUSTOMER_PAYMENT'\) AND "amountMinor" > 0\) OR \("type" IN \('CHANGE_OUT', 'REFUND_CASH', 'PAID_OUT'\) AND "amountMinor" < 0\) \)$/,
  },
};

const fingerprint = (sql: string) => createHash('sha256').update(sql.replace(/\r/g, '')).digest('hex');

/** The destructive statements of a migration that its exemption (if any) does not cover. */
function refusedIn(name: string, sql: string): string[] {
  const exemption = REWORK_OF_UNRELEASED_TABLES[name];
  const pinned = exemption !== undefined && fingerprint(sql) === exemption.sha256;
  return destructive(sql).filter((statement) => !(pinned && exemption.allowed.test(statement.replace(/\s+/g, ' '))));
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
      // not only at the start of a statement: inside a DO block or a WITH
      'DO $$ BEGIN DELETE FROM "PhBatch"; END $$',
      'DO $$ BEGIN UPDATE "PhBatch" SET "lot" = \'x\'; END $$',
      'WITH gone AS (DELETE FROM "PhBatch" RETURNING 1) SELECT 1',
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

  const FIXES = '20261031110000_pharmacy_transfers_fixes';
  const fixesSql = () => readFileSync(join(MIGRATIONS, FIXES, 'migration.sql'), 'utf8');

  it('the exemption holds for the reviewed file as it is, and its drops are exactly the ones it covers', () => {
    expect(fingerprint(fixesSql())).toBe(REWORK_OF_UNRELEASED_TABLES[FIXES]!.sha256);
    expect(destructive(fixesSql()).length).toBeGreaterThan(8);
    expect(refusedIn(FIXES, fixesSql())).toEqual([]);
  });

  it('loses the exemption on any later edit of the file, even a comment, a blank line or one more drop', () => {
    const sql = fixesSql();
    for (const edited of [sql + '\n', sql + '-- note', sql.replace('CREATE TYPE', 'CREATE  TYPE'), sql + '\nALTER TABLE "PhTransfer" DROP COLUMN "clientKey";']) {
      expect(refusedIn(FIXES, edited).length, edited.slice(-40)).toBeGreaterThan(8);
    }
    // line ends do not matter: a CRLF checkout is the same file
    expect(refusedIn(FIXES, sql.replace(/\n/g, '\r\n'))).toEqual([]);
  });

  it('covers only whole statements of the transfer rework: other tables, CASCADE, tails and other types are refused', () => {
    const covered = (statement: string) => REWORK_OF_UNRELEASED_TABLES[FIXES]!.allowed.test(statement.replace(/\s+/g, ' '));
    for (const good of [
      'ALTER TABLE "PhTransferLine" DROP CONSTRAINT "x_fkey"',
      'ALTER TABLE "PhTransfer" DROP CONSTRAINT "PhTransfer_a"',
      'DROP TYPE "PhTransferDiffReason"',
      'ALTER TABLE "PhTransferLine" DROP COLUMN "diffReason",\nADD COLUMN "fromBranchId" TEXT NOT NULL,\nADD COLUMN "lostReason" "PhTransferLostReason"',
    ]) {
      expect(covered(good), good).toBe(true);
    }
    for (const bad of [
      'ALTER TABLE "PhBatch" DROP COLUMN "lot"',
      'ALTER TABLE "PhTransfer" DROP COLUMN "clientKey"',
      'ALTER TABLE "PhTransferLine" DROP CONSTRAINT "x" CASCADE',
      'ALTER TABLE "PhTransferLine" DROP CONSTRAINT "x"; DROP TABLE "Branch"',
      'ALTER TABLE "PhTransferLine" DROP COLUMN "diffReason", DROP COLUMN "productId"',
      'DROP TYPE "PhTransferDiffReason" CASCADE',
      'DROP TYPE "PhMovementType"',
      'DROP TABLE "PhTransfer"',
      "UPDATE \"PhTransfer\" SET \"note\" = 'x'",
    ]) {
      expect(covered(bad), bad).toBe(false);
    }
    // any other migration gets no exemption, whatever its statements
    expect(refusedIn('20261031100000_pharmacy_transfers', 'ALTER TABLE "PhTransferLine" DROP COLUMN "diffReason"')).toHaveLength(1);
  });

  it('starts with a check that stops the migration when either transfer table has rows', () => {
    const first = statements(fixesSql())[0]!;
    expect(first).toMatch(/^DO \$\$/);
    expect(first).toMatch(/EXISTS \(SELECT 1 FROM "PhTransfer"\)/);
    expect(first).toMatch(/EXISTS \(SELECT 1 FROM "PhTransferLine"\)/);
    expect(first).toMatch(/RAISE EXCEPTION 'transfer tables must be empty'/);
  });

  describe('phase 7', () => {
    const PHASE7 = '20261101100000_pharmacy_phase7';
    const CASH = '20261101100100_pharmacy_cash_movement_customer_payment';
    const sqlOf = (name: string) => readFileSync(join(MIGRATIONS, name, 'migration.sql'), 'utf8');

    it('is additive as written, and adds the enum values only with IF NOT EXISTS', () => {
      const sql = sqlOf(PHASE7);
      expect(destructive(sql)).toEqual([]);
      expect(refusedIn(PHASE7, sql)).toEqual([]);
      expect(insertsOutsideApplication(sql)).toEqual([]);
      const alters = statements(sql).filter((statement) => /^ALTER TYPE /i.test(statement));
      expect(alters).toEqual([
        `ALTER TYPE "PhCashMovementType" ADD VALUE IF NOT EXISTS 'CUSTOMER_PAYMENT'`,
        `ALTER TYPE "PhPaymentMethod" ADD VALUE IF NOT EXISTS 'CREDIT'`,
      ]);
      // a value added here is not used here: nothing in the file names the new values except those two statements
      const others = statements(sql).filter((statement) => !/^ALTER TYPE /i.test(statement));
      expect(others.filter((statement) => /'CREDIT'|'CUSTOMER_PAYMENT'/.test(statement))).toEqual([]);
    });

    it('accepts enum additions and refuses a drop, an update or a delete added to the file', () => {
      const sql = sqlOf(PHASE7);
      expect(destructive(`ALTER TYPE "PhPaymentMethod" ADD VALUE IF NOT EXISTS 'X'; ALTER TABLE "PhSale" ADD COLUMN "x" TEXT`)).toEqual([]);
      for (const bad of [
        'DROP TABLE "PhCustomer"',
        'ALTER TABLE "PhSale" DROP COLUMN "customerId"',
        `ALTER TYPE "PhPaymentMethod" RENAME VALUE 'CREDIT' TO 'ACCOUNT'`,
        'UPDATE "PhSettings" SET "rxRetentionDays" = 3650',
        'DELETE FROM "PhPrescription"',
        'DO $$ BEGIN DELETE FROM "PhPrescription"; END $$',
        'ALTER TABLE "PhCashMovement" DROP CONSTRAINT "PhCashMovement_amount_sign"',
      ]) {
        const edited = `${sql}\n${bad};`;
        expect(refusedIn(PHASE7, edited), bad).toHaveLength(1);
        expect(refusedIn('20261101100200_next', edited), bad).toHaveLength(1);
      }
    });

    it('lets the drawer CHECK be replaced by exactly the reviewed file, and nothing else', () => {
      const sql = sqlOf(CASH);
      expect(destructive(sql)).toHaveLength(1);
      expect(refusedIn(CASH, sql)).toEqual([]);
      expect(fingerprint(sql)).toBe(REWORK_OF_UNRELEASED_TABLES[CASH]!.sha256);
      // any edit, a widened rule or a second drop loses it
      for (const edited of [sql + '\n', sql.replace("'PAID_IN'", "'PAID_IN', 'PAID_OUT'"), sql + 'ALTER TABLE "PhSale" DROP COLUMN "note";']) {
        expect(refusedIn(CASH, edited).length).toBeGreaterThan(0);
      }
      // the same statement in another migration is refused
      expect(refusedIn(PHASE7, sql)).toHaveLength(1);
      // the old rule is not left in place beside the new one: it is the same name, replaced
      expect(statements(sql)).toHaveLength(1);
    });
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
