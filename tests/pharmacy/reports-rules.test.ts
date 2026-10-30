import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as returnActions from '@/server/pharmacy/actions/returns';
import * as transferActions from '@/server/pharmacy/actions/transfers';
import * as expiryService from '@/server/pharmacy/expiry';
import * as reports from '@/server/pharmacy/queries/reports';
import { windowOf } from '@/server/pharmacy/reports-common';
import { StudioError } from '@/server/studio/framework/result';
import { NOW, person, prisma, resetWorld, useTestDatabase, type Person } from './fixture';
import { act, ask, codeOf } from './stock-helpers';
import { at, batch, build, card, cash, dataOf, instants, key, marginTruth, price, sell, shift, type Biz } from './reports-world';

/* eslint-disable @typescript-eslint/no-explicit-any, no-restricted-properties -- report shapes are read off the wire; the independent SQL is the test's own, bound to the business */

/**
 * Report rules that the common hand world cannot show (review of task 4). One business ("R"), everything on Baghdad day
 * 2026-10-27 (the faked clock), built through the real services:
 *
 *   s0   build()   cashier1 b1  1 tablet P                100, cost floor(705*1/10) = 70
 *   X1   owner b1  1000 tablets P, discount 5003 of 100000 (5.003 %, over the 5 % limit though the rounded 500 bp is not)
 *                  stock: PB1 (199 left) + BIGC (801): costs floor(705*199/10) + floor(705*801/10) = 14029 + 56470 = 70499 (one floor
 *                  over the line would be 70500: the rule floors per allocation)
 *   X2   owner b1  1000 tablets P, discount 5000 of 100000 (exactly 5 %, not over)
 *   X3   cashier1 b1  120 tablets Q = 30000: 100 from QB1 (NO cost) + 20 from QBC (costed): one line, one allocation without cost
 *   Y1   cashier1 b1  1 strip P with a 250 rounding step: 900 -> 1000 (rounding +100)
 *   Y2   the same, then returned in full by the manager: the refund is 1000, the line refund 900
 *   Pn   eleven more cashiers at b1, 1 strip P each, 45 off (5 %): 855
 *   U1   usd1 b1  1 tablet P in USD with 4 off: a USD sale of an IQD-cost batch (mixed)
 *   B1   cashier2 b2  1 strip Q = 2000 IQD: QB2 costs in USD (mixed)
 *   B2   cashier2 b2  1 strip P = 900 (PB2 600/strip, costed), returned in part by manager2 (3 base units)
 */

let w: Biz;
let manager2: Person;
const D1 = { from: '2026-10-27', to: '2026-10-27' };
const ids: Record<string, string> = {};

beforeAll(async () => {
  useTestDatabase();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  await resetWorld();
  w = await build('R', false);
  const tab = (p: Biz['P'], qty: number, extra: Record<string, unknown> = {}) => ({ productId: p.id, unitId: p.tablet, qty, ...extra });
  const str = (p: Biz['P'], qty: number, extra: Record<string, unknown> = {}) => ({ productId: p.id, unitId: p.strip, qty, ...extra });
  await batch(w.a.id, w.b1, w.P.id, { lot: 'BIGC', expiry: '2027-07-31', available: 5000, cost: { minor: 705n, currency: 'IQD', unitId: w.P.strip } });
  await batch(w.a.id, w.b1, w.Q.id, { lot: 'QBC', expiry: '2027-09-30', available: 50, cost: { minor: 300n, currency: 'IQD', unitId: w.Q.strip } });
  manager2 = await person('manager2R', { staff: [w.a.id, 'BRANCH_MANAGER', [w.b2]] });
  await shift(w.a.id, w.b2, manager2);

  ids.x1 = (await sell(w, w.owner, w.b1, 'IQD', [tab(w.P, 1000, { discount: { kind: 'amount', value: 5003n, reason: 'Clearance' } })], [cash(94_997n)])).id;
  ids.x2 = (await sell(w, w.owner, w.b1, 'IQD', [tab(w.P, 1000, { discount: { kind: 'amount', value: 5000n, reason: 'Clearance' } })], [cash(95_000n)])).id;
  ids.x3 = (await sell(w, w.cashier1, w.b1, 'IQD', [tab(w.Q, 120)], [cash(30_000n)])).id;

  await prisma().phSettings.update({ where: { restaurantId: w.a.id }, data: { roundingStepMinor: 250n } });
  await sell(w, w.cashier1, w.b1, 'IQD', [str(w.P, 1)], [cash(1000n)]);
  const y2 = await sell(w, w.cashier1, w.b1, 'IQD', [str(w.P, 1)], [cash(1000n)]);
  dataOf(await act(w.manager1, returnActions.create, { ...at(w, w.b1), saleId: y2.id, lines: [{ saleLineId: y2.lineId, baseQty: 10 }], reason: 'Wrong box', refundMethod: 'CASH', clientKey: key('ret') }));
  await prisma().phSettings.update({ where: { restaurantId: w.a.id }, data: { roundingStepMinor: 0n } });

  for (let n = 0; n < 11; n += 1) {
    const who = await person(`promo${n}R`, { staff: [w.a.id, 'CASHIER', [w.b1]] });
    await shift(w.a.id, w.b1, who);
    await sell(w, who, w.b1, 'IQD', [str(w.P, 1, { discount: { kind: 'amount', value: 45n, reason: 'Promo' } })], [cash(855n)]);
  }
  await sell(w, w.usd1, w.b1, 'USD', [tab(w.P, 1, { discount: { kind: 'amount', value: 4n, reason: 'Promo' } })], [card(96n)]);
  await sell(w, w.cashier2, w.b2, 'IQD', [str(w.Q, 1)], [cash(2000n)]);
  const b2 = await sell(w, w.cashier2, w.b2, 'IQD', [str(w.P, 1)], [cash(900n)]);
  dataOf(await act(manager2, returnActions.create, { ...at(w, w.b2), saleId: b2.id, lines: [{ saleLineId: b2.lineId, baseQty: 3 }], reason: 'Too many', refundMethod: 'CASH', clientKey: key('ret') }));
  void price;
}, 300_000);
afterAll(() => {
  vi.useRealTimers();
});

