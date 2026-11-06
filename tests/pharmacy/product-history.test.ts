import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as productActions from '@/server/pharmacy/actions/products';
import * as receiptActions from '@/server/pharmacy/actions/receipts';
import { productHistory } from '@/server/pharmacy/queries/product-history';
import { NOW, person, pharmacy, prisma, resetWorld, useTestDatabase, type Person } from './fixture';
import { act, ask, codeOf, dataOf } from './stock-helpers';

/**
 * The entry screen's product history (Task 13): purchases, sales and returns of one product in the chosen branch, newest
 * first, at most 50 of each. The purchase price appears only for a role with `cost.view` (the permission that shows it on
 * receipts); for anyone else the key is absent, not empty.
 */

const LADDER = [
  { level: 0, label: 'tablet', baseQty: 1, sellable: true },
  { level: 1, label: 'strip', baseQty: 10, sellable: true },
  { level: 2, label: 'box', baseQty: 30, sellable: true },
];

interface World {
  a: { id: string; branchId: string; branchIds: string[] };
  owner: Person;
  cashier: Person;
  product: { id: string; tablet: string; strip: string; box: string };
  other: string;
}

let keySeq = 0;
const key = () => `history-key-${(keySeq += 1)}`;

async function world(): Promise<World> {
  const a = await pharmacy('A', { branches: 2 });
  const owner = await person('owner', { membership: [a.id, 'OWNER'] });
  const cashier = await person('cashier', { staff: [a.id, 'CASHIER', [a.branchIds[0]!]] });
  const made = dataOf(await act(owner, productActions.create, { restaurantId: a.id, tradeName: 'Glucophage', strength: '500 mg', levels: LADDER }));
  const units = await prisma().phProductUnit.findMany({ where: { productId: made.id }, orderBy: { level: 'asc' } });
  const other = dataOf(await act(owner, productActions.create, { restaurantId: a.id, tradeName: 'Panadol', levels: LADDER })).id;
  return { a, owner, cashier, product: { id: made.id, tablet: units[0]!.id, strip: units[1]!.id, box: units[2]!.id }, other };
}

/** A confirmed receipt of `qty` boxes in `branchId`, received on `day`. */
async function bought(w: World, branchId: string, day: string, qty: number, costMinor: bigint, productId = w.product.id, unitId = w.product.box) {
  const draft = dataOf(
    await act(w.owner, receiptActions.create, {
      restaurantId: w.a.id,
      branchId,
      clientKey: key(),
      supplierName: `Supplier ${day}`,
      receivedOn: day,
      lines: [{ productId, unitId, qty, lot: `L-${day}`, expiry: '2028-03-15', unitCostMinor: costMinor, currency: 'USD' }],
    }),
  );
  vi.setSystemTime(new Date(`${day}T09:00:00.000Z`));
  dataOf(await act(w.owner, receiptActions.confirm, { restaurantId: w.a.id, branchId, receiptId: draft.id }));
  vi.setSystemTime(NOW);
  return draft.id;
}

/** A completed sale of `qty` strips in `branchId` (straight in the database, as the isolation sweep seeds one), with a return of `returned` tablets. */
async function sold(w: World, branchId: string, n: number, at: Date, returned = 0) {
  // One open shift per person and branch: every sale of the branch is in it.
  const shift =
    (await prisma().phShift.findFirst({ where: { branchId, userId: w.owner.userId }, select: { id: true } })) ??
    (await prisma().phShift.create({ data: { restaurantId: w.a.id, branchId, userId: w.owner.userId, currency: 'IQD' }, select: { id: true } }));
  const sale = await prisma().phSale.create({
    data: { restaurantId: w.a.id, branchId, shiftId: shift.id, number: `S-${branchId.slice(-4)}-${n}`, status: 'COMPLETED', currency: 'IQD', subtotalMinor: 2000n, totalMinor: 2000n, paidMinor: 2000n, clientKey: `sale-${branchId}-${n}`, soldById: w.owner.userId, createdAt: at, completedAt: at },
    select: { id: true },
  });
  const line = await prisma().phSaleLine.create({
    data: { restaurantId: w.a.id, saleId: sale.id, lineNo: 1, productId: w.product.id, unitId: w.product.strip, qty: 1, baseQty: 10, unitPriceMinor: 2000n, totalMinor: 2000n },
    select: { id: true },
  });
  if (returned > 0) {
    const batch = await prisma().phBatch.create({ data: { restaurantId: w.a.id, productId: w.product.id, lot: `RET-${n}-${branchId.slice(-4)}`, expiryDate: new Date('2028-01-31T00:00:00.000Z') }, select: { id: true } });
    const allocation = await prisma().phSaleLineAllocation.create({
      data: { restaurantId: w.a.id, saleLineId: line.id, batchId: batch.id, baseQty: 10, expirySnapshot: new Date('2028-01-31T00:00:00.000Z') },
      select: { id: true },
    });
    const ret = await prisma().phReturn.create({
      data: { restaurantId: w.a.id, branchId, saleId: sale.id, shiftId: shift.id, number: `R-${branchId.slice(-4)}-${n}`, reason: 'Wrong item', approvedById: w.owner.userId, refundMethod: 'CASH', refundMinor: 200n * BigInt(returned), currency: 'IQD', clientKey: `ret-${branchId}-${n}`, createdAt: at },
      select: { id: true },
    });
    await prisma().phReturnLine.create({ data: { restaurantId: w.a.id, returnId: ret.id, saleLineAllocationId: allocation.id, baseQty: returned, refundMinor: 200n * BigInt(returned) } });
  }
  return sale.id;
}

