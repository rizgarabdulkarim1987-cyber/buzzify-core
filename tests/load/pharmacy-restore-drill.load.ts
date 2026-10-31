import { spawnSync, execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as customerActions from '@/server/pharmacy/actions/customers';
import * as saleActions from '@/server/pharmacy/actions/sales';
import { databaseUrl, DB_HOST, DB_PASSWORD, DB_PORT, DB_USER } from '../../scripts/db-config';
import { creditWorld, creditSale, makeCustomer, key } from '../pharmacy/credit-world';
import { prisma, resetWorld } from '../pharmacy/fixture';
import { act, dataOf } from '../pharmacy/stock-helpers';

/**
 * The phase 8 backup and restore drill (`docs/pharmacy/restore-drill.md`). Run: `BUZZIFY_DB_PORT=54503 npx vitest run --config
 * vitest.load.config.ts tests/load/pharmacy-restore-drill.load.ts`.
 *
 * SAFETY. It touches ONLY two databases it creates itself on the private embedded server, named `drill_src_<time>_<random>` and
 * `drill_dst_<time>_<random>`. It never opens the shared databases (the test and dev ones are not read, written or dropped), refuses to
 * run on the shared ports or anywhere but 127.0.0.1, never uses FORCE, and removes only the two names it created (the DROP statement is
 * built from a name that matches the pattern AND is in the list of what this run created). Nothing here reads DATABASE_URL: Neon and
 * production cannot be reached from it.
 *
 * STEPS. 1 create the source scratch database and migrate it; 2 seed it through the REAL actions (a pharmacy with stock, cash sales,
 * a credit sale, a customer payment); 3 dump it and restore into a NEW scratch database (`pg_dump -Fc` + `pg_restore` when those
 * binaries are installed, otherwise a logical copy over the wire into a freshly migrated database, with triggers and foreign keys
 * off for the copy as `pg_restore` does); 4 compare every table's row count and content checksum, then the ledger invariants (stock
 * balances equal the sum of the movement deltas; customer balances equal the sum of the customer ledger; cash totals) on the
 * RESTORED database by plain SQL; 5 drop both scratch databases.
 */

const SHARED_PORTS = [54329, 54349, 54381, 54391];
const NAME = /^drill_(src|dst)_\d{14}_[0-9a-f]{6}$/;
const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const suffix = randomBytes(3).toString('hex');
const SRC = `drill_src_${stamp}_${suffix}`;
const DST = `drill_dst_${stamp}_${suffix}`;
const created: string[] = [];

let admin: pg.Client;
let src: pg.Client;
let dst: pg.Client;

const urlOf = (name: string) => databaseUrl(name);

/** The binary of a PostgreSQL client tool, if one is installed (PG_BIN or the PATH). */
function tool(name: 'pg_dump' | 'pg_restore'): string | null {
  const dir = process.env.PG_BIN;
  const candidates = dir ? [join(dir, name), join(dir, `${name}.exe`)] : [name];
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
    if (probe.status === 0) return candidate;
  }
  return null;
}

