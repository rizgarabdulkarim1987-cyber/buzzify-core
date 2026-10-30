import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as saleActions from '@/server/pharmacy/actions/sales';
import * as shiftActions from '@/server/pharmacy/actions/shifts';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { person, pharmacy, prisma, resetWorld, useTestDatabase, type Person } from '../pharmacy/fixture';
import { act, codeOf, dataOf, makeBatch, makeProduct, phCodeOf } from '../pharmacy/stock-helpers';

/**
 * Phase 8 concurrency run (`npm run test:load`, one file at a time with BUZZIFY_DB_PORT=54503): several tills sell the SAME batch at
 * once through the real sale action (qty 1 per sale, until the stock runs out), while another till closes its shift in the middle.
 * It prints one line `PHARMACY-LOAD {json}` per scenario with the latency percentiles, then checks the outcome by a SECOND,
 * independent connection (plain SQL, not the application's client): the balance is never negative, the number of SALE movements and
 * of completed sales equals the number of successes and the starting stock minus the balance, no sale number is used twice, and a
 * closed shift's expected cash equals the cash rows written for it (a sale either landed before the close or was refused).
 *
 * Honest limits: the tills share one Node process and its connection pool (Postgres sees concurrent transactions, the browser and
 * network are not in the path), and the database is the private embedded server, not Neon.
 */

const STOCK = 60;
const PRICE = 100n;
const NO_PAUSE = 0;

let sql: pg.Client;

beforeAll(async () => {
  useTestDatabase();
  sql = new pg.Client({ connectionString: databaseUrl(TEST_DB) });
  await sql.connect();
});
afterAll(async () => {
  await sql.end();
});
beforeEach(resetWorld);

const percentile = (sorted: number[], p: number) => sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;
const summary = (samples: number[]) => {
  const sorted = [...samples].sort((a, b) => a - b);
  return { n: sorted.length, p50: percentile(sorted, 50), p95: percentile(sorted, 95), p99: percentile(sorted, 99), max: sorted.at(-1) ?? 0 };
};

let seq = 0;
const key = (label: string) => `${label}-${Date.now()}-${(seq += 1)}-xxxxxxxx`;

async function world(tills: number) {
  const a = await pharmacy('A', { branches: 1 });
  const at = { restaurantId: a.id, branchId: a.branchId };
  await prisma().phSettings.create({ data: { restaurantId: a.id } });
  const manager = await person('manager', { staff: [a.id, 'BRANCH_MANAGER', [a.branchId]] });
  const p = await makeProduct(a.id, 'Panadol');
  await prisma().phPrice.create({ data: { restaurantId: a.id, productId: p.id, unitId: p.tablet, branchId: null, currency: 'IQD', amountMinor: PRICE, validFrom: new Date('2026-01-01T00:00:00.000Z'), changedById: 'seed' } });
  const batchId = await makeBatch(a.id, a.branchId, p.id, { lot: 'LOAD1', expiry: '2029-12-31', buckets: { available: STOCK } });
  const cashiers: { who: Person; shiftId: string }[] = [];
  for (let i = 0; i < tills; i += 1) {
    const who = await person(`till${i}`, { staff: [a.id, 'CASHIER', [a.branchId]] });
    const shiftId = dataOf(await act(who, shiftActions.open, { ...at, currency: 'IQD', openingFloatMinor: 0n, clientKey: key('open') })).id as string;
    cashiers.push({ who, shiftId });
  }
  return { a, at, manager, p, batchId, cashiers };
}

type World = Awaited<ReturnType<typeof world>>;

/** One till: sells one tablet at a time (`inFlight` loops at once) until the stock is gone, its shift is closed, or it has tried `cap` times. */
async function till(w: World, who: Person, inFlight: number, cap: number, latencies: number[], tally: { ok: number; noStock: number; closed: number; other: string[] }) {
  let attempts = 0;
  const loop = async () => {
    while (attempts < cap) {
      attempts += 1;
      const started = performance.now();
      const result = await act(who, saleActions.create, {
        ...w.at,
        clientKey: key('sale'),
        currency: 'IQD',
        lines: [{ productId: w.p.id, unitId: w.p.tablet, qty: 1 }],
        payments: [{ method: 'CASH', amountMinor: PRICE, clientKey: key('pay') }],
      });
      latencies.push(performance.now() - started);
      if (result.ok) tally.ok += 1;
      else if (phCodeOf(result) === 'INSUFFICIENT_STOCK') {
        tally.noStock += 1;
        return;
      } else if (codeOf(result) === 'CONFLICT' || codeOf(result) === 'FORBIDDEN') {
        tally.closed += 1;
        return;
      } else tally.other.push(`${codeOf(result)}:${phCodeOf(result)}`);
      if (NO_PAUSE) await new Promise((r) => setTimeout(r, NO_PAUSE));
    }
  };
  await Promise.all(Array.from({ length: inFlight }, loop));
}