beforeAll(() => {
  useTestDatabase();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterAll(() => {
  vi.useRealTimers();
});
beforeEach(resetWorld);
afterEach(() => {
  vi.setSystemTime(NOW);
});

describe('productHistory', () => {
  it('lists the purchases, sales and returns of the product in the chosen branch only, newest first', async () => {
    const w = await world();
    const [b1, b2] = w.a.branchIds as [string, string];
    await bought(w, b1, '2026-10-01', 3, 310n);
    await bought(w, b1, '2026-10-20', 5, 305n);
    await bought(w, b2, '2026-10-21', 7, 300n);
    await bought(w, b1, '2026-10-22', 9, 100n, w.other, (await prisma().phProductUnit.findFirstOrThrow({ where: { productId: w.other, level: 2 } })).id);
    await sold(w, b1, 1, new Date('2026-10-23T08:00:00.000Z'));
    await sold(w, b1, 2, new Date('2026-10-25T08:00:00.000Z'), 4);
    await sold(w, b2, 3, new Date('2026-10-26T08:00:00.000Z'), 2);

    const out = dataOf(await ask(w.owner, productHistory, { restaurantId: w.a.id, branchId: b1, productId: w.product.id }));
    expect(out.purchases.map((p) => [p.receivedOn, p.qty, p.unitLabel, p.supplierName])).toEqual([
      ['2026-10-20', 5, 'box', 'Supplier 2026-10-20'],
      ['2026-10-01', 3, 'box', 'Supplier 2026-10-01'],
    ]);
    expect(out.purchases[0]).toMatchObject({ unitCostMinor: '305', currency: 'USD', lot: 'L-2026-10-20', expiryDate: '2028-03-15' });
    expect(out.sales.map((s) => s.saleNumber)).toEqual([`S-${b1.slice(-4)}-2`, `S-${b1.slice(-4)}-1`]);
    expect(out.sales[0]).toMatchObject({ unitLabel: 'strip', qty: 1, unitPriceMinor: '2000', currency: 'IQD' });
    expect(out.returns).toHaveLength(1);
    expect(out.returns[0]).toMatchObject({ returnNumber: `R-${b1.slice(-4)}-2`, baseQty: 4, refundMinor: '800', currency: 'IQD', reason: 'Wrong item', unitLabel: 'strip' });
    expect(JSON.stringify(out)).not.toContain(b2);
  });

  it('shows no purchase price to a role without cost.view: the key is absent', async () => {
    const w = await world();
    const b1 = w.a.branchIds[0]!;
    await bought(w, b1, '2026-10-01', 3, 310n);
    const out = dataOf(await ask(w.cashier, productHistory, { restaurantId: w.a.id, branchId: b1, productId: w.product.id }));
    expect(out.purchases).toHaveLength(1);
    expect(out.purchases[0]).not.toHaveProperty('unitCostMinor');
    expect(out.purchases[0]).not.toHaveProperty('currency');
    expect(JSON.stringify(out)).not.toContain('310');
  });

  it('keeps at most 50 rows of each kind, the newest ones', async () => {
    const w = await world();
    const b1 = w.a.branchIds[0]!;
    for (let n = 1; n <= 53; n += 1) await sold(w, b1, n, new Date(Date.UTC(2026, 9, 1, 0, n)));
    const out = dataOf(await ask(w.owner, productHistory, { restaurantId: w.a.id, branchId: b1, productId: w.product.id }));
    expect(out.sales).toHaveLength(50);
    expect(out.sales[0]!.saleNumber).toBe(`S-${b1.slice(-4)}-53`);
    expect(out.sales[49]!.saleNumber).toBe(`S-${b1.slice(-4)}-4`);
  });

  it('needs a branch, refuses another business’s product and a branch the person does not work in', async () => {
    const w = await world();
    const [b1, b2] = w.a.branchIds as [string, string];
    expect(codeOf(await ask(w.owner, productHistory, { restaurantId: w.a.id, productId: w.product.id }))).toBe('INVALID');
    const b = await pharmacy('B');
    const ownerB = await person('ownerB', { membership: [b.id, 'OWNER'] });
    expect(codeOf(await ask(ownerB, productHistory, { restaurantId: b.id, branchId: b.branchId, productId: w.product.id }))).toBe('NOT_FOUND');
    expect(codeOf(await ask(ownerB, productHistory, { restaurantId: w.a.id, branchId: b1, productId: w.product.id }))).toBe('FORBIDDEN');
    expect(codeOf(await ask(w.cashier, productHistory, { restaurantId: w.a.id, branchId: b2, productId: w.product.id }))).toBe('FORBIDDEN');
  });
});