const D = (over: Record<string, unknown> = {}) => ({ ...at(w), ...D1, ...over });

describe('margin: the cost rule, line by line, against a plain-code computation', () => {
  it('floors the cost per allocation, not per line (a line over two batches costs 70499, not 70500)', async () => {
    const allocations = await prisma().phSaleLineAllocation.findMany({ where: { saleLine: { saleId: ids.x1 } }, select: { costSnapshotMinor: true, baseQty: true } });
    expect(allocations.map((a) => [a.baseQty, a.costSnapshotMinor])).toEqual(expect.arrayContaining([[199, 14029n], [801, 56470n]]));
    expect(allocations.reduce((s, a) => s + a.costSnapshotMinor!, 0n)).toBe(70_499n);
  });

  it('equals the independent computation: totals, branches, what is left out, and how many allocations are counted', async () => {
    const truth = await marginTruth(w.a.id, [w.b1, w.b2], ...(Object.values(instants(D1.from, D1.to)) as [Date, Date]));
    const r = dataOf(await ask(w.owner, reports.margin, D({ groupBy: 'branch' })));
    for (const t of r.totals) {
      expect([t.currency, BigInt(t.netMinor), BigInt(t.costMinor)], t.currency).toEqual([t.currency, truth.totals.get(t.currency)!.net, truth.totals.get(t.currency)!.cost]);
    }
    expect(r.totals.map((t: { currency: string }) => t.currency)).toEqual([...truth.totals.keys()].sort());
    for (const [k, e] of truth.byBranch) {
      const b = r.byBranch.find((x: any) => `${x.branchId}|${x.currency}` === k);
      expect([BigInt(b.netMinor), BigInt(b.costMinor)], k).toEqual([e.net, e.cost]);
    }
    // A branch and currency whose every line was left out still has a row, with no money in it.
    for (const b of r.byBranch) if (!truth.byBranch.has(`${b.branchId}|${b.currency}`)) expect([b.netMinor, b.costMinor, b.marginBp]).toEqual(['0', '0', null]);
    expect(Object.fromEntries(r.excluded.map((e: { currency: string; netMinor: string }) => [e.currency, BigInt(e.netMinor)]))).toEqual(Object.fromEntries(truth.excluded));
    expect([r.incompleteCostRows, r.mixedCurrencyRows]).toEqual([truth.nulls, truth.mixed]);
  });

  it('leaves out the whole line that is split across a costed and an uncosted batch, and counts the uncosted allocation once', async () => {
    const r = dataOf(await ask(w.owner, reports.margin, D({ groupBy: 'day' })));
    // X3 is the only line with a missing cost; the sales of B1 and U1 are in other currencies than their batches.
    expect(r.incompleteCostRows).toBe(1);
    expect(r.mixedCurrencyRows).toBe(2);
    const left = Object.fromEntries(r.excluded.map((e: { currency: string; netMinor: string }) => [e.currency, e.netMinor]));
    expect(BigInt(left.IQD)).toBe(30_000n + 2000n); // X3, and B1 (an IQD sale of a USD-cost batch)
    expect(left.USD).toBe('96');
  });

  it('counts the left-out allocations per branch, and the branches add up to the report', async () => {
    const r = dataOf(await ask(w.owner, reports.margin, D({ groupBy: 'branch' })));
    const byBranch: Record<string, [number, number]> = {};
    for (const b of r.byBranch) {
      const row = (byBranch[b.branchId] ??= [0, 0]);
      row[0] += b.incompleteCostRows;
      row[1] += b.mixedCurrencyRows;
    }
    // b1: X3's allocation without a cost, and the USD sale of an IQD-cost batch; b2: the IQD sale of a USD-cost batch.
    expect(byBranch[w.b1]).toEqual([1, 1]);
    expect(byBranch[w.b2]).toEqual([0, 1]);
    // The same counts as the plain-code computation, and the branches add up to the report.
    const truth = await marginTruth(w.a.id, [w.b1, w.b2], ...(Object.values(instants(D1.from, D1.to)) as [Date, Date]));
    expect([truth.nullsByBranch.get(w.b1) ?? 0, truth.mixedByBranch.get(w.b1) ?? 0]).toEqual(byBranch[w.b1]);
    expect([truth.nullsByBranch.get(w.b2) ?? 0, truth.mixedByBranch.get(w.b2) ?? 0]).toEqual(byBranch[w.b2]);
    const sum = (i: 0 | 1) => Object.values(byBranch).reduce((s, v) => s + v[i], 0);
    expect([sum(0), sum(1)]).toEqual([r.incompleteCostRows, r.mixedCurrencyRows]);
  });
});

