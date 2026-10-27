/* eslint-disable no-restricted-properties -- THROWAWAY spike: it measures raw-SQL row-level security on scratch tables. */
/**
 * THROWAWAY — Task 13 RLS spike (pharmacy phase 0-1). Not product code. Delete in Task 25 unless the decision in
 * docs/superpowers/specs/2026-10-27-pharmacy-rls-spike.md is ADOPT.
 *
 * Run: BUZZIFY_DB_PORT=54381 npx tsx scripts/spikes/rls-spike.ts
 *
 * It refuses to run unless DATABASE_URL and DIRECT_DATABASE_URL both point at the private worktree database on
 * 127.0.0.1:54381. Everything it creates is scratch and dropped in `finally`: the schema `rls_spike` (two tables) and
 * the login role `rls_spike_owner`. No real table gets RLS; prisma/schema.prisma and migrations are not touched.
 *
 * Why a role: a superuser always bypasses RLS (even with FORCE), and the local `postgres` user is a superuser. The
 * spike therefore connects the app path as `rls_spike_owner`, a NOSUPERUSER NOBYPASSRLS role that OWNS the scratch
 * tables, with FORCE ROW LEVEL SECURITY so the owner is subject to the policy too. That mirrors production, where the
 * app most likely connects as the same role that owns the tables (checked by NOT MEASURED item in the report).
 */
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { PrismaClient } from '@/generated/prisma/client';
import { databaseTarget } from '../database-target';

const PORT = '54381';
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const ROLE = 'rls_spike_owner';
const BUSINESSES = 20;
const ROWS_PER_BUSINESS = 5_000;
const N = 1_000;
const WARMUP = 100;
const LEAK_TX = 200;

function guard(name: string): string {
  const url = process.env[name];
  const target = url ? databaseTarget(url) : null;
  if (!url || !target || !LOCAL_HOSTS.has(target.host) || target.port !== PORT) {
    throw new Error(`${name} must point at the private database on 127.0.0.1:${PORT}; refusing to run.`);
  }
  return url;
}

const adminUrl = guard('DIRECT_DATABASE_URL');
const appBaseUrl = guard('DATABASE_URL');
const rolePassword = randomBytes(18).toString('hex');
const roleUrl = (() => {
  const u = new URL(appBaseUrl);
  u.username = ROLE;
  u.password = rolePassword;
  return u.toString();
})();

/** The app's adapter (src/server/data/prisma.ts uses `new PrismaPg({ connectionString })`); `max` only for the pool tests. */
function appClient(max?: number): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg(max ? { connectionString: roleUrl, max } : { connectionString: roleUrl }) });
}

const biz = (i: number) => `spike-biz-${String(i).padStart(2, '0')}`;
const pct = (sorted: number[], p: number) => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
function stats(samples: number[]) {
  const s = [...samples].sort((a, b) => a - b);
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  return { n: s.length, p50: +pct(s, 0.5).toFixed(3), p95: +pct(s, 0.95).toFixed(3), mean: +mean.toFixed(3) };
}

