import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as reports from '@/server/pharmacy/queries/reports';
import { NOW, prisma, resetWorld, useTestDatabase, type Person } from './fixture';
import { ask } from './stock-helpers';
import { at, batch, build, dataOf, instants, marginTruth, type Biz } from './reports-world';

/* eslint-disable @typescript-eslint/no-explicit-any, no-restricted-properties -- report shapes are read off the wire; the independent SQL is the test's own, bound to the business */

/**
 * Branch scope that can FAIL (review of task 4, important 1). A person limited to one branch gets that branch's figures; each
 * figure here is compared with an aggregate written in the test with the branch id in its WHERE, not with the owner's answer
 * narrowed by the same scope code. If a report's SQL ignored the branch list, the person's answer would carry the other branch's
 * money and ids, and the comparison (and the "no trace of the other branch" check) would fail.
 */

let w: Biz;
const PERIOD = { from: '2026-10-27', to: '2026-10-28' };
const def = (name: string) => (reports as unknown as Record<string, Parameters<typeof ask>[1]>)[name]!;
const SOLD = ['COMPLETED', 'RETURNED_PARTIAL', 'RETURNED_FULL'];

beforeAll(async () => {
  useTestDatabase();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  await resetWorld();
  w = await build('A', true);
  // Stock in reach of the expiry report in both branches (the common world's batches expire in 2027-06 and later).
  await batch(w.a.id, w.b1, w.P.id, { lot: 'E1', expiry: '2026-10-01', available: 10, cost: { minor: 200n, currency: 'IQD', unitId: w.P.strip } });
  await batch(w.a.id, w.b2, w.P.id, { lot: 'E2', expiry: '2026-11-10', available: 20, cost: { minor: 300n, currency: 'IQD', unitId: w.P.strip } });
  await batch(w.a.id, w.b1, w.Q.id, { lot: 'E3', expiry: '2026-12-11', available: 8 });
  await batch(w.a.id, w.b2, w.Q.id, { lot: 'E4', expiry: '2027-01-10', available: 5, cost: { minor: 400n, currency: 'IQD', unitId: w.Q.strip } });
  // Branch 2 stays short of Q after E4 (96 + 5 against 100 would not be): both branches have something on the low-stock list.
  await prisma().phProductBranch.updateMany({ where: { restaurantId: w.a.id, branchId: w.b2, productId: w.Q.id }, data: { minQty: 200 } });
}, 240_000);
afterAll(() => {
  vi.useRealTimers();
});

const sides = (): Array<{ label: string; who: Person; branch: string; other: string }> => [
  { label: 'branch 1', who: w.manager1, branch: w.b1, other: w.b2 },
  { label: 'branch 2', who: w.usd2, branch: w.b2, other: w.b1 },
];
const { start, endExclusive } = instants(PERIOD.from, PERIOD.to);