describe('sales and margin: the invoice rounding', () => {
  it('is a column of the sale totals, stays out of the product rows, and the final return refunds it (the line refund does not)', async () => {
    const totals = dataOf(await ask(w.owner, reports.sales, D({ currency: 'IQD' }))).totals[0];
    const [sums] = await prisma().$queryRaw<Array<{ rounding: bigint; sales: bigint }>>`
      SELECT COALESCE(SUM("roundingMinor"), 0)::bigint AS rounding, COALESCE(SUM("totalMinor"), 0)::bigint AS sales FROM "PhSale"
      WHERE "restaurantId" = ${w.a.id} AND "currency" = 'IQD' AND "status" IN ('COMPLETED', 'RETURNED_PARTIAL', 'RETURNED_FULL')`;
    expect(totals.roundingMinor).toBe('200');
    expect(BigInt(totals.roundingMinor)).toBe(sums!.rounding);
    expect(BigInt(totals.salesMinor)).toBe(sums!.sales);

    const products = dataOf(await ask(w.owner, reports.sales, D({ currency: 'IQD', groupBy: 'product' }))).rows;
    for (const row of products) expect(row).not.toHaveProperty('roundingMinor');
    // Lines add up to the sales less the rounding: the rounding belongs to no product.
    const lineSales = products.reduce((s: bigint, r: { salesMinor: string }) => s + BigInt(r.salesMinor), 0n);
    expect(lineSales).toBe(sums!.sales - sums!.rounding);
    // Y2: the sale-level refund is 1000 (rounding included), its line refund 900; B2's partial return is the same on both levels.
    const [refunds] = await prisma().$queryRaw<Array<{ sale: bigint; lines: bigint }>>`
      SELECT (SELECT SUM("refundMinor") FROM "PhReturn" WHERE "restaurantId" = ${w.a.id})::bigint AS sale,
             (SELECT SUM("refundMinor") FROM "PhReturnLine" WHERE "restaurantId" = ${w.a.id})::bigint AS lines`;
    expect(sums!.rounding).toBe(200n);
    expect(refunds!.sale! - refunds!.lines!).toBe(100n);
    expect(BigInt(totals.refundsMinor)).toBe(refunds!.sale);
    expect(products.reduce((s: bigint, r: { refundsMinor: string }) => s + BigInt(r.refundsMinor), 0n)).toBe(refunds!.lines);
  });
});

