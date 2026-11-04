import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseUrl, DB_HOST, DB_PASSWORD, DB_PORT, DB_USER } from '../../scripts/db-config';

/**
 * The migration that makes Retail three products (\`20261104100000_retail_activity\`) runs in production on a database
 * that already has retail shops (the test shop "Rizgar" among them). It must keep every row and make each existing shop a
 * Supermarket. A scratch database is built with every migration before it, given retail rows the way production has them,
 * and then this one migration is applied on top.
 */

const MIGRATIONS = join(process.cwd(), 'prisma', 'migrations');
const MIGRATION = '20261104100000_retail_activity';
const sqlOf = (folder: string) => readFileSync(join(MIGRATIONS, folder, 'migration.sql'), 'utf8');

const name = `buzzify_activity_${process.pid}`;
const admin = () => new pg.Client({ host: DB_HOST, port: DB_PORT, user: DB_USER, password: DB_PASSWORD, database: 'postgres' });
let db: pg.Client;

async function onAdmin(sql: string) {
  const client = admin();
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

beforeAll(async () => {
  await onAdmin(`DROP DATABASE IF EXISTS "${name}"`);
  await onAdmin(`CREATE DATABASE "${name}"`);
  db = new pg.Client({ connectionString: databaseUrl(name) });
  await db.connect();
  const before = readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name < MIGRATION)
    .map((entry) => entry.name)
    .sort();
  for (const folder of before) await db.query(sqlOf(folder));
  // Two retail shops as production has them, one already set up in Retails, and a restaurant that is not retail.
  await db.query(`
    INSERT INTO "Restaurant" ("id", "name", "sector", "updatedAt") VALUES
      ('shop-rizgar', 'Rizgar', 'RETAIL', now()),
      ('shop-two', 'Second Shop', 'RETAIL', now()),
      ('cafe-one', 'Cafe', 'FOOD', now());
    INSERT INTO "RetailLink" ("restaurantId", "retailBusinessId", "aiIntake", "stateVersion", "acceptedVersion", "sentHash", "updatedAt") VALUES
      ('shop-rizgar', 'rt-1', true, 7, 7, 'hash-rizgar', now()),
      ('shop-two', NULL, false, 0, 0, NULL, now());
  `);
}, 300_000);

afterAll(async () => {
  await db?.end();
  await onAdmin(`DROP DATABASE IF EXISTS "${name}"`);
});

describe(`the ${MIGRATION} migration`, () => {
  it('is additive: it creates a type and adds one column with a default, and nothing else', () => {
    const statements = sqlOf(MIGRATION)
      .replace(/--.*$/gm, '')
      .split(';')
      .map((statement) => statement.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    expect(statements).toEqual([
      `CREATE TYPE "RetailActivity" AS ENUM ('SUPERMARKET', 'ELECTRONICS', 'CLOTHING')`,
      `ALTER TABLE "RetailLink" ADD COLUMN "activity" "RetailActivity" NOT NULL DEFAULT 'SUPERMARKET'`,
    ]);
  });

  it('applies on a database that already has retail shops, keeps every row as it was and makes each a Supermarket', async () => {
    const snapshot = async () => (await db.query('SELECT * FROM "RetailLink" ORDER BY "restaurantId"')).rows as Array<Record<string, unknown>>;
    const restaurants = async () => (await db.query('SELECT "id", "name", "sector" FROM "Restaurant" ORDER BY "id"')).rows;
    const [linksBefore, restaurantsBefore] = [await snapshot(), await restaurants()];

    await db.query(sqlOf(MIGRATION));

    const linksAfter = await snapshot();
    expect(linksAfter.map((row) => row.activity)).toEqual(['SUPERMARKET', 'SUPERMARKET']);
    expect(linksAfter.map((row) => Object.fromEntries(Object.entries(row).filter(([column]) => column !== 'activity')))).toEqual(linksBefore);
    expect(await restaurants()).toEqual(restaurantsBefore);

    // A shop made afterwards gets the default, and a product of the three is accepted; anything else is refused.
    await db.query(`INSERT INTO "Restaurant" ("id", "name", "sector", "updatedAt") VALUES ('shop-volt', 'Volt', 'RETAIL', now())`);
    await db.query(`INSERT INTO "RetailLink" ("restaurantId", "activity", "updatedAt") VALUES ('shop-volt', 'ELECTRONICS', now())`);
    expect((await db.query(`SELECT "activity" FROM "RetailLink" WHERE "restaurantId" = 'shop-volt'`)).rows[0].activity).toBe('ELECTRONICS');
    await expect(db.query(`UPDATE "RetailLink" SET "activity" = 'MIXED' WHERE "restaurantId" = 'shop-volt'`)).rejects.toThrow(/invalid input value for enum/);
  });
});