async function setup(admin: pg.Client) {
  await admin.query(`DROP SCHEMA IF EXISTS rls_spike CASCADE`);
  await admin.query(`DROP ROLE IF EXISTS ${ROLE}`);
  await admin.query(
    `CREATE ROLE ${ROLE} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD '${rolePassword}'`,
  );
  await admin.query(`CREATE SCHEMA rls_spike AUTHORIZATION ${ROLE}`);
  // Tables are created by the role, so it owns them (the owner case is the one FORCE exists for).
  await admin.query(`SET ROLE ${ROLE}`);
  for (const t of ['product_plain', 'product_rls']) {
    await admin.query(`CREATE TABLE rls_spike.${t} (
      id bigserial PRIMARY KEY,
      restaurant_id text NOT NULL,
      name text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now())`);
    await admin.query(`CREATE INDEX ${t}_search ON rls_spike.${t} (restaurant_id, lower(name) text_pattern_ops)`);
  }
  await admin.query(`ALTER TABLE rls_spike.product_rls ENABLE ROW LEVEL SECURITY`);
  await admin.query(`ALTER TABLE rls_spike.product_rls FORCE ROW LEVEL SECURITY`);
  // NULLIF: after one SET LOCAL on a connection the placeholder reads '' (not NULL) for the rest of the session.
  await admin.query(`CREATE POLICY tenant ON rls_spike.product_rls
    USING (restaurant_id = NULLIF(current_setting('app.restaurant_id', true), ''))
    WITH CHECK (restaurant_id = NULLIF(current_setting('app.restaurant_id', true), ''))`);
  await admin.query(`RESET ROLE`);
  // Seed as the superuser (bypasses RLS), identical data in both tables.
  for (const t of ['product_plain', 'product_rls']) {
    await admin.query(
      `INSERT INTO rls_spike.${t} (restaurant_id, name)
       SELECT 'spike-biz-' || lpad(b::text, 2, '0'), 'Product ' || md5(b::text || '-' || i::text)
       FROM generate_series(0, $1::int - 1) b, generate_series(1, $2::int) i`,
      [BUSINESSES, ROWS_PER_BUSINESS],
    );
    await admin.query(`ANALYZE rls_spike.${t}`);
  }
}

type Db = PrismaClient;
type Tx = Parameters<Parameters<Db['$transaction']>[0]>[0];
const setLocal = (tx: Tx, id: string) => tx.$executeRaw`SELECT set_config('app.restaurant_id', ${id}, true)`;

// ctx.scoped today: one statement, explicit tenant filter, no transaction.
const searchPlain = (db: Db, id: string, q: string) =>
  db.$queryRaw`SELECT id, name FROM rls_spike.product_plain WHERE restaurant_id = ${id} AND lower(name) LIKE ${q} ORDER BY lower(name) LIMIT 20`;
const searchPlainTx = (db: Db, id: string, q: string) =>
  db.$transaction(async (tx) => {
    await setLocal(tx, id);
    return tx.$queryRaw`SELECT id, name FROM rls_spike.product_plain WHERE restaurant_id = ${id} AND lower(name) LIKE ${q} ORDER BY lower(name) LIMIT 20`;
  });
// The ADOPT pattern: SET LOCAL + policy, explicit filter kept (ctx.scoped stays as the first line).
const searchRls = (db: Db, id: string, q: string) =>
  db.$transaction(async (tx) => {
    await setLocal(tx, id);
    return tx.$queryRaw`SELECT id, name FROM rls_spike.product_rls WHERE restaurant_id = ${id} AND lower(name) LIKE ${q} ORDER BY lower(name) LIMIT 20`;
  });
// Policy only (no explicit filter).
const searchRlsPolicyOnly = (db: Db, id: string, q: string) =>
  db.$transaction(async (tx) => {
    await setLocal(tx, id);
    return tx.$queryRaw`SELECT id, name FROM rls_spike.product_rls WHERE lower(name) LIKE ${q} ORDER BY lower(name) LIMIT 20`;
  });
const insertPlain = (db: Db, id: string, name: string) =>
  db.$executeRaw`INSERT INTO rls_spike.product_plain (restaurant_id, name) VALUES (${id}, ${name})`;
const insertPlainTx = (db: Db, id: string, name: string) =>
  db.$transaction(async (tx) => {
    await setLocal(tx, id);
    return tx.$executeRaw`INSERT INTO rls_spike.product_plain (restaurant_id, name) VALUES (${id}, ${name})`;
  });
const insertRls = (db: Db, id: string, name: string) =>
  db.$transaction(async (tx) => {
    await setLocal(tx, id);
    return tx.$executeRaw`INSERT INTO rls_spike.product_rls (restaurant_id, name) VALUES (${id}, ${name})`;
  });

async function timed(fn: () => Promise<unknown>): Promise<number> {
  const t = performance.now();
  await fn();
  return performance.now() - t;
}