describe('discounts: top sellers per currency, and the exact over-limit rule', () => {
  it('ranks the top ten sellers inside each currency: a USD seller is not crowded out by twelve IQD ones', async () => {
    const r = dataOf(await ask(w.owner, reports.discounts, D()));
    const iqd = r.topUsers.filter((u: { currency: string }) => u.currency === 'IQD');
    const usd = r.topUsers.filter((u: { currency: string }) => u.currency === 'USD');
    expect(iqd).toHaveLength(10);
    expect(usd.map((u: { userId: string; discountMinor: string }) => [u.userId, u.discountMinor])).toEqual([[w.usd1.userId, '4']]);
    expect(iqd[0]).toMatchObject({ userId: w.owner.userId, discountMinor: '10003' });
    // Ten IQD sellers of 45 follow in a stable order (user id).
    const rest = iqd.slice(1).map((u: { discountMinor: string }) => u.discountMinor);
    expect(rest).toEqual(['45', '45', '45', '45', '45', '45', '45', '45', '45']);
  });

  it('judges the limit on exact money, not on the rounded basis points: 5.003 % is over 5 %, exactly 5 % is not', async () => {
    const rows = dataOf(await ask(w.owner, reports.discounts, D({ currency: 'IQD', take: 500 }))).rows as Array<{ saleId: string; discountBp: number; overLimit: boolean; discountMinor: string }>;
    const x1 = rows.find((x) => x.saleId === ids.x1)!;
    const x2 = rows.find((x) => x.saleId === ids.x2)!;
    expect([x1.discountBp, x1.overLimit]).toEqual([500, true]);
    expect([x2.discountBp, x2.overLimit]).toEqual([500, false]);
    // The eleven promos are exactly 5 % (45 of 900).
    expect(rows.filter((x) => x.discountMinor === '45').every((x) => x.overLimit === false)).toBe(true);
    expect(rows.filter((x) => x.overLimit).map((x) => x.saleId)).toEqual([ids.x1]);
  });
});

describe('consolidation: totals against SQL written differently, not against their own branches', () => {
  it('returns: count and refunds per currency and per branch equal plain aggregates of PhReturn', async () => {
    const r = dataOf(await ask(w.owner, reports.returns, D()));
    const per = await prisma().$queryRaw<Array<{ branchId: string; cur: string; n: number; refund: bigint }>>`
      SELECT "branchId", "currency"::text AS cur, COUNT(*)::int AS n, SUM("refundMinor")::bigint AS refund FROM "PhReturn" WHERE "restaurantId" = ${w.a.id} GROUP BY 1, 2 ORDER BY 1, 2`;
    const tot = await prisma().$queryRaw<Array<{ cur: string; n: number; refund: bigint }>>`
      SELECT "currency"::text AS cur, COUNT(*)::int AS n, SUM("refundMinor")::bigint AS refund FROM "PhReturn" WHERE "restaurantId" = ${w.a.id} GROUP BY 1 ORDER BY 1`;
    expect(r.totals.map((t: any) => [t.currency, t.count, BigInt(t.refundMinor)])).toEqual(tot.map((t) => [t.cur, t.n, t.refund]));
    expect(r.byBranch.map((b: any) => [b.branchId, b.currency, b.count, BigInt(b.refundMinor)]).sort()).toEqual(per.map((t) => [t.branchId, t.cur, t.n, t.refund]).sort());
    expect(r.byBranch.map((b: any) => b.branchId).sort()).toEqual([w.b1, w.b2].sort());
  });

  it('discounts: sales, discounted sales, gross and discount per currency and per branch equal plain aggregates of PhSale', async () => {
    const r = dataOf(await ask(w.owner, reports.discounts, D()));
    const per = await prisma().$queryRaw<Array<{ branchId: string; cur: string; n: number; dn: number; gross: bigint; disc: bigint }>>`
      SELECT "branchId", "currency"::text AS cur, COUNT(*)::int AS n, COUNT(*) FILTER (WHERE "discountMinor" > 0)::int AS dn, SUM("subtotalMinor")::bigint AS gross, SUM("discountMinor")::bigint AS disc
      FROM "PhSale" WHERE "restaurantId" = ${w.a.id} AND "status" IN ('COMPLETED', 'RETURNED_PARTIAL', 'RETURNED_FULL') GROUP BY 1, 2 ORDER BY 1, 2`;
    expect(r.byBranch.map((b: any) => [b.branchId, b.currency, b.salesCount, b.discountedCount, BigInt(b.grossMinor), BigInt(b.discountMinor)]).sort()).toEqual(
      per.map((t) => [t.branchId, t.cur, t.n, t.dn, t.gross, t.disc]).sort(),
    );
    const sumOf = (cur: string) => per.filter((t) => t.cur === cur).reduce((s, t) => s + t.disc, 0n);
    for (const t of r.totals) expect(BigInt(t.discountMinor), t.currency).toBe(sumOf(t.currency));
  });
});

