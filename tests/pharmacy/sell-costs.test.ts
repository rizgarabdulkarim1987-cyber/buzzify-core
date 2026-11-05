import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as sellQueries from '@/server/pharmacy/queries/sell';
import { creditWorld, type CreditWorld } from './credit-world';
import { NOW, resetWorld, useTestDatabase } from './fixture';
import { ask, codeOf, dataOf, makeBatch, makeProduct } from './stock-helpers';

/**
 * The cashier's cost and profit per sale line (plan Task 7b, `ph.sell.costs`): enforced on the server. A role with `cost.view`
 * gets the cost of each line from the batches the sale would take (nearest expiry first, as the sale does); the profit (the
 * line total after its discount minus that cost, negative when it is) only with `profit.view` too. Anyone else at the till gets
 * an answer with no cost or profit in it at all.
 */

interface Costs {
  lines: { key: string; costMinor: string | null; profitMinor?: string | null }[];
}

let w: CreditWorld;
const at = (branchId = w.b1) => ({ restaurantId: w.a.id, branchId });
const plus = (days: number) => new Date(NOW.getTime() + days * 86_400_000).toISOString().slice(0, 10);
type Line = { key: string; productId: string; unitId: string; qty: number; unitPriceMinor: string; discountMinor?: string; batchId?: string };
const costs = async (lines: Line[], who = w.owner, over: Record<string, unknown> = {}) => dataOf(await ask(who, sellQueries.costs, { ...at(), currency: 'IQD', lines, ...over })) as Costs;

/** A product with two costed batches in branch 1: SOON (3 tablets at 50 a tablet) then LATE (10 tablets at 80 a tablet). */
async function costed() {
  const p = await makeProduct(w.a.id, 'Amoxil');
  const soon = await makeBatch(w.a.id, w.b1, p.id, { lot: 'SOON', expiry: plus(40), buckets: { available: 3 }, cost: { unitCostMinor: 50n, costUnitId: p.tablet } });
  const late = await makeBatch(w.a.id, w.b1, p.id, { lot: 'LATE', expiry: plus(400), buckets: { available: 10 }, cost: { unitCostMinor: 80n, costUnitId: p.tablet } });
  return { p, soon, late };
}