describe('a branch-limited person gets the figures of their branch, worked out apart', () => {
  it.each([0, 1])('sales: count, sales and refunds per currency (side %i)', async (i) => {
    const s = sides()[i]!;
    const r = dataOf(await ask(s.who, def('sales'), { ...at(w), ...PERIOD }));
    const sold = await prisma().$queryRaw<Array<{ cur: string; n: number; sales: bigint }>>`
      SELECT "currency"::text AS cur, COUNT(*)::int AS n, SUM("totalMinor")::bigint AS sales FROM "PhSale"
      WHERE "restaurantId" = ${w.a.id} AND "branchId" = ${s.branch} AND "status"::text = ANY(${SOLD}::text[]) AND "completedAt" >= ${start} AND "completedAt" < ${endExclusive} GROUP BY 1 ORDER BY 1`;
    const back = await prisma().$queryRaw<Array<{ cur: string; refunds: bigint }>>`
      SELECT "currency"::text AS cur, SUM("refundMinor")::bigint AS refunds FROM "PhReturn"
      WHERE "restaurantId" = ${w.a.id} AND "branchId" = ${s.branch} AND "createdAt" >= ${start} AND "createdAt" < ${endExclusive} GROUP BY 1 ORDER BY 1`;
    expect(r.totals.map((t: any) => [t.currency, t.count, BigInt(t.salesMinor), BigInt(t.refundsMinor)])).toEqual(
      sold.map((x) => [x.cur, x.n, x.sales, back.find((b) => b.cur === x.cur)?.refunds ?? 0n]),
    );
    expect(r.byBranch.every((b: any) => b.branchId === s.branch)).toBe(true);
  });

  it.each([0, 1])('returns and discounts (side %i)', async (i) => {
    const s = sides()[i]!;
    const ret = dataOf(await ask(s.who, def('returns'), { ...at(w), ...PERIOD }));
    const rs = await prisma().$queryRaw<Array<{ cur: string; n: number; refund: bigint }>>`
      SELECT "currency"::text AS cur, COUNT(*)::int AS n, SUM("refundMinor")::bigint AS refund FROM "PhReturn"
      WHERE "restaurantId" = ${w.a.id} AND "branchId" = ${s.branch} AND "createdAt" >= ${start} AND "createdAt" < ${endExclusive} GROUP BY 1 ORDER BY 1`;
    expect(ret.totals.map((t: any) => [t.currency, t.count, BigInt(t.refundMinor)])).toEqual(rs.map((x) => [x.cur, x.n, x.refund]));
    const dis = dataOf(await ask(s.who, def('discounts'), { ...at(w), ...PERIOD }));
    const ds = await prisma().$queryRaw<Array<{ cur: string; n: number; disc: bigint }>>`
      SELECT "currency"::text AS cur, COUNT(*)::int AS n, SUM("discountMinor")::bigint AS disc FROM "PhSale"
      WHERE "restaurantId" = ${w.a.id} AND "branchId" = ${s.branch} AND "status"::text = ANY(${SOLD}::text[]) AND "completedAt" >= ${start} AND "completedAt" < ${endExclusive} GROUP BY 1 ORDER BY 1`;
    expect(dis.totals.map((t: any) => [t.currency, t.salesCount, BigInt(t.discountMinor)])).toEqual(ds.map((x) => [x.cur, x.n, x.disc]));
  });

  it.each([0, 1])('margin: equals the plain-code computation over the branch (side %i)', async (i) => {
    const s = sides()[i]!;
    const r = dataOf(await ask(s.who, def('margin'), { ...at(w), ...PERIOD }));
    const truth = await marginTruth(w.a.id, [s.branch], start, endExclusive);
    expect(r.totals.map((t: any) => [t.currency, BigInt(t.netMinor), BigInt(t.costMinor)])).toEqual(
      [...truth.totals.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([cur, v]) => [cur, v.net, v.cost]),
    );
    expect([r.incompleteCostRows, r.mixedCurrencyRows]).toEqual([truth.nullsByBranch.get(s.branch) ?? 0, truth.mixedByBranch.get(s.branch) ?? 0]);
  });

  it.each([0, 1])('stock valuation: the buckets and the value are those of the balances of the branch (side %i)', async (i) => {
    const s = sides()[i]!;
    const r = dataOf(await ask(s.who, def('stockValuationQuery'), { ...at(w) }));
    const [sum] = await prisma().$queryRaw<Array<{ a: bigint; q: bigint; d: bigint }>>`
      SELECT COALESCE(SUM("available"), 0)::bigint AS a, COALESCE(SUM("quarantine"), 0)::bigint AS q, COALESCE(SUM("damaged"), 0)::bigint AS d FROM "PhStockBalance"
      WHERE "restaurantId" = ${w.a.id} AND "branchId" = ${s.branch}`;
    expect([r.totals.available, r.totals.quarantine, r.totals.damaged].map(BigInt)).toEqual([sum!.a, sum!.q, sum!.d]);
    const value = await prisma().$queryRaw<Array<{ cur: string; value: bigint }>>`
      SELECT b."costCurrency"::text AS cur, SUM(floor(b."unitCostMinor"::numeric * (sb."available" + sb."reserved" + sb."quarantine") / u."baseQty"))::bigint AS value
      FROM "PhStockBalance" sb JOIN "PhBatch" b ON b."id" = sb."batchId" JOIN "PhProductUnit" u ON u."id" = b."costUnitId"
      WHERE sb."restaurantId" = ${w.a.id} AND sb."branchId" = ${s.branch} AND b."unitCostMinor" IS NOT NULL GROUP BY 1 ORDER BY 1`;
    expect(r.totals.values.map((v: any) => [v.currency, BigInt(v.valueMinor)])).toEqual(value.map((v) => [v.cur, v.value]));
  });

  it.each([0, 1])('expiry: the units in reach are those of the branch (side %i)', async (i) => {
    const s = sides()[i]!;
    const r = dataOf(await ask(s.who, def('expiry'), { ...at(w) }));
    const [sum] = await prisma().$queryRaw<Array<{ units: bigint; rows: bigint }>>`
      SELECT COALESCE(SUM(sb."available" + sb."reserved" + sb."quarantine"), 0)::bigint AS units, COUNT(*)::bigint AS rows FROM "PhStockBalance" sb JOIN "PhBatch" b ON b."id" = sb."batchId"
      WHERE sb."restaurantId" = ${w.a.id} AND sb."branchId" = ${s.branch} AND (sb."available" + sb."reserved" + sb."quarantine") > 0 AND b."expiryDate" <= DATE '2027-01-25'`;
    expect(r.totals.reduce((n: number, t: any) => n + t.units, 0)).toBe(Number(sum!.units));
    expect(r.totals.reduce((n: number, t: any) => n + t.rows, 0)).toBe(Number(sum!.rows));
    expect(r.items.every((x: any) => x.branchId === s.branch)).toBe(true);
  });

  it.each([0, 1])('damaged: the current buckets and the write-offs are those of the branch (side %i)', async (i) => {
    const s = sides()[i]!;
    const moves = await prisma().phStockMovement.findMany({ where: { restaurantId: w.a.id }, select: { createdAt: true } });
    const days = moves.map((m) => new Date(m.createdAt.getTime() + 3 * 3_600_000).toISOString().slice(0, 10)).sort();
    const r = dataOf(await ask(s.who, def('damaged'), { ...at(w), from: days[0]!, to: days[days.length - 1]! }));
    const [cur] = await prisma().$queryRaw<Array<{ d: bigint; q: bigint }>>`
      SELECT COALESCE(SUM("damaged"), 0)::bigint AS d, COALESCE(SUM("quarantine"), 0)::bigint AS q FROM "PhStockBalance" WHERE "restaurantId" = ${w.a.id} AND "branchId" = ${s.branch}`;
    expect([r.current.totals.damaged, r.current.totals.quarantine].map(BigInt)).toEqual([cur!.d, cur!.q]);
    const out = await prisma().$queryRaw<Array<{ type: string; units: bigint }>>`
      SELECT "type"::text AS type, SUM(GREATEST(-("availableDelta" + "reservedDelta" + "quarantineDelta" + "damagedDelta"), 0) + CASE WHEN "type"::text = 'DAMAGE' THEN "damagedDelta" ELSE 0 END)::bigint AS units
      FROM "PhStockMovement" WHERE "restaurantId" = ${w.a.id} AND "branchId" = ${s.branch} AND "type"::text IN ('DAMAGE', 'ADJUST') AND "reversesId" IS NULL GROUP BY 1`;
    const got = Object.fromEntries(r.movements.totals.map((t: any) => [t.type, t.units]));
    for (const row of out) expect(got[row.type], row.type).toBe(Number(row.units));
  });

  it.each([0, 1])('transfers: the ones that touch the branch (side %i)', async (i) => {
    const s = sides()[i]!;
    const r = dataOf(await ask(s.who, def('transfers'), { ...at(w), ...PERIOD }));
    const [n] = await prisma().$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(*)::int AS n FROM "PhTransfer" WHERE "restaurantId" = ${w.a.id} AND ("fromBranchId" = ${s.branch} OR "toBranchId" = ${s.branch}) AND "requestedAt" >= ${start} AND "requestedAt" < ${endExclusive}`;
    expect(r.total).toBe(n!.n);
  });

  it.each([0, 1])('low stock: the products below their minimum in the branch (side %i)', async (i) => {
    const s = sides()[i]!;
    const r = dataOf(await ask(s.who, def('lowStock'), { ...at(w) }));
    const [n] = await prisma().$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(*)::int AS n FROM "PhProductBranch" pb WHERE pb."restaurantId" = ${w.a.id} AND pb."branchId" = ${s.branch} AND pb."minQty" > 0
        AND COALESCE((SELECT SUM(sb."available") FROM "PhStockBalance" sb JOIN "PhBatch" b ON b."id" = sb."batchId"
                      WHERE sb."restaurantId" = pb."restaurantId" AND sb."branchId" = pb."branchId" AND sb."productId" = pb."productId" AND b."status" = 'ACTIVE' AND b."expiryDate" >= DATE '2026-10-27'), 0) < pb."minQty"`;
    expect(r.total).toBe(n!.n);
    expect(r.rows.every((x: any) => x.branchId === s.branch)).toBe(true);
  });
});