async function oversellCheck(w: World, label: string, successes: number) {
  const balance = (await sql.query<{ available: number; reserved: number; quarantine: number; damaged: number }>(`SELECT available, reserved, quarantine, damaged FROM "PhStockBalance" WHERE "batchId" = $1 AND "branchId" = $2`, [w.batchId, w.a.branchId])).rows[0]!;
  const sold = (await sql.query<{ n: string; units: string }>(`SELECT count(*) AS n, COALESCE(-sum("availableDelta"), 0) AS units FROM "PhStockMovement" WHERE "batchId" = $1 AND type = 'SALE'`, [w.batchId])).rows[0]!;
  const sales = (await sql.query<{ n: string; distinct_numbers: string }>(`SELECT count(*) AS n, count(DISTINCT number) AS distinct_numbers FROM "PhSale" WHERE "restaurantId" = $1 AND status = 'COMPLETED'`, [w.a.id])).rows[0]!;
  const payments = (await sql.query<{ n: string }>(`SELECT count(*) AS n FROM "PhPayment" WHERE "restaurantId" = $1`, [w.a.id])).rows[0]!;
  const negative = (await sql.query<{ n: string }>(`SELECT count(*) AS n FROM "PhStockBalance" WHERE "restaurantId" = $1 AND (available < 0 OR reserved < 0 OR quarantine < 0 OR damaged < 0)`, [w.a.id])).rows[0]!;
  const check = {
    balanceAvailable: balance.available,
    saleMovements: Number(sold.n),
    unitsSold: Number(sold.units),
    completedSales: Number(sales.n),
    distinctSaleNumbers: Number(sales.distinct_numbers),
    payments: Number(payments.n),
    negativeBalanceRows: Number(negative.n),
    successesReported: successes,
  };
  console.log(`PHARMACY-LOAD-CHECK ${JSON.stringify({ label, ...check })}`);
  expect(check.negativeBalanceRows).toBe(0);
  expect(check.balanceAvailable).toBeGreaterThanOrEqual(0);
  expect(check.saleMovements).toBe(successes);
  expect(check.unitsSold).toBe(successes);
  expect(check.balanceAvailable).toBe(STOCK - successes);
  expect(check.completedSales).toBe(successes);
  expect(check.distinctSaleNumbers).toBe(successes);
  expect(check.payments).toBe(successes);
  return check;
}

async function shiftCheck(shiftId: string) {
  const shift = (await sql.query<{ status: string; expectedMinor: string | null }>(`SELECT status, "expectedMinor" FROM "PhShift" WHERE id = $1`, [shiftId])).rows[0]!;
  const cash = (await sql.query<{ total: string; n: string }>(`SELECT COALESCE(sum("amountMinor"), 0) AS total, count(*) AS n FROM "PhCashMovement" WHERE "shiftId" = $1`, [shiftId])).rows[0]!;
  return { status: shift.status, expectedMinor: shift.expectedMinor === null ? null : BigInt(shift.expectedMinor), cashTotal: BigInt(cash.total), cashRows: Number(cash.n) };
}