beforeAll(() => {
  useTestDatabase();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterAll(() => {
  vi.useRealTimers();
});
beforeEach(async () => {
  await resetWorld();
  w = await creditWorld();
}, 60_000);

describe('the cost the sale would take', () => {
  it('takes the nearest expiry first, across batches, and gives the profit after the line discount', async () => {
    const { p } = await costed();
    // 5 tablets: 3 from SOON (150) and 2 from LATE (160) = 310. Total 5 x 150 - 50 = 700, profit 390.
    const got = await costs([{ key: 'a', productId: p.id, unitId: p.tablet, qty: 5, unitPriceMinor: '150', discountMinor: '50' }]);
    expect(got.lines).toEqual([{ key: 'a', costMinor: '310', profitMinor: '390' }]);
  });

  it('lets two lines of one product share the batches in order, as the sale does', async () => {
    const { p } = await costed();
    const got = await costs([
      { key: 'a', productId: p.id, unitId: p.tablet, qty: 2, unitPriceMinor: '150' },
      { key: 'b', productId: p.id, unitId: p.tablet, qty: 2, unitPriceMinor: '150' },
    ]);
    // a: 2 x 50 = 100; b: 1 x 50 + 1 x 80 = 130.
    expect(got.lines.map((l) => [l.key, l.costMinor, l.profitMinor])).toEqual([
      ['a', '100', '200'],
      ['b', '130', '170'],
    ]);
  });

  it('costs a bigger unit in base units, floored like the sale snapshot', async () => {
    const p = await makeProduct(w.a.id, 'Augmentin');
    await makeBatch(w.a.id, w.b1, p.id, { lot: 'S', expiry: plus(100), buckets: { available: 30 }, cost: { unitCostMinor: 905n, costUnitId: p.strip } });
    // 3 tablets of a strip of 10 bought at 905: 905 x 3 / 10 = 271.5, floored to 271.
    expect((await costs([{ key: 'a', productId: p.id, unitId: p.tablet, qty: 3, unitPriceMinor: '100' }])).lines).toEqual([{ key: 'a', costMinor: '271', profitMinor: '29' }]);
    // One strip: 10 base units, 905.
    expect((await costs([{ key: 'b', productId: p.id, unitId: p.strip, qty: 1, unitPriceMinor: '900' }])).lines).toEqual([{ key: 'b', costMinor: '905', profitMinor: '-5' }]);
  });

  it('shows a loss honestly when the discount eats the margin', async () => {
    const { p } = await costed();
    const got = await costs([{ key: 'a', productId: p.id, unitId: p.tablet, qty: 1, unitPriceMinor: '150', discountMinor: '120' }]);
    expect(got.lines).toEqual([{ key: 'a', costMinor: '50', profitMinor: '-20' }]);
  });

  it('takes a chosen batch first, then FEFO for the other lines', async () => {
    const { p, late } = await costed();
    const got = await costs([
      { key: 'a', productId: p.id, unitId: p.tablet, qty: 1, unitPriceMinor: '150' },
      { key: 'b', productId: p.id, unitId: p.tablet, qty: 2, unitPriceMinor: '150', batchId: late },
    ]);
    expect(got.lines.map((l) => [l.key, l.costMinor])).toEqual([
      ['a', '50'],
      ['b', '160'],
    ]);
  });

  it('skips expired and recalled batches, and reads only this branch', async () => {
    const p = await makeProduct(w.a.id, 'Zinnat');
    await makeBatch(w.a.id, w.b1, p.id, { lot: 'OLD', expiry: plus(-2), buckets: { available: 5 }, cost: { unitCostMinor: 1n, costUnitId: p.tablet } });
    await makeBatch(w.a.id, w.b1, p.id, { lot: 'RC', expiry: plus(10), status: 'RECALLED', buckets: { available: 5 }, cost: { unitCostMinor: 2n, costUnitId: p.tablet } });
    await makeBatch(w.a.id, w.b2, p.id, { lot: 'B2', expiry: plus(5), buckets: { available: 5 }, cost: { unitCostMinor: 3n, costUnitId: p.tablet } });
    await makeBatch(w.a.id, w.b1, p.id, { lot: 'OK', expiry: plus(60), buckets: { available: 5 }, cost: { unitCostMinor: 70n, costUnitId: p.tablet } });
    expect((await costs([{ key: 'a', productId: p.id, unitId: p.tablet, qty: 2, unitPriceMinor: '100' }])).lines[0]!.costMinor).toBe('140');
  });

  it('says the cost is unknown (null, no profit) when a batch has none, the stock is short or the currency differs', async () => {
    const { p } = await costed();
    // Panadol's batch in branch 1 has no cost.
    const unknown = await costs([
      { key: 'nocost', productId: w.p.id, unitId: w.p.tablet, qty: 1, unitPriceMinor: '100' },
      { key: 'short', productId: p.id, unitId: p.tablet, qty: 50, unitPriceMinor: '150' },
    ]);
    expect(unknown.lines).toEqual([
      { key: 'nocost', costMinor: null, profitMinor: null },
      { key: 'short', costMinor: null, profitMinor: null },
    ]);
    const usd = await costs([{ key: 'usd', productId: p.id, unitId: p.tablet, qty: 1, unitPriceMinor: '150' }], w.owner, { currency: 'USD' });
    expect(usd.lines).toEqual([{ key: 'usd', costMinor: null, profitMinor: null }]);
  });
});

describe('who sees it', () => {
  const line = (p: { id: string; tablet: string }): Line => ({ key: 'a', productId: p.id, unitId: p.tablet, qty: 1, unitPriceMinor: '150' });

  it('gives a cashier and a pharmacist without cost.view an answer with no cost or profit anywhere in it', async () => {
    const { p } = await costed();
    for (const who of [w.cashier, w.pharmacist]) {
      const result = await ask(who, sellQueries.costs, { ...at(), currency: 'IQD', lines: [line(p)] });
      expect(codeOf(result)).toBe('OK');
      expect(JSON.stringify(result)).not.toMatch(/cost|profit|"50"|"100"/i);
      expect(dataOf(result)).toEqual({ lines: [] });
    }
  });

  it('gives cost and profit to the owner and the branch manager, and to the accountant who reads reports', async () => {
    const { p } = await costed();
    for (const who of [w.owner, w.manager, w.accountant]) expect((await costs([line(p)], who)).lines).toEqual([{ key: 'a', costMinor: '50', profitMinor: '100' }]);
  });

  it('gives the pharmacist in charge the cost but no profit key (no profit.view)', async () => {
    const { p } = await costed();
    const result = await ask(w.pic, sellQueries.costs, { ...at(), currency: 'IQD', lines: [line(p)] });
    expect(dataOf(result)).toEqual({ lines: [{ key: 'a', costMinor: '50' }] });
    expect(JSON.stringify(result)).not.toMatch(/profit/i);
  });

  it('refuses a stock clerk, a support grant and another business', async () => {
    const { p } = await costed();
    expect(codeOf(await ask(w.stockClerk, sellQueries.costs, { ...at(), currency: 'IQD', lines: [line(p)] }))).toBe('FORBIDDEN');
    expect(codeOf(await ask(w.support, sellQueries.costs, { ...at(), currency: 'IQD', lines: [line(p)] }))).toBe('FORBIDDEN');
    expect(codeOf(await ask(w.ownerB, sellQueries.costs, { ...at(), currency: 'IQD', lines: [line(p)] }))).toBe('FORBIDDEN');
  });

  it("refuses another business's product and a unit of another product, and keeps a branch-1 person out of branch 2", async () => {
    const { p } = await costed();
    const foreign = await makeProduct(w.b.id, 'Foreign');
    expect(codeOf(await ask(w.owner, sellQueries.costs, { ...at(), currency: 'IQD', lines: [line(foreign)] }))).toBe('NOT_FOUND');
    expect(codeOf(await ask(w.owner, sellQueries.costs, { ...at(), currency: 'IQD', lines: [{ ...line(p), unitId: w.p.tablet }] }))).toBe('NOT_FOUND');
    expect(codeOf(await ask(w.manager, sellQueries.costs, { ...at(w.b2), currency: 'IQD', lines: [line(p)] }))).toBe('FORBIDDEN');
  });

  it('needs at least one line and at most 200', async () => {
    const { p } = await costed();
    expect(codeOf(await ask(w.owner, sellQueries.costs, { ...at(), currency: 'IQD', lines: [] }))).toBe('INVALID');
    const many = Array.from({ length: 201 }, (_, i) => ({ ...line(p), key: `k${i}` }));
    expect(codeOf(await ask(w.owner, sellQueries.costs, { ...at(), currency: 'IQD', lines: many }))).toBe('INVALID');
  });
});