describe('and it is not the whole business', () => {
  const NAMES: Array<[string, Record<string, unknown>]> = [
    ['sales', { ...PERIOD, groupBy: 'branch' }],
    // (The returns of the common world are all in branch 1, so they cannot tell the two apart; the returns case is the side-by-side SQL above.)
    ['discounts', { ...PERIOD }],
    ['margin', { ...PERIOD, groupBy: 'branch' }],
    ['stockValuationQuery', {}],
    ['expiry', {}],
    ['damaged', { ...PERIOD }],
    ['lowStock', {}],
  ];

  it('for every report the limited answer differs from the owner\'s, and carries no trace of the other branch', async () => {
    const s = sides()[0]!;
    for (const [name, input] of NAMES) {
      // A transfer names both of its ends, so the sections about transfers (goods on the road, losses by route) may show the other end of the person's own transfers.
      const bothEnds = (r: any) => {
        const rest = Object.fromEntries(Object.entries(r).filter(([key]) => key !== 'inTransit' && key !== 'transfers'));
        return rest;
      };
      const mine = bothEnds(dataOf(await ask(s.who, def(name), { ...at(w), ...input })));
      const all = bothEnds(dataOf(await ask(w.owner, def(name), { ...at(w), ...input })));
      expect(JSON.stringify(mine), `${name} differs from the whole business`).not.toBe(JSON.stringify(all));
      expect(JSON.stringify(all), `${name} of the owner shows the other branch (the check looks at something)`).toContain(s.other);
      expect(JSON.stringify(mine), `${name} shows the other branch`).not.toContain(s.other);
    }
  });
});