describe('pharmacy concurrency (phase 8)', () => {
  it('two tills sell the same stock to zero while a third closes its shift in the middle: no oversell, no double sale, the close agrees with its cash rows', async () => {
    const w = await world(3);
    const [a, b, c] = w.cashiers as [{ who: Person; shiftId: string }, { who: Person; shiftId: string }, { who: Person; shiftId: string }];
    const latencies: number[] = [];
    const tallies = [a, b, c].map(() => ({ ok: 0, noStock: 0, closed: 0, other: [] as string[] }));
    const closeAnswers: { ok: boolean; ms: number }[] = [];
    const started = performance.now();

    // The third till sells a little, then closes its shift (counted by the closer, with a reason: any variance is then allowed) while A and B keep selling.
    const closer = (async () => {
      await till(w, c.who, 1, 6, latencies, tallies[2]!);
      const t0 = performance.now();
      const result = await act(c.who, shiftActions.close, { ...w.at, shiftId: c.shiftId, countedMinor: BigInt(tallies[2]!.ok) * PRICE, reason: 'load run' });
      closeAnswers.push({ ok: result.ok, ms: performance.now() - t0 });
      // After the close this till sells nothing more.
      const after = await act(c.who, saleActions.create, { ...w.at, clientKey: key('late'), currency: 'IQD', lines: [{ productId: w.p.id, unitId: w.p.tablet, qty: 1 }], payments: [{ method: 'CASH', amountMinor: PRICE, clientKey: key('pay') }] });
      expect(after.ok).toBe(false);
    })();
    await Promise.all([till(w, a.who, 1, STOCK + 20, latencies, tallies[0]!), till(w, b.who, 1, STOCK + 20, latencies, tallies[1]!), closer]);
    const wall = performance.now() - started;

    const successes = tallies.reduce((n, t) => n + t.ok, 0);
    console.log(`PHARMACY-LOAD ${JSON.stringify({ scenario: 'two tills + shift close', stock: STOCK, wallMs: Math.round(wall), successes, perTill: tallies.map((t) => ({ ok: t.ok, noStock: t.noStock, closed: t.closed, other: t.other })), latencyMs: summary(latencies), closeMs: closeAnswers.map((x) => Math.round(x.ms)) })}`);
    expect(tallies.flatMap((t) => t.other)).toEqual([]);
    expect(successes).toBe(STOCK);
    expect(closeAnswers[0]?.ok).toBe(true);

    await oversellCheck(w, 'two tills + shift close', successes);
    const closed = await shiftCheck(c.shiftId);
    console.log(`PHARMACY-LOAD-CHECK ${JSON.stringify({ label: 'closed shift', status: closed.status, expectedMinor: String(closed.expectedMinor), cashTotal: String(closed.cashTotal), cashRows: closed.cashRows, tillSales: tallies[2]!.ok })}`);
    expect(closed.status).toBe('CLOSED');
    expect(closed.expectedMinor).toBe(closed.cashTotal);
    expect(closed.cashTotal).toBe(BigInt(tallies[2]!.ok) * PRICE);
  });

  it('two tills with four sales in flight each (eight at once) on the same stock', async () => {
    const w = await world(2);
    const latencies: number[] = [];
    const tallies = w.cashiers.map(() => ({ ok: 0, noStock: 0, closed: 0, other: [] as string[] }));
    const started = performance.now();
    await Promise.all(w.cashiers.map((x, i) => till(w, x.who, 4, STOCK + 20, latencies, tallies[i]!)));
    const wall = performance.now() - started;
    const successes = tallies.reduce((n, t) => n + t.ok, 0);
    console.log(`PHARMACY-LOAD ${JSON.stringify({ scenario: 'two tills x4 in flight', stock: STOCK, wallMs: Math.round(wall), successes, perTill: tallies.map((t) => ({ ok: t.ok, noStock: t.noStock, closed: t.closed, other: t.other })), latencyMs: summary(latencies) })}`);
    expect(tallies.flatMap((t) => t.other)).toEqual([]);
    expect(successes).toBe(STOCK);
    await oversellCheck(w, 'two tills x4 in flight', successes);
  });
});

describe('a close while the same till has sales in flight (phase 8)', () => {
  it('every sale either lands before the close and is counted in it, or is refused: expected cash equals the cash rows and the successful sales', async () => {
    const w = await world(1);
    const only = w.cashiers[0]!;
    const latencies: number[] = [];
    const tally = { ok: 0, noStock: 0, closed: 0, other: [] as string[] };
    const selling = till(w, only.who, 4, 200, latencies, tally);
    await new Promise((r) => setTimeout(r, 25));
    const t0 = performance.now();
    const closed = await act(only.who, shiftActions.close, { ...w.at, shiftId: only.shiftId, countedMinor: 0n, reason: 'load run' });
    const closeMs = performance.now() - t0;
    await selling;
    console.log(`PHARMACY-LOAD ${JSON.stringify({ scenario: 'close with 4 sales in flight', stock: STOCK, successes: tally.ok, refusedAfterClose: tally.closed, noStock: tally.noStock, other: tally.other, closeMs: Math.round(closeMs), latencyMs: summary(latencies) })}`);
    expect(closed.ok).toBe(true);
    expect(tally.other).toEqual([]);
    const check = await shiftCheck(only.shiftId);
    console.log(`PHARMACY-LOAD-CHECK ${JSON.stringify({ label: 'close with sales in flight', status: check.status, expectedMinor: String(check.expectedMinor), cashTotal: String(check.cashTotal), cashRows: check.cashRows, sales: tally.ok })}`);
    expect(check.status).toBe('CLOSED');
    expect(check.expectedMinor).toBe(check.cashTotal);
    expect(check.cashTotal).toBe(BigInt(tally.ok) * PRICE);
    await oversellCheck({ ...w }, 'close with sales in flight', tally.ok);
  });
});