/** Runs every variant once per iteration, rotating the order, so drift and caching hit all variants alike. */
async function bench(variants: Record<string, (i: number) => Promise<unknown>>) {
  const names = Object.keys(variants);
  const out: Record<string, number[]> = Object.fromEntries(names.map((n) => [n, []]));
  for (let i = 0; i < WARMUP + N; i++) {
    for (let k = 0; k < names.length; k++) {
      const name = names[(i + k) % names.length];
      const ms = await timed(() => variants[name](i));
      if (i >= WARMUP) out[name].push(ms);
    }
  }
  return Object.fromEntries(names.map((n) => [n, stats(out[n])]));
}

const hex = '0123456789abcdef';
const prefix = (i: number) => `product ${hex[(i * 7) % 16]}${hex[(i * 13 + 5) % 16]}%`;

async function performance_(db: Db, admin: pg.Client) {
  const explain = async (sql: string, setting: string | null) => {
    await admin.query('BEGIN');
    await admin.query(`SET LOCAL ROLE ${ROLE}`);
    if (setting) await admin.query(`SELECT set_config('app.restaurant_id', $1, true)`, [setting]);
    const r = await admin.query(sql);
    await admin.query('ROLLBACK');
    return r.rows.map((row) => row['QUERY PLAN']).join('\n');
  };
  const plans = {
    plain: await explain(`EXPLAIN SELECT id, name FROM rls_spike.product_plain WHERE restaurant_id = 'spike-biz-03' AND lower(name) LIKE 'product a1%' ORDER BY lower(name) LIMIT 20`, null),
    rls: await explain(`EXPLAIN SELECT id, name FROM rls_spike.product_rls WHERE restaurant_id = 'spike-biz-03' AND lower(name) LIKE 'product a1%' ORDER BY lower(name) LIMIT 20`, 'spike-biz-03'),
    rlsPolicyOnly: await explain(`EXPLAIN SELECT id, name FROM rls_spike.product_rls WHERE lower(name) LIKE 'product a1%' ORDER BY lower(name) LIMIT 20`, 'spike-biz-03'),
  };
  const search = await bench({
    plainNoTx: (i) => searchPlain(db, biz(i % BUSINESSES), prefix(i)),
    plainInTxWithSetLocal: (i) => searchPlainTx(db, biz(i % BUSINESSES), prefix(i)),
    rlsInTx: (i) => searchRls(db, biz(i % BUSINESSES), prefix(i)),
    rlsInTxPolicyOnly: (i) => searchRlsPolicyOnly(db, biz(i % BUSINESSES), prefix(i)),
  });
  const insert = await bench({
    plainNoTx: (i) => insertPlain(db, biz(i % BUSINESSES), `Bench ${i}`),
    plainInTxWithSetLocal: (i) => insertPlainTx(db, biz(i % BUSINESSES), `Bench ${i}`),
    rlsInTx: (i) => insertRls(db, biz(i % BUSINESSES), `Bench ${i}`),
  });
  return { plans, search, insert };
}

/** How many statements one SET LOCAL transaction sends, from Prisma's own query log. */
async function statementsPerTx(): Promise<string[]> {
  const seen: string[] = [];
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: roleUrl }),
    log: [{ emit: 'event', level: 'query' }],
  });
  db.$on('query', (e) => seen.push(e.query.replace(/\s+/g, ' ').slice(0, 60)));
  await searchRls(db, biz(1), 'product a%');
  await db.$disconnect();
  return seen;
}