async function tables(client: pg.Client): Promise<string[]> {
  const rows = await client.query<{ table_name: string }>(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`);
  return rows.rows.map((r) => r.table_name);
}

/** Row count and a content checksum of one table (every row as text, sorted, hashed): identical data gives identical figures. */
async function fingerprint(client: pg.Client, table: string): Promise<{ rows: number; md5: string }> {
  const r = await client.query<{ n: string; h: string | null }>(`SELECT count(*) AS n, md5(string_agg(t::text, '|' ORDER BY t::text)) AS h FROM "${table}" t`);
  return { rows: Number(r.rows[0]!.n), md5: r.rows[0]!.h ?? '' };
}

async function invariants(client: pg.Client) {
  const one = async <T extends Record<string, string | null>>(text: string) => (await client.query<T>(text)).rows;
  const balances = (await one<{ available: string; reserved: string; quarantine: string; damaged: string }>(`SELECT COALESCE(sum(available),0) AS available, COALESCE(sum(reserved),0) AS reserved, COALESCE(sum(quarantine),0) AS quarantine, COALESCE(sum(damaged),0) AS damaged FROM "PhStockBalance"`))[0]!;
  const deltas = (await one<{ available: string; reserved: string; quarantine: string; damaged: string }>(`SELECT COALESCE(sum("availableDelta"),0) AS available, COALESCE(sum("reservedDelta"),0) AS reserved, COALESCE(sum("quarantineDelta"),0) AS quarantine, COALESCE(sum("damagedDelta"),0) AS damaged FROM "PhStockMovement"`))[0]!;
  // Per batch and branch too: a balance row that disagrees with its own movements while the totals cancel out would hide in the sums.
  const mismatched = (await one<{ n: string }>(`SELECT count(*) AS n FROM "PhStockBalance" b LEFT JOIN (SELECT "batchId","branchId", sum("availableDelta") a, sum("reservedDelta") r, sum("quarantineDelta") q, sum("damagedDelta") d FROM "PhStockMovement" GROUP BY 1,2) m ON m."batchId" = b."batchId" AND m."branchId" = b."branchId" WHERE b.available <> COALESCE(m.a,0) OR b.reserved <> COALESCE(m.r,0) OR b.quarantine <> COALESCE(m.q,0) OR b.damaged <> COALESCE(m.d,0)`))[0]!;
  const customers = await one<{ customerId: string; balance: string }>(`SELECT "customerId", sum("amountMinor")::text AS balance FROM "PhCustomerLedger" GROUP BY 1 ORDER BY 1`);
  const cash = (await one<{ total: string; n: string }>(`SELECT COALESCE(sum("amountMinor"),0)::text AS total, count(*)::text AS n FROM "PhCashMovement"`))[0]!;
  const sales = (await one<{ total: string; n: string }>(`SELECT COALESCE(sum("totalMinor"),0)::text AS total, count(*)::text AS n FROM "PhSale" WHERE status = 'COMPLETED'`))[0]!;
  return { balances, deltas, mismatchedBalanceRows: Number(mismatched.n), customers, cash, sales };
}

beforeAll(async () => {
  if (SHARED_PORTS.includes(DB_PORT)) throw new Error(`Refusing to run the drill on the shared port ${DB_PORT}`);
  if (DB_HOST !== '127.0.0.1') throw new Error('The drill runs on 127.0.0.1 only');
  if (!process.env.BUZZIFY_DB_PORT) throw new Error('Set BUZZIFY_DB_PORT explicitly (the drill never assumes a port)');
  admin = new pg.Client({ host: DB_HOST, port: DB_PORT, user: DB_USER, password: DB_PASSWORD, database: 'postgres' });
  await admin.connect();
  for (const name of [SRC, DST]) {
    if (!NAME.test(name)) throw new Error(`Bad scratch name ${name}`);
    const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (exists.rowCount) throw new Error(`${name} already exists: the drill only uses databases it creates`);
    await admin.query(`CREATE DATABASE "${name}"`);
    created.push(name);
  }
  // The application's client reads DATABASE_URL: the SOURCE scratch database, and nothing else, for this process.
  vi.stubEnv('DATABASE_URL', urlOf(SRC));
  vi.stubEnv('DIRECT_DATABASE_URL', '');
  vi.stubEnv('RESEND_API_KEY', '');
  (globalThis as { __prisma?: unknown }).__prisma = undefined;
  execSync('npx prisma migrate deploy', { stdio: 'pipe', env: { ...process.env, DATABASE_URL: urlOf(SRC), DIRECT_DATABASE_URL: '' } });
  src = new pg.Client({ connectionString: urlOf(SRC) });
  await src.connect();
}, 600_000);

afterAll(async () => {
  await Promise.allSettled([prisma().$disconnect(), src?.end(), dst?.end()]);
  for (const name of created) {
    // Only what this run created, and only a name of the exact scratch shape; a plain DROP (no FORCE): a connection left open makes it fail loudly instead of cutting it.
    if (!NAME.test(name) || !(name === SRC || name === DST)) throw new Error(`Refusing to drop ${name}`);
    await admin.query(`DROP DATABASE IF EXISTS "${name}"`).catch((error: unknown) => console.error(`[drill] could not drop ${name}:`, error instanceof Error ? error.message : error));
  }
  const left = await admin.query(`SELECT datname FROM pg_database WHERE datname LIKE 'drill\\_%'`);
  console.log(`DRILL-CLEANUP ${JSON.stringify({ droppedOrAttempted: created, scratchDatabasesLeft: left.rows.map((r: { datname: string }) => r.datname) })}`);
  await admin.end();
}, 120_000);

describe('backup and restore drill (phase 8)', () => {
  it('dumps a seeded scratch database, restores it into a NEW scratch database, and finds every table and every ledger total equal', async () => {
    // 2. Seed through the real actions.
    await resetWorld();
    const w = await creditWorld();
    const customer = await makeCustomer(w, { limit: 1_000_000n });
    dataOf(await act(w.cashier, saleActions.create, { restaurantId: w.a.id, branchId: w.b1, clientKey: key('sale'), currency: 'IQD', lines: [{ productId: w.p.id, unitId: w.p.tablet, qty: 5 }], payments: [{ method: 'CASH', amountMinor: 500n, clientKey: key('pay') }] }));
    dataOf(await act(w.pharmacist, saleActions.create, creditSale(w, customer.id as string, 3000n)));
    dataOf(await act(w.owner, customerActions.pay, { restaurantId: w.a.id, branchId: w.b1, customerId: customer.id, method: 'CARD', amountMinor: 1200n, clientKey: key('cpay') }));

    const before = await invariants(src);
    expect(Number(before.sales.n)).toBe(2);
    expect(before.customers).toEqual([{ customerId: customer.id, balance: '1800' }]);
    expect(before.mismatchedBalanceRows).toBe(0);

    // 3. Dump and restore into the NEW database.
    const dump = tool('pg_dump');
    const restore = tool('pg_restore');
    const mode = dump && restore ? 'pg_dump -Fc + pg_restore' : 'logical copy (no pg_dump/pg_restore installed)';
    if (dump && restore) {
      const dir = mkdtempSync(join(tmpdir(), 'ph-drill-'));
      const file = join(dir, 'drill.dump');
      try {
        const d = spawnSync(dump, ['-Fc', '--no-owner', '-f', file, urlOf(SRC)], { encoding: 'utf8' });
        expect(d.status, d.stderr).toBe(0);
        const r = spawnSync(restore, ['--no-owner', '--exit-on-error', '-d', urlOf(DST), file], { encoding: 'utf8' });
        expect(r.status, r.stderr).toBe(0);
      } finally {
        if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
      }
      dst = new pg.Client({ connectionString: urlOf(DST) });
      await dst.connect();
    } else {
      // The schema comes from the migrations (as a restore into a fresh server would get it from the dump's DDL), then every row is copied.
      execSync('npx prisma migrate deploy', { stdio: 'pipe', env: { ...process.env, DATABASE_URL: urlOf(DST), DIRECT_DATABASE_URL: '' } });
      dst = new pg.Client({ connectionString: urlOf(DST) });
      await dst.connect();
      await dst.query(`SET session_replication_role = replica`);
      // The migrations seed a few rows (the applications, the platform settings): the copy brings the source's own, so the new database starts empty. This is the NEW scratch database only.
      const copied = (await tables(src)).filter((t) => t !== '_prisma_migrations');
      await dst.query(`TRUNCATE ${copied.map((t) => `"${t}"`).join(', ')}`);
      for (const table of copied) {
        const json = (await src.query<{ j: string }>(`SELECT COALESCE(json_agg(t), '[]'::json)::text AS j FROM "${table}" t`)).rows[0]!.j;
        if (json === '[]') continue;
        await dst.query(`INSERT INTO "${table}" SELECT * FROM json_populate_recordset(null::"${table}", $1::json)`, [json]);
      }
      await dst.query(`SET session_replication_role = DEFAULT`);
    }

    // 4. Compare.
    const srcTables = await tables(src);
    const dstTables = await tables(dst);
    expect(dstTables).toEqual(srcTables);
    const report: Record<string, { rows: number; same: boolean }> = {};
    const different: string[] = [];
    for (const table of srcTables.filter((t) => t !== '_prisma_migrations')) {
      const a = await fingerprint(src, table);
      const b = await fingerprint(dst, table);
      report[table] = { rows: a.rows, same: a.rows === b.rows && a.md5 === b.md5 };
      if (!report[table]!.same) different.push(`${table}: ${a.rows} rows -> ${b.rows}`);
    }
    const nonEmpty = Object.entries(report).filter(([, v]) => v.rows > 0);
    const after = await invariants(dst);
    console.log(`DRILL ${JSON.stringify({ mode, src: SRC, dst: DST, tables: srcTables.length, nonEmptyTables: nonEmpty.length, rowsCopied: nonEmpty.reduce((n, [, v]) => n + v.rows, 0), differentTables: different, sampleCounts: Object.fromEntries(nonEmpty.filter(([k]) => /^Ph(Sale|Payment|StockMovement|StockBalance|CustomerLedger|CashMovement|Batch|Product)$/.test(k)).map(([k, v]) => [k, v.rows])), invariantsAfter: after })}`);
    expect(different).toEqual([]);
    expect(nonEmpty.length).toBeGreaterThan(10);
    expect(after).toEqual(before);
    expect(after.mismatchedBalanceRows).toBe(0);
    expect(after.customers).toEqual([{ customerId: customer.id, balance: '1800' }]);
  }, 600_000);
});
