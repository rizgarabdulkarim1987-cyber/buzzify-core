import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as stockActions from '@/server/pharmacy/actions/stock';
import * as reports from '@/server/pharmacy/queries/reports';
import { NOW, prisma, resetWorld, useTestDatabase } from './fixture';
import { act, ask } from './stock-helpers';
import { at, build, dataOf, key, type Biz } from './reports-world';

/* eslint-disable @typescript-eslint/no-explicit-any -- report shapes are read off the wire and checked by value */

/**
 * The damaged report counts what LEFT the stock or went bad, never what came in (review of task 4, important 4):
 *  - DAMAGE: units into the damaged bucket.
 *  - ADJUST: units taken out (a negative adjustment) plus units moved INTO damaged by a bucket move; an "in" adjustment is not
 *    netted against them, so one found box does not hide a loss.
 *  - a movement that was reversed, and its reversal, are both left out (they cancel).
 * Values are at batch cost; a movement of a batch with no cost is counted in `noCostRows`, never valued as zero.
 *
 * World (business D, branch 1 unless said), after the common world's PB1 (200 base, 705/strip IQD), PB2@b2 (600/strip) and QB1 (100 base, no cost):
 *   damage 3 of PB2@b2 "Broken"          -> DAMAGE 3, value floor(600*3/10) = 180
 *   adjust QB1 out 4 "Miscount"          -> ADJUST 4, no cost
 *   adjust PB1 in 6 "Found"              -> not counted
 *   adjust PB1 available -> damaged 2    -> ADJUST 2 "Dropped", value floor(705*2/10) = 141
 *   adjust PB1 out 5 "Typo", reversed    -> not counted (both rows cancel)
 *   a no-cost batch with 7 units only in damaged (balance written straight, no ledger) -> valuation counts it in noCostRows
 */

let w: Biz;
beforeAll(async () => {
  useTestDatabase();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  await resetWorld();
  w = await build('D', false);
  const adj = (batchId: string, branchId: string, over: Record<string, unknown>) => act(w.owner, stockActions.adjust, { ...at(w, branchId), batchId, clientKey: key('adj'), baseQty: 1, ...over });
  dataOf(await act(w.owner, stockActions.damage, { ...at(w, w.b2), batchId: w.ids.pb2, fromBucket: 'available', baseQty: 3, reason: 'Broken' }));
  dataOf(await adj(w.ids.qb1!, w.b1, { direction: 'out', bucketFrom: 'available', baseQty: 4, reason: 'Miscount' }));
  dataOf(await adj(w.ids.pb1!, w.b1, { direction: 'in', baseQty: 6, reason: 'Found' }));
  dataOf(await adj(w.ids.pb1!, w.b1, { direction: 'move', bucketFrom: 'available', bucketTo: 'damaged', baseQty: 2, reason: 'Dropped' }));
  const typo = dataOf(await adj(w.ids.pb1!, w.b1, { direction: 'out', bucketFrom: 'available', baseQty: 5, reason: 'Typo' }));
  dataOf(await act(w.owner, stockActions.reverse, { ...at(w, w.b1), movementId: typo.id, reason: 'Wrong batch' }));
  const nc = await prisma().phBatch.create({ data: { restaurantId: w.a.id, productId: w.P.id, lot: 'NC', expiryDate: new Date('2027-06-30T00:00:00.000Z') }, select: { id: true } });
  await prisma().phStockBalance.create({ data: { restaurantId: w.a.id, branchId: w.b1, productId: w.P.id, batchId: nc.id, damaged: 7 } });
}, 120_000);
afterAll(() => {
  vi.useRealTimers();
});

/** Ledger rows take the database clock, not the faked one: the window is the Baghdad days the stored rows say, never "today". */
async function ledgerWindow() {
  const rows = await prisma().phStockMovement.findMany({ where: { restaurantId: w.a.id, type: { in: ['DAMAGE', 'ADJUST'] } }, select: { createdAt: true } });
  const day = (d: Date) => new Date(d.getTime() + 3 * 3_600_000).toISOString().slice(0, 10);
  const days = rows.map((r) => day(r.createdAt)).sort();
  return { from: days[0]!, to: days[days.length - 1]! };
}

describe('damaged report: write-offs and losses, not found stock', () => {
  it('does not net an "in" adjustment against losses; counts a bucket move into damaged; leaves out a reversed adjustment and its reversal', async () => {
    const r: any = dataOf(await ask(w.owner, reports.damaged, { ...at(w), ...(await ledgerWindow()) }));
    expect(r.movements.totals.map((t: { type: string; units: number }) => [t.type, t.units])).toEqual([['DAMAGE', 3], ['ADJUST', 6], ['SUPPLIER_RETURN', 0]]);
    expect(r.movements.reasons).toEqual([
      { type: 'ADJUST', reason: 'Miscount', units: 4 },
      { type: 'DAMAGE', reason: 'Broken', units: 3 },
      { type: 'ADJUST', reason: 'Dropped', units: 2 },
    ]);
    expect(r.movements.byBranch).toEqual([{ branchId: w.b1, type: 'ADJUST', units: 6 }, { branchId: w.b2, type: 'DAMAGE', units: 3 }]);
  });

  it('values what it can at batch cost and counts the movements of a batch with no cost instead of valuing them at zero', async () => {
    const r: any = dataOf(await ask(w.owner, reports.damaged, { ...at(w), ...(await ledgerWindow()) }));
    const byType = Object.fromEntries(r.movements.totals.map((t: { type: string }) => [t.type, t]));
    expect(byType.DAMAGE.values).toEqual([{ currency: 'IQD', valueMinor: '180' }]);
    expect(byType.DAMAGE.noCostRows).toBe(0);
    expect(byType.ADJUST.values).toEqual([{ currency: 'IQD', valueMinor: '141' }]);
    expect(byType.ADJUST.noCostRows).toBe(1);
    expect(byType.SUPPLIER_RETURN.noCostRows).toBe(0);
  });

  it('a range with nothing in it shows no write-offs and no uncounted rows', async () => {
    const r: any = dataOf(await ask(w.owner, reports.damaged, { ...at(w), from: '2026-01-01', to: '2026-01-02' }));
    expect(r.movements.totals.map((t: { units: number }) => t.units)).toEqual([0, 0, 0]);
    expect(r.movements.totals.map((t: { noCostRows: number }) => t.noCostRows)).toEqual([0, 0, 0]);
  });
});

describe('stock valuation: damaged stock with no cost is not silently left out', () => {
  it('counts a damaged-only batch with no cost in noCostRows (it has no damaged value), in the total and in its branch', async () => {
    const r: any = dataOf(await ask(w.owner, reports.stockValuationQuery, { ...at(w), groupBy: 'branch' }));
    // QB1@b1 (units, no cost) and the NC batch (damaged only, no cost).
    expect(r.totals.noCostRows).toBe(2);
    expect(r.totals.valuationComplete).toBe(false);
    const b1 = r.byBranch.find((b: { branchId: string }) => b.branchId === w.b1);
    expect(b1.noCostRows).toBe(2);
    expect(b1.valuationComplete).toBe(false);
    const b2 = r.byBranch.find((b: { branchId: string }) => b.branchId === w.b2);
    expect(b2.noCostRows).toBe(0);
    expect(b2.valuationComplete).toBe(true);
  });
});