async function failClosed(admin: pg.Client) {
  const results: Record<string, unknown> = {};
  const fresh = new pg.Client({ connectionString: roleUrl });
  await fresh.connect();
  results.freshConnNoSetting_selectRows = (await fresh.query(`SELECT count(*)::int AS n FROM rls_spike.product_rls`)).rows[0].n;
  try {
    await fresh.query(`SELECT current_setting('app.restaurant_id')`);
    results.freshConn_currentSettingWithoutMissingOk = 'returned a value';
  } catch (e) {
    results.freshConn_currentSettingWithoutMissingOk = `error: ${(e as Error).message}`;
  }
  await fresh.query('BEGIN');
  await fresh.query(`SELECT set_config('app.restaurant_id', 'spike-biz-01', true)`);
  results.inTx_rowsVisible = (await fresh.query(`SELECT count(*)::int AS n FROM rls_spike.product_rls`)).rows[0].n;
  await fresh.query('COMMIT');
  results.reusedConnAfterSetLocal_settingValue = JSON.stringify(
    (await fresh.query(`SELECT current_setting('app.restaurant_id', true) AS v`)).rows[0].v,
  );
  results.reusedConnAfterSetLocal_selectRows = (await fresh.query(`SELECT count(*)::int AS n FROM rls_spike.product_rls`)).rows[0].n;
  results.noSetting_updateRowCount = (await fresh.query(`UPDATE rls_spike.product_rls SET name = name`)).rowCount;
  results.noSetting_deleteRowCount = (await fresh.query(`DELETE FROM rls_spike.product_rls`)).rowCount;
  try {
    await fresh.query(`INSERT INTO rls_spike.product_rls (restaurant_id, name) VALUES ('spike-biz-01', 'x')`);
    results.noSetting_insert = 'ACCEPTED (bad)';
  } catch (e) {
    results.noSetting_insert = `refused: ${(e as Error).message}`;
  }
  await fresh.query('BEGIN');
  await fresh.query(`SELECT set_config('app.restaurant_id', 'spike-biz-01', true)`);
  try {
    await fresh.query(`INSERT INTO rls_spike.product_rls (restaurant_id, name) VALUES ('spike-biz-02', 'x')`);
    results.settingA_insertForB = 'ACCEPTED (bad)';
  } catch (e) {
    results.settingA_insertForB = `refused: ${(e as Error).message}`;
  }
  await fresh.query('ROLLBACK');

  // Session-level set_config (is_local = false) on a reused connection: the next "request" inherits it.
  await fresh.query(`SELECT set_config('app.restaurant_id', 'spike-biz-05', false)`);
  results.sessionSet_nextQueryRowsVisible = (await fresh.query(`SELECT count(*)::int AS n FROM rls_spike.product_rls`)).rows[0].n;
  await fresh.query(`RESET app.restaurant_id`);

  // FORCE is load-bearing: without it the owner role sees every row with no setting at all.
  await admin.query(`ALTER TABLE rls_spike.product_rls NO FORCE ROW LEVEL SECURITY`);
  results.ownerWithoutForce_noSettingRows = (await fresh.query(`SELECT count(*)::int AS n FROM rls_spike.product_rls`)).rows[0].n;
  await admin.query(`ALTER TABLE rls_spike.product_rls FORCE ROW LEVEL SECURITY`);
  results.ownerWithForceAgain_noSettingRows = (await fresh.query(`SELECT count(*)::int AS n FROM rls_spike.product_rls`)).rows[0].n;
  // A superuser bypasses RLS even with FORCE.
  results.superuserWithForce_noSettingRows = (await admin.query(`SELECT count(*)::int AS n FROM rls_spike.product_rls`)).rows[0].n;
  results.roleAttributes = (
    await fresh.query(`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`)
  ).rows[0];
  await fresh.end();
  return results;
}