describe('expiry: a chain too large for the phase 2 list still answers', () => {
  it('keeps the band counts and says the list is truncated when the list service refuses (too many batches)', async () => {
    const spy = vi.spyOn(expiryService, 'listExpiry').mockRejectedValueOnce(new StudioError('CONFLICT', 'Too many batches match: choose a branch or a shorter horizon', { phCode: 'TOO_MANY' }));
    try {
      const r = dataOf(await ask(w.owner, reports.expiry, { ...at(w) }));
      expect(spy).toHaveBeenCalledTimes(1);
      expect(r.listTruncated).toBe(true);
      expect(r.items).toEqual([]);
      expect(r.nextCursor).toBeNull();
      expect(r.totals.map((t: { band: string }) => t.band)).toEqual(['expired', 'd30', 'd60', 'd90']);
      expect(r.listTotals).toEqual({ expired: 0, d30: 0, d60: 0, d90: 0, d180: 0 });
    } finally {
      spy.mockRestore();
    }
    const normal = dataOf(await ask(w.owner, reports.expiry, { ...at(w) }));
    expect(normal.listTruncated).toBe(false);
  });

  it('any other failure of the list is not hidden', async () => {
    const spy = vi.spyOn(expiryService, 'listExpiry').mockRejectedValueOnce(new StudioError('CONFLICT', 'Something else', { phCode: 'OTHER' }));
    try {
      expect(codeOf(await ask(w.owner, reports.expiry, { ...at(w) }))).toBe('CONFLICT');
    } finally {
      spy.mockRestore();
    }
  });
});

describe('transfers between two branches: counted once in the all-branches report, once in each narrowed one', () => {
  it('the all-branches total is the figure to use: summing the per-branch calls counts a transfer between them twice', async () => {
    dataOf(await act(w.owner, transferActions.request, { restaurantId: w.a.id, clientKey: key('req'), fromBranchId: w.b1, toBranchId: w.b2, lines: [{ productId: w.P.id, qty: 5 }] }));
    const all = dataOf(await ask(w.owner, reports.transfers, D()));
    const one = dataOf(await ask(w.owner, reports.transfers, D({ branchId: w.b1 })));
    const two = dataOf(await ask(w.owner, reports.transfers, D({ branchId: w.b2 })));
    expect(all.total).toBe(1);
    expect([one.total, two.total]).toEqual([1, 1]);
    expect(one.total + two.total).toBe(all.total + 1);
    // byBranch of the ONE all-branches call is by sending branch and does add up to the total.
    expect(all.byBranch).toEqual([{ branchId: w.b1, count: 1 }]);
    expect(all.byBranch.reduce((s: number, b: { count: number }) => s + b.count, 0)).toBe(all.total);
    expect(all.scope).toBe('transfers-touching-the-branches-shown');
  });
});

describe('small contracts of the inputs and markers', () => {
  it('a page marker belongs to the grouping it was made for', async () => {
    const first = dataOf(await ask(w.owner, reports.sales, D({ groupBy: 'user', take: 1 })));
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = await ask(w.owner, reports.sales, D({ groupBy: 'user', take: 1, cursor: first.nextCursor }));
    expect(codeOf(second)).toBe('OK');
    const other = await ask(w.owner, reports.sales, D({ groupBy: 'product', take: 1, cursor: first.nextCursor }));
    expect(codeOf(other)).toBe('INVALID');
    expect(!other.ok && other.error.fields).toMatchObject({ cursor: 'The page marker is not valid' });
  });

  it('a bad end date is reported on the end date', () => {
    try {
      windowOf('2026-10-27', '2026-13-45');
      expect.unreachable();
    } catch (error) {
      expect((error as StudioError).fields).toHaveProperty('to');
      expect((error as StudioError).fields).not.toHaveProperty('from');
    }
    try {
      windowOf('2026-10-28', '2026-10-27');
      expect.unreachable();
    } catch (error) {
      expect((error as StudioError).fields).toHaveProperty('from');
    }
  });

  it('page sizes answer in words the person can read, not in the library default', async () => {
    const low = await ask(w.owner, reports.lowStock, { ...at(w), take: 0 });
    expect(codeOf(low)).toBe('INVALID');
    expect(!low.ok && low.error.fields?.take).toBe('Use 1 or more');
    const big = await ask(w.owner, reports.expiry, { ...at(w), take: 1000 });
    expect(!big.ok && big.error.fields?.take).toBe('Enter a smaller number');
  });
});
