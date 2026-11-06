import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as returnActions from '@/server/pharmacy/actions/returns';
import * as saleActions from '@/server/pharmacy/actions/sales';
import * as sellQueries from '@/server/pharmacy/queries/sell';
import { creditWorld, key, type CreditWorld } from './credit-world';
import { NOW, prisma, resetWorld, useTestDatabase } from './fixture';
import { act, ask, codeOf, dataOf, makeBatch, makeProduct } from './stock-helpers';

/**
 * The cashier's product panels (plan Task 10): batches nearest expiry first with expired ones marked and never sellable, the item
 * details (code, last sale prices, last purchase, never a cost), and substitutes by active ingredient only. Also the return gate
 * the cashier's return mode leans on: a return names its original sale and needs `return.approve`.
 */

interface Info {
  productId: string;
  currency: string;
  batches: { batchId: string; lot: string; expiryDate: string; expiryPrecision: string; available: number; expired: boolean; near: boolean; sellable: boolean }[];
  details: { code: string; genericName: string; activeIngredient: string; lastSales: { unitLabel: string; unitPriceMinor: string; at: string }[]; lastPurchase: { at: string; supplierName: string } | null };
  substitutes: { productId: string; tradeName: string; sellableQty: number }[];
}

let w: CreditWorld;
const at = (branchId = w.b1) => ({ restaurantId: w.a.id, branchId });
const info = async (productId: string, who = w.cashier) => dataOf(await ask(who, sellQueries.info, { ...at(), productId })) as Info;
const plus = (days: number) => new Date(NOW.getTime() + days * 86_400_000).toISOString().slice(0, 10);

const ingredientOf = (id: string, activeIngredient: string, genericName = '') => prisma().phProduct.update({ where: { id }, data: { activeIngredient, genericName } });
const priced = async (p: { id: string; tablet: string; strip: string }, tablet = 150n) => {
  for (const [unitId, amountMinor] of [[p.tablet, tablet], [p.strip, tablet * 9n]] as const) {
    await prisma().phPrice.create({ data: { restaurantId: w.a.id, productId: p.id, unitId, branchId: null, currency: 'IQD', amountMinor, validFrom: new Date('2026-01-01T00:00:00.000Z'), changedById: 'seed' } });
  }
};

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

describe('batches', () => {
  it('lists every batch on the shelf here nearest expiry first, expired ones marked and not sellable', async () => {
    const p = await makeProduct(w.a.id, 'Amoxil');
    await makeBatch(w.a.id, w.b1, p.id, { lot: 'LATE', expiry: plus(400), buckets: { available: 5 } });
    await makeBatch(w.a.id, w.b1, p.id, { lot: 'OLD', expiry: plus(-3), buckets: { available: 2 } });
    await makeBatch(w.a.id, w.b1, p.id, { lot: 'SOON', expiry: plus(30), buckets: { available: 7 } });
    await makeBatch(w.a.id, w.b1, p.id, { lot: 'GONE', expiry: plus(10), buckets: { quarantine: 4 } });
    await makeBatch(w.a.id, w.b2, p.id, { lot: 'ELSEWHERE', expiry: plus(5), buckets: { available: 9 } });
    const got = await info(p.id);
    expect(got.batches.map((b) => b.lot)).toEqual(['OLD', 'SOON', 'LATE']);
    expect(got.batches.map((b) => [b.expired, b.sellable, b.near])).toEqual([
      [true, false, false],
      [false, true, true],
      [false, true, false],
    ]);
    expect(got.batches[1]).toMatchObject({ available: 7, expiryDate: plus(30), expiryPrecision: 'DAY' });
  });

  it('marks a recalled batch not sellable', async () => {
    const p = await makeProduct(w.a.id, 'Recallin');
    await makeBatch(w.a.id, w.b1, p.id, { lot: 'R1', status: 'RECALLED', buckets: { available: 3 } });
    expect((await info(p.id)).batches.map((b) => [b.lot, b.expired, b.sellable])).toEqual([['R1', false, false]]);
  });
});

describe('details', () => {
  it('gives the code, the last three sale prices here newest first and the last purchase, and never a cost', async () => {
    await prisma().phBarcode.create({ data: { restaurantId: w.a.id, productId: w.p.id, unitId: w.p.strip, code: '6221010001' } });
    for (const qty of [1, 2, 3, 4]) {
      dataOf(await act(w.cashier, saleActions.create, { ...at(), clientKey: key('sale'), currency: 'IQD', lines: [{ productId: w.p.id, unitId: qty % 2 ? w.p.tablet : w.p.strip, qty: 1 }], payments: [{ method: 'CASH', amountMinor: 900n, clientKey: key('pay') }] }));
      vi.setSystemTime(new Date(NOW.getTime() + qty * 60_000));
    }
    vi.setSystemTime(NOW);
    await prisma().phBatch.update({ where: { id: w.batch1 }, data: { supplierName: 'Al-Hakim' } });
    const got = await info(w.p.id);
    expect(got.details.code).toBe('6221010001');
    expect(got.details.lastSales.map((s) => [s.unitLabel, s.unitPriceMinor])).toEqual([
      ['strip', '900'],
      ['tablet', '100'],
      ['strip', '900'],
    ]);
    // The last batch received into THIS branch (branch 2's own batch is newer but is not on this shelf).
    expect(got.details.lastPurchase).toEqual({ at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), supplierName: 'Al-Hakim' });
    expect(JSON.stringify(got)).not.toMatch(/cost|profit/i);
  });

  it('has no sales and no code for a new product', async () => {
    const p = await makeProduct(w.a.id, 'Newcillin');
    const got = await info(p.id);
    expect(got.details).toMatchObject({ code: '', lastSales: [], lastPurchase: null });
  });
});