/** 200 interleaved transactions for two businesses over a pool of 2 connections; every read is checked. */
async function leak() {
  const db = appClient(2);
  const A = biz(7);
  const B = biz(8);
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let crossReads = 0;
  let wrongSetting = 0;
  let outsideTxRows = 0;
  let rowsChecked = 0;
  const pids = new Set<number>();
  const one = async (i: number) => {
    const me = i % 2 === 0 ? A : B;
    await db.$transaction(async (tx) => {
      await setLocal(tx, me);
      await sleep(i % 3); // let other transactions interleave on the two connections
      const rows = await tx.$queryRaw<{ restaurant_id: string; pid: number; setting: string }[]>`
        SELECT restaurant_id, pg_backend_pid() AS pid, current_setting('app.restaurant_id', true) AS setting
        FROM rls_spike.product_rls`;
      for (const r of rows) {
        rowsChecked++;
        pids.add(r.pid);
        if (r.restaurant_id !== me) crossReads++;
        if (r.setting !== me) wrongSetting++;
      }
      if (rows.length === 0) crossReads++; // an empty result would also be wrong here
    });
    // A "next request" that forgets the transaction must see nothing, whichever connection it lands on.
    const after = await db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM rls_spike.product_rls`;
    outsideTxRows += after[0].n;
  };
  const CONCURRENCY = 8;
  for (let start = 0; start < LEAK_TX; start += CONCURRENCY) {
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, LEAK_TX - start) }, (_, k) => one(start + k)));
  }
  await db.$disconnect();

  // Contrast: the same loop with a session-level set (is_local=false) and no transaction, pool of 1.
  const bad = appClient(1);
  let badCrossReads = 0;
  for (let i = 0; i < 20; i++) {
    const me = i % 2 === 0 ? A : B;
    if (i % 4 !== 3) await bad.$executeRaw`SELECT set_config('app.restaurant_id', ${me}, false)`; // every 4th forgets
    const rows = await bad.$queryRaw<{ restaurant_id: string }[]>`SELECT DISTINCT restaurant_id FROM rls_spike.product_rls`;
    if (rows.some((r) => r.restaurant_id !== me)) badCrossReads++;
  }
  await bad.$disconnect();
  return { transactions: LEAK_TX, poolMax: 2, concurrency: CONCURRENCY, distinctBackendPids: pids.size, rowsChecked, crossReads, wrongSetting, outsideTxRows, contrastSessionSetCrossReadsOf20: badCrossReads };
}

function migrateDeploy(): string {
  // prisma.config.ts reads DIRECT_DATABASE_URL first, which guard() has pinned to the private database.
  const out = execFileSync(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy'], {
    encoding: 'utf8',
    env: { ...process.env, BUZZIFY_DB_PORT: PORT },
  });
  return out.trim().split('\n').slice(-2).join(' | ');
}

/** What a migration-like statement does when it runs as the FORCEd owner (no setting). */
async function migrationAsOwner() {
  const c = new pg.Client({ connectionString: roleUrl });
  await c.connect();
  const r: Record<string, unknown> = {};
  await c.query(`ALTER TABLE rls_spike.product_rls ADD COLUMN spike_flag boolean NOT NULL DEFAULT false`);
  r.ddlAddColumn = 'ok';
  r.backfillUpdateRowCount = (await c.query(`UPDATE rls_spike.product_rls SET spike_flag = true`)).rowCount;
  try {
    await c.query(`INSERT INTO rls_spike.product_rls (restaurant_id, name) VALUES ('spike-biz-01', 'seed row')`);
    r.seedInsert = 'accepted';
  } catch (e) {
    r.seedInsert = `refused: ${(e as Error).message}`;
  }
  await c.end();
  return r;
}

async function main() {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  const t0 = performance.now();
  try {
    await setup(admin);
    const db = appClient();
    const report: Record<string, unknown> = {};
    report.statementsPerSetLocalTx = await statementsPerTx();
    report.performance = await performance_(db, admin);
    await db.$disconnect();
    report.failClosed = await failClosed(admin);
    report.leak = await leak();
    report.migrateDeployWithForcedRlsTablePresent = migrateDeploy();
    report.migrationStatementsAsForcedOwner = await migrationAsOwner();
    report.seconds = +((performance.now() - t0) / 1000).toFixed(1);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await admin.query(`RESET ROLE`).catch(() => {});
    await admin.query(`DROP SCHEMA IF EXISTS rls_spike CASCADE`);
    await admin.query(`DROP ROLE IF EXISTS ${ROLE}`);
    const left = await admin.query(
      `SELECT (SELECT count(*) FROM pg_namespace WHERE nspname = 'rls_spike')::int AS schemas, (SELECT count(*) FROM pg_roles WHERE rolname = $1)::int AS roles`,
      [ROLE],
    );
    console.log('cleanup', JSON.stringify(left.rows[0]));
    await admin.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