describe('substitutes', () => {
  it('are the products with the same active ingredient (any case), in stock here, sellable and priced, the item itself excluded', async () => {
    await ingredientOf(w.p.id, 'Paracetamol');
    const adol = await makeProduct(w.a.id, 'Adol');
    await ingredientOf(adol.id, ' paracetamol ');
    await priced(adol);
    await makeBatch(w.a.id, w.b1, adol.id, { lot: 'A1', buckets: { available: 60 } });
    const empty = await makeProduct(w.a.id, 'Fevadol');
    await ingredientOf(empty.id, 'Paracetamol');
    await priced(empty);
    const unpriced = await makeProduct(w.a.id, 'Calpol');
    await ingredientOf(unpriced.id, 'Paracetamol');
    await makeBatch(w.a.id, w.b1, unpriced.id, { lot: 'C1', buckets: { available: 60 } });
    const expiredOnly = await makeProduct(w.a.id, 'Tylenol');
    await ingredientOf(expiredOnly.id, 'Paracetamol');
    await priced(expiredOnly);
    await makeBatch(w.a.id, w.b1, expiredOnly.id, { lot: 'T1', expiry: plus(-1), buckets: { available: 60 } });
    // Same name family and generic name, other ingredient: never a substitute.
    const namesake = await makeProduct(w.a.id, 'Panadol Cold');
    await ingredientOf(namesake.id, 'Paracetamol + Pseudoephedrine', 'Paracetamol');
    await priced(namesake);
    await makeBatch(w.a.id, w.b1, namesake.id, { lot: 'N1', buckets: { available: 60 } });
    const got = await info(w.p.id);
    expect(got.substitutes.map((s) => s.tradeName)).toEqual(['Adol']);
    expect(got.substitutes[0]).toMatchObject({ productId: adol.id, sellableQty: 60 });
    // From Adol's side Panadol is the substitute.
    expect((await info(adol.id)).substitutes.map((s) => s.tradeName)).toEqual(['Panadol']);
  });

  it('finds an exact match even behind many products that only contain the ingredient (M6)', async () => {
    await ingredientOf(w.p.id, 'Paracetamol');
    await prisma().phProduct.createMany({
      data: Array.from({ length: 105 }, (_, i) => ({ restaurantId: w.a.id, tradeName: `AAA ${i}`, identityKey: `combo-${i}|${w.a.id}`, searchText: `aaa ${i}`, activeIngredient: `Paracetamol + Extra ${i}` })),
    });
    const zed = await makeProduct(w.a.id, 'Zedol');
    await ingredientOf(zed.id, 'paracetamol');
    await priced(zed);
    await makeBatch(w.a.id, w.b1, zed.id, { lot: 'Z1', buckets: { available: 5 } });
    expect((await info(w.p.id)).substitutes.map((s) => s.tradeName)).toEqual(['Zedol']);
  });

  it('is empty when the product has no active ingredient', async () => {
    const other = await makeProduct(w.a.id, 'Nameless');
    await priced(other);
    await makeBatch(w.a.id, w.b1, other.id, { lot: 'X', buckets: { available: 5 } });
    expect((await info(w.p.id)).substitutes).toEqual([]);
  });
});

describe('who may read it', () => {
  it('is the people who sell or read reports, in their own branch and business', async () => {
    expect(codeOf(await ask(w.stockClerk, sellQueries.info, { ...at(), productId: w.p.id }))).toBe('FORBIDDEN');
    expect(codeOf(await ask(w.accountant, sellQueries.info, { ...at(), productId: w.p.id }))).toBe('OK');
    expect(codeOf(await ask(w.cashier, sellQueries.info, { ...at(w.b2), productId: w.p.id }))).not.toBe('OK');
    expect(codeOf(await ask(w.ownerB, sellQueries.info, { ...at(), productId: w.p.id }))).not.toBe('OK');
    expect(codeOf(await ask(w.cashier, sellQueries.info, { ...at(), productId: 'missing' }))).toBe('NOT_FOUND');
  });
});

describe('the return gate behind the cashier return mode', () => {
  it('needs the original sale and an approver; a cashier is refused and a return is capped at what was sold', async () => {
    const sale = dataOf(await act(w.cashier, saleActions.create, { ...at(), clientKey: key('sale'), currency: 'IQD', lines: [{ productId: w.p.id, unitId: w.p.tablet, qty: 2 }], payments: [{ method: 'CASH', amountMinor: 200n, clientKey: key('pay') }] })) as { id: string };
    const line = await prisma().phSaleLine.findFirstOrThrow({ where: { saleId: sale.id } });
    const ret = (who = w.manager, over: Record<string, unknown> = {}) => act(who, returnActions.create, { ...at(), saleId: sale.id, lines: [{ saleLineId: line.id, baseQty: 1 }], reason: 'Changed mind', clientKey: key('ret'), ...over });
    expect(codeOf(await ret(w.cashier))).toBe('FORBIDDEN');
    expect(codeOf(await ret(w.pharmacist))).toBe('FORBIDDEN');
    expect(codeOf(await ret(w.manager, { saleId: undefined }))).toBe('INVALID');
    const over = await ret(w.manager, { lines: [{ saleLineId: line.id, baseQty: 3 }] });
    expect(over.ok ? null : over.error.fields?.phCode).toBe('RETURN_LIMIT');
    expect(codeOf(await ret(w.manager))).toBe('OK');
  });
});
