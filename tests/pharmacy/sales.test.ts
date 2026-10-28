import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as saleActions from '@/server/pharmacy/actions/sales';
import * as saleQueries from '@/server/pharmacy/queries/sales';
import { NOW, person, pharmacy, prisma, resetWorld, useTestDatabase, type Person } from './fixture';
import { act, ask, balanceOf, codeOf, dataOf, makeBatch, makeProduct, phCodeOf } from './stock-helpers';

/**
 * Selling (phase 3, task 3a): one transaction per sale, idempotent by key, FEFO from the branch's sellable stock, price
 * lookup at the moment of sale, discounts judged together, IQD-only rounding, payments, cash movements and the cost
 * snapshot that never leaves the server without `cost.view`.
 */

interface World {
  a: { id: string; branchId: string; branchIds: string[] };
  b1: string;
  b2: string;
  owner: Person;
  cashier: Person;
  pharmacist: Person;
  manager: Person;
  p: { id: string; tablet: string; strip: string };
}

const DAY = 86_400_000;
let seq = 0;
const key = (label: string) => `${label}-${(seq += 1)}-${'x'.repeat(8)}`;

async function price(restaurantId: string, p: World['p'], branchId: string | null, currency: 'IQD' | 'USD', tablet: bigint, strip: bigint) {
  for (const [unitId, amountMinor] of [[p.tablet, tablet], [p.strip, strip]] as const) {
    await prisma().phPrice.create({ data: { restaurantId, productId: p.id, unitId, branchId, currency, amountMinor, validFrom: new Date('2026-01-01T00:00:00.000Z'), changedById: 'seed' } });
  }
}
const openShift = (restaurantId: string, branchId: string, who: Person, currency: 'IQD' | 'USD' = 'IQD') =>
  prisma().phShift.create({ data: { restaurantId, branchId, userId: who.userId, currency, openingFloatMinor: 0n }, select: { id: true } });

async function world(): Promise<World> {
  const a = await pharmacy('A', { branches: 2 });
  const [b1, b2] = a.branchIds as [string, string];
  const owner = await person('owner', { membership: [a.id, 'OWNER'] });
  const cashier = await person('cashier', { staff: [a.id, 'CASHIER', [b1]] });
  const pharmacist = await person('pharmacist', { staff: [a.id, 'PHARMACIST', [b1]] });
  const manager = await person('manager', { staff: [a.id, 'BRANCH_MANAGER', [b1]] });
  await prisma().phSettings.create({ data: { restaurantId: a.id } });
  const p = await makeProduct(a.id, 'Panadol');
  await price(a.id, p, null, 'IQD', 100n, 900n);
  for (const who of [owner, cashier, pharmacist, manager]) await openShift(a.id, b1, who);
  await openShift(a.id, b2, owner);
  return { a, b1, b2, owner, cashier, pharmacist, manager, p };
}

const stock = (w: World, over: { lot?: string; expiry?: string; status?: 'ACTIVE' | 'RECALLED' | 'BLOCKED'; buckets?: Record<string, number>; branchId?: string; cost?: { unitCostMinor: bigint; costUnitId: string }; productId?: string } = {}) =>
  makeBatch(w.a.id, over.branchId ?? w.b1, over.productId ?? w.p.id, {
    lot: over.lot ?? 'L1',
    expiry: over.expiry ?? '2028-03-31',
    status: over.status ?? 'ACTIVE',
    buckets: over.buckets ?? { available: 100 },
    ...(over.cost ? { cost: over.cost } : {}),
  });

const sale = (w: World, over: Record<string, unknown> = {}) => ({
  restaurantId: w.a.id,
  branchId: w.b1,
  clientKey: key('sale'),
  currency: 'IQD',
  lines: [{ productId: w.p.id, unitId: w.p.tablet, qty: 1 }],
  payments: [{ method: 'CASH', amountMinor: 100n, clientKey: key('pay') }],
  ...over,
});
const cash = (amountMinor: bigint) => ({ method: 'CASH', amountMinor, clientKey: key('pay') });

const counts = async () => ({
  sales: await prisma().phSale.count(),
  lines: await prisma().phSaleLine.count(),
  allocations: await prisma().phSaleLineAllocation.count(),
  payments: await prisma().phPayment.count(),
  cash: await prisma().phCashMovement.count(),
  movements: await prisma().phStockMovement.count({ where: { type: 'SALE' } }),
  audit: await prisma().auditLog.count({ where: { action: 'ph.sale.create' } }),
});
const avail = async (batchId: string, branchId: string) => (await balanceOf(batchId, branchId))?.available ?? 0;

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

describe('a sale', () => {
  it('sells, decrements stock, writes the SALE movement, the payment and the cash movements, and numbers it', async () => {
    const w = await world();
    const batch = await stock(w);
    const made = dataOf(await act(w.cashier, saleActions.create, sale(w, { lines: [{ productId: w.p.id, unitId: w.p.strip, qty: 2 }], payments: [cash(2000n)] })));
    expect(made).toMatchObject({ status: 'COMPLETED', currency: 'IQD', subtotalMinor: '1800', discountMinor: '0', roundingMinor: '0', totalMinor: '1800', paidMinor: '2000', changeMinor: '200', lineCount: 1, replayed: false });
    expect(made.number).toBe('20261027-000001');

    expect(await avail(batch, w.b1)).toBe(80);
    const row = await prisma().phSale.findUniqueOrThrow({ where: { id: made.id }, include: { lines: { include: { allocations: true } }, payments: true } });
    expect(row).toMatchObject({ branchId: w.b1, status: 'COMPLETED', soldById: w.cashier.userId, totalMinor: 1800n, paidMinor: 2000n, changeMinor: 200n, completedAt: NOW });
    expect(row.lines[0]).toMatchObject({ lineNo: 1, qty: 2, baseQty: 20, unitPriceMinor: 900n, discountMinor: 0n, totalMinor: 1800n, rxLevel: 'OTC', pharmacistId: null });
    expect(row.lines[0]!.priceId).not.toBeNull();
    expect(row.lines[0]!.allocations).toHaveLength(1);
    expect(row.lines[0]!.allocations[0]).toMatchObject({ batchId: batch, baseQty: 20, returnedBaseQty: 0 });
    expect(row.lines[0]!.allocations[0]!.expirySnapshot.toISOString().slice(0, 10)).toBe('2028-03-31');
    expect(row.payments).toHaveLength(1);
    expect(row.payments[0]).toMatchObject({ method: 'CASH', amountMinor: 2000n, currency: 'IQD' });

    const movement = await prisma().phStockMovement.findFirstOrThrow({ where: { type: 'SALE' } });
    expect(movement).toMatchObject({ batchId: batch, branchId: w.b1, availableDelta: -20, refType: 'sale', refId: row.lines[0]!.allocations[0]!.id, userId: w.cashier.userId, reason: '' });

    const shift = await prisma().phShift.findFirstOrThrow({ where: { userId: w.cashier.userId } });
    const cashRows = await prisma().phCashMovement.findMany({ where: { shiftId: shift.id }, orderBy: { amountMinor: 'desc' } });
    expect(cashRows.map((c) => [c.type, c.amountMinor, c.refType, c.refId])).toEqual([
      ['SALE_CASH', 2000n, 'sale', made.id],
      ['CHANGE_OUT', -200n, 'sale', made.id],
    ]);
  });

  it('numbers per branch per UTC day', async () => {
    const w = await world();
    await stock(w);
    await stock(w, { branchId: w.b2, lot: 'L2' });
    const one = dataOf(await act(w.cashier, saleActions.create, sale(w)));
    const two = dataOf(await act(w.cashier, saleActions.create, sale(w)));
    const other = dataOf(await act(w.owner, saleActions.create, sale(w, { branchId: w.b2 })));
    expect([one.number, two.number, other.number]).toEqual(['20261027-000001', '20261027-000002', '20261027-000001']);
    vi.setSystemTime(new Date(NOW.getTime() + DAY));
    const next = dataOf(await act(w.cashier, saleActions.create, sale(w)));
    expect(next.number).toBe('20261028-000001');
  });

  it('audits ids, number, totals and counts, with no cost and no customer field', async () => {
    const w = await world();
    await stock(w, { cost: { unitCostMinor: 705n, costUnitId: w.p.strip } });
    const made = dataOf(await act(w.cashier, saleActions.create, sale(w)));
    const log = await prisma().auditLog.findFirstOrThrow({ where: { action: 'ph.sale.create', entityId: made.id } });
    const text = JSON.stringify(log.changes);
    expect(log.entityType).toBe('PhSale');
    expect(text).toContain(made.number);
    expect(text).toContain('"lineCount"');
    expect(text).not.toMatch(/cost|customer|patient/i);
  });

  it('refuses a sale without lines, with too many lines, or without a branch', async () => {
    const w = await world();
    await stock(w);
    expect(codeOf(await act(w.cashier, saleActions.create, sale(w, { lines: [] })))).toBe('INVALID');
    const tooMany = Array.from({ length: 201 }, () => ({ productId: w.p.id, unitId: w.p.tablet, qty: 1 }));
    expect(codeOf(await act(w.cashier, saleActions.create, sale(w, { lines: tooMany })))).toBe('INVALID');
    const noBranch = await act(w.owner, saleActions.create, sale(w, { branchId: undefined }));
    expect(codeOf(noBranch)).toBe('INVALID');
    expect(noBranch.ok ? null : noBranch.error.fields).toHaveProperty('branchId');
    expect((await counts()).sales).toBe(0);
  });
});

describe('idempotency', () => {
  it('a repeat with the same key and request returns the stored sale and changes nothing', async () => {
    const w = await world();
    const batch = await stock(w);
    const input = sale(w);
    const first = dataOf(await act(w.cashier, saleActions.create, input));
    const again = dataOf(await act(w.cashier, saleActions.create, input));
    expect(again).toMatchObject({ id: first.id, number: first.number, totalMinor: first.totalMinor, replayed: true });
    expect(await counts()).toMatchObject({ sales: 1, payments: 1, movements: 1, cash: 1, audit: 1 });
    expect(await avail(batch, w.b1)).toBe(99);
  });

  it('a repeat is answered even after the shift closed', async () => {
    const w = await world();
    await stock(w);
    const input = sale(w);
    const first = dataOf(await act(w.cashier, saleActions.create, input));
    await prisma().phShift.updateMany({ where: { userId: w.cashier.userId }, data: { status: 'CLOSED', closedAt: NOW, countedMinor: 100n, expectedMinor: 100n, varianceMinor: 0n } });
    const again = dataOf(await act(w.cashier, saleActions.create, input));
    expect(again.id).toBe(first.id);
    expect(again.replayed).toBe(true);
  });

  it('refuses the same key for another request, branch, user, currency or payment', async () => {
    const w = await world();
    await stock(w);
    await stock(w, { branchId: w.b2, lot: 'L2' });
    const payKey = key('pay');
    const input = sale(w, { clientKey: 'shared-sale-key', payments: [{ method: 'CASH', amountMinor: 100n, clientKey: payKey }] });
    dataOf(await act(w.cashier, saleActions.create, input));
    const mismatches: [string, Person, Record<string, unknown>][] = [
      ['quantity', w.cashier, { ...input, lines: [{ productId: w.p.id, unitId: w.p.tablet, qty: 2 }] }],
      ['unit', w.cashier, { ...input, lines: [{ productId: w.p.id, unitId: w.p.strip, qty: 1 }] }],
      ['payment amount', w.cashier, { ...input, payments: [{ method: 'CASH', amountMinor: 150n, clientKey: payKey }] }],
      ['payment method', w.cashier, { ...input, payments: [{ method: 'CARD_MANUAL', amountMinor: 100n, clientKey: payKey }] }],
      ['payment key', w.cashier, { ...input, payments: [{ method: 'CASH', amountMinor: 100n, clientKey: key('other') }] }],
      ['note', w.cashier, { ...input, note: 'different' }],
      ['discount', w.cashier, { ...input, lines: [{ productId: w.p.id, unitId: w.p.tablet, qty: 1, discount: { kind: 'amount', value: 1n } }] }],
      ['invoice discount', w.cashier, { ...input, invoiceDiscount: { kind: 'amount', value: 1n } }],
      ['currency', w.cashier, { ...input, currency: 'USD' }],
      ['user', w.manager, input],
      ['branch', w.owner, { ...input, branchId: w.b2 }],
    ];
    for (const [label, who, body] of mismatches) {
      const r = await act(who, saleActions.create, body);
      expect(phCodeOf(r), label).toBe('CLIENT_KEY_MISMATCH');
    }
    expect(await counts()).toMatchObject({ sales: 1, payments: 1, movements: 1 });
  });

  it('the same key sent several times at once makes one sale and one payment', async () => {
    const w = await world();
    const batch = await stock(w);
    const input = sale(w);
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => act(w.cashier, saleActions.create, input)));
    const ids = new Set(results.map((r) => dataOf(r).id));
    expect(ids.size).toBe(1);
    expect(results.filter((r) => dataOf(r).replayed === false)).toHaveLength(1);
    expect(await counts()).toMatchObject({ sales: 1, payments: 1, movements: 1, audit: 1 });
    expect(await avail(batch, w.b1)).toBe(99);
  });

  it('replays the last unit instead of reporting no stock', async () => {
    const w = await world();
    await stock(w, { buckets: { available: 1 } });
    const input = sale(w);
    const results = await Promise.all([1, 2, 3].map(() => act(w.cashier, saleActions.create, input)));
    for (const r of results) expect(codeOf(r)).toBe('OK');
    expect((await counts()).sales).toBe(1);
  });

  it('a payment key used by another sale is refused and nothing is written for the second sale', async () => {
    const w = await world();
    const batch = await stock(w);
    const payKey = 'shared-payment-key';
    dataOf(await act(w.cashier, saleActions.create, sale(w, { payments: [{ method: 'CASH', amountMinor: 100n, clientKey: payKey }] })));
    const before = await counts();
    const r = await act(w.cashier, saleActions.create, sale(w, { payments: [{ method: 'CASH', amountMinor: 100n, clientKey: payKey }] }));
    expect(codeOf(r)).toBe('CONFLICT');
    expect(phCodeOf(r)).toBe('PAYMENT_KEY_USED');
    expect(await counts()).toEqual(before);
    expect(await avail(batch, w.b1)).toBe(99);
  });

  it('two different sales racing with one payment key: one wins, the other is told the payment key is used', async () => {
    const w = await world();
    const batch = await stock(w);
    const results = await Promise.all([1, 2, 3, 4].map(() => act(w.cashier, saleActions.create, sale(w, { payments: [{ method: 'CASH', amountMinor: 100n, clientKey: 'racing-payment-key' }] }))));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    for (const r of results.filter((x) => !x.ok)) expect([codeOf(r), phCodeOf(r)]).toEqual(['CONFLICT', 'PAYMENT_KEY_USED']);
    expect(await counts()).toMatchObject({ sales: 1, payments: 1, movements: 1 });
    expect(await avail(batch, w.b1)).toBe(99);
  });

  it('a sale without a stored hash replays only for the same branch and user', async () => {
    const w = await world();
    await stock(w);
    const input = sale(w);
    const first = dataOf(await act(w.cashier, saleActions.create, input));
    await prisma().phSale.update({ where: { id: first.id }, data: { payloadHash: null } });
    expect(dataOf(await act(w.cashier, saleActions.create, input)).replayed).toBe(true);
    expect(phCodeOf(await act(w.manager, saleActions.create, input))).toBe('CLIENT_KEY_MISMATCH');
  });

  it('the same payment key twice in one request is refused', async () => {
    const w = await world();
    await stock(w);
    const r = await act(w.cashier, saleActions.create, sale(w, { payments: [{ method: 'CASH', amountMinor: 50n, clientKey: 'twice-key-1' }, { method: 'CARD_MANUAL', amountMinor: 50n, clientKey: 'twice-key-1' }] }));
    expect(codeOf(r)).toBe('INVALID');
    expect(phCodeOf(r)).toBe('PAYMENT_KEY_DUPLICATE');
  });
});

describe('shifts', () => {
  it('a shift closing while a sale waits never leaves cash in the closed shift', async () => {
    const w = await world();
    await stock(w);
    const shift = await prisma().phShift.findFirstOrThrow({ where: { userId: w.cashier.userId } });
    let sold: ReturnType<typeof act> | undefined;
    // The closer holds the shift row (as the close will) while the sale starts, then closes it and commits.
    await prisma().$transaction(async (t) => {
      // eslint-disable-next-line no-restricted-properties -- the test plays the closing transaction's row lock
      await t.$queryRaw`SELECT id FROM "PhShift" WHERE id = ${shift.id} FOR UPDATE`;
      sold = act(w.cashier, saleActions.create, sale(w));
      await new Promise((resolve) => setTimeout(resolve, 800));
      await t.phShift.update({ where: { id: shift.id }, data: { status: 'CLOSED', closedAt: NOW, countedMinor: 0n, expectedMinor: 0n, varianceMinor: 0n } });
    });
    const r = await sold!;
    expect([codeOf(r), phCodeOf(r)]).toEqual(['CONFLICT', 'NO_OPEN_SHIFT']);
    expect(await prisma().phCashMovement.count({ where: { shiftId: shift.id } })).toBe(0);
    expect((await counts()).sales).toBe(0);
  });

  it('needs the selling user’s open shift in this branch', async () => {
    const w = await world();
    await stock(w);
    const nobody = await person('nobody', { staff: [w.a.id, 'CASHIER', [w.b1]] });
    const none = await act(nobody, saleActions.create, sale(w));
    expect([codeOf(none), phCodeOf(none)]).toEqual(['CONFLICT', 'NO_OPEN_SHIFT']);
    // The owner's open shift is in branch 2 as well, a manager's in branch 1 does not help in branch 2.
    const both = await person('manager2', { staff: [w.a.id, 'BRANCH_MANAGER', [w.b1, w.b2]] });
    await openShift(w.a.id, w.b1, both);
    await stock(w, { branchId: w.b2, lot: 'L2' });
    const wrongBranch = await act(both, saleActions.create, sale(w, { branchId: w.b2 }));
    expect([codeOf(wrongBranch), phCodeOf(wrongBranch)]).toEqual(['CONFLICT', 'NO_OPEN_SHIFT']);
    await prisma().phShift.updateMany({ where: { userId: w.cashier.userId }, data: { status: 'CLOSED', closedAt: NOW, countedMinor: 0n, expectedMinor: 0n, varianceMinor: 0n } });
    const closed = await act(w.cashier, saleActions.create, sale(w));
    expect(phCodeOf(closed)).toBe('NO_OPEN_SHIFT');
    expect((await counts()).sales).toBe(0);
  });

  it('refuses a currency other than the shift’s', async () => {
    const w = await world();
    await stock(w);
    await price(w.a.id, w.p, null, 'USD', 150n, 1350n);
    const r = await act(w.cashier, saleActions.create, sale(w, { currency: 'USD', payments: [cash(150n)] }));
    expect([codeOf(r), phCodeOf(r)]).toEqual(['CONFLICT', 'SHIFT_CURRENCY']);
    expect((await counts()).sales).toBe(0);
  });

  it('sells in USD on a USD shift with the USD price and no rounding', async () => {
    const w = await world();
    await stock(w);
    await price(w.a.id, w.p, null, 'USD', 150n, 1350n);
    await prisma().phSettings.update({ where: { restaurantId: w.a.id }, data: { roundingStepMinor: 250n } });
    const usd = await person('usd', { staff: [w.a.id, 'CASHIER', [w.b1]] });
    await openShift(w.a.id, w.b1, usd, 'USD');
    const made = dataOf(await act(usd, saleActions.create, sale(w, { currency: 'USD', lines: [{ productId: w.p.id, unitId: w.p.tablet, qty: 2 }], payments: [cash(300n)] })));
    expect(made).toMatchObject({ currency: 'USD', subtotalMinor: '300', roundingMinor: '0', totalMinor: '300' });
    const shiftCash = await prisma().phCashMovement.findMany({ where: { currency: 'USD' } });
    expect(shiftCash.map((c) => c.type)).toEqual(['SALE_CASH']);
  });
});

describe('FEFO allocation', () => {
  it('takes the earliest expiry first and spills into the next batch', async () => {
    const w = await world();
    const later = await stock(w, { lot: 'LATE', expiry: '2028-03-31', buckets: { available: 10 } });
    const early = await stock(w, { lot: 'EARLY', expiry: '2027-01-31', buckets: { available: 5 } });
    const made = dataOf(await act(w.cashier, saleActions.create, sale(w, { lines: [{ productId: w.p.id, unitId: w.p.tablet, qty: 8 }], payments: [cash(800n)] })));
    const allocations = await prisma().phSaleLineAllocation.findMany({ where: { saleLine: { saleId: made.id } }, orderBy: { baseQty: 'desc' } });
    expect(allocations.map((x) => [x.batchId, x.baseQty])).toEqual([[early, 5], [later, 3]]);
    expect(await avail(early, w.b1)).toBe(0);
    expect(await avail(later, w.b1)).toBe(7);
    expect(await prisma().phStockMovement.count({ where: { type: 'SALE', refType: 'sale' } })).toBe(2);
  });

  it('treats a month expiry as sellable to the month end and orders it by that date', async () => {
    const w = await world();
    const month = await stock(w, { lot: 'MONTH', expiry: '2026-10-31', buckets: { available: 3 } });
    await prisma().phBatch.update({ where: { id: month }, data: { expiryPrecision: 'MONTH' } });
    const expiredMonth = await stock(w, { lot: 'GONE', expiry: '2026-09-30', buckets: { available: 50 } });
    await prisma().phBatch.update({ where: { id: expiredMonth }, data: { expiryPrecision: 'MONTH' } });
    const next = await stock(w, { lot: 'NEXT', expiry: '2026-12-31', buckets: { available: 5 } });
    dataOf(await act(w.cashier, saleActions.create, sale(w, { lines: [{ productId: w.p.id, unitId: w.p.tablet, qty: 4 }], payments: [cash(400n)] })));
    expect(await avail(month, w.b1)).toBe(0);
    expect(await avail(next, w.b1)).toBe(4);
    expect(await avail(expiredMonth, w.b1)).toBe(50);
  });

  it('sells on the expiry day itself and never the day after', async () => {
    const w = await world();
    await stock(w, { lot: 'TODAY', expiry: '2026-10-27', buckets: { available: 2 } });
    dataOf(await act(w.cashier, saleActions.create, sale(w, { lines: [{ productId: w.p.id, unitId: w.p.tablet, qty: 2 }], payments: [cash(200n)] })));
    vi.setSystemTime(new Date(NOW.getTime() + DAY));
    await stock(w, { lot: 'OTHER', expiry: '2026-10-27', buckets: { available: 2 } });
    const r = await act(w.cashier, saleActions.create, sale(w));
    expect(phCodeOf(r)).toBe('INSUFFICIENT_STOCK');
  });

  it('never allocates expired, recalled, blocked, quarantined, reserved or damaged stock, or another branch’s', async () => {
    const w = await world();
    await stock(w, { lot: 'OLD', expiry: '2026-10-26', buckets: { available: 10 } });
    await stock(w, { lot: 'RECALL', status: 'RECALLED', buckets: { available: 10 } });
    await stock(w, { lot: 'BLOCK', status: 'BLOCKED', buckets: { available: 10 } });
    await stock(w, { lot: 'OTHERBRANCH', branchId: w.b2, buckets: { available: 10 } });
    await stock(w, { lot: 'MIXED', buckets: { available: 1, reserved: 10, quarantine: 10, damaged: 10 } });
    const before = await counts();
    const r = await act(w.cashier, saleActions.create, sale(w, { lines: [{ productId: w.p.id, unitId: w.p.tablet, qty: 2 }], payments: [cash(200n)] }));
    expect([codeOf(r), phCodeOf(r)]).toEqual(['CONFLICT', 'INSUFFICIENT_STOCK']);
    expect(await counts()).toEqual(before);
    dataOf(await act(w.cashier, saleActions.create, sale(w)));
  });

  it('a shortfall refuses the whole sale, names the product and what is there, and writes nothing', async () => {
    const w = await world();
    const other = await makeProduct(w.a.id, 'Brufen');
    await price(w.a.id, other, null, 'IQD', 50n, 450n);
    const batch = await stock(w, { buckets: { available: 5 } });
    const otherBatch = await stock(w, { productId: other.id, lot: 'B1', buckets: { available: 100 } });
    const before = await counts();
    const r = await act(w.cashier, saleActions.create, sale(w, {
      lines: [{ productId: other.id, unitId: other.tablet, qty: 3 }, { productId: w.p.id, unitId: w.p.tablet, qty: 6 }],
      payments: [cash(750n)],
    }));
    expect([codeOf(r), phCodeOf(r)]).toEqual(['CONFLICT', 'INSUFFICIENT_STOCK']);
    const fields = r.ok ? {} : r.error.fields;
    expect(fields).toMatchObject({ productName: 'Panadol', available: '5' });
    expect(await counts()).toEqual(before);
    expect(await avail(batch, w.b1)).toBe(5);
    expect(await avail(otherBatch, w.b1)).toBe(100);
  });

  it('the lines of one sale share the stock: two lines of one product cannot take the same units twice', async () => {
    const w = await world();
    const batch = await stock(w, { buckets: { available: 5 } });
    const r = await act(w.cashier, saleActions.create, sale(w, { lines: [{ productId: w.p.id, unitId: w.p.tablet, qty: 3 }, { productId: w.p.id, unitId: w.p.tablet, qty: 3 }], payments: [cash(600n)] }));
    expect(phCodeOf(r)).toBe('INSUFFICIENT_STOCK');
    expect(await avail(batch, w.b1)).toBe(5);
    dataOf(await act(w.cashier, saleActions.create, sale(w, { lines: [{ productId: w.p.id, unitId: w.p.tablet, qty: 3 }, { productId: w.p.id, unitId: w.p.tablet, qty: 2 }], payments: [cash(500n)] })));
    expect(await avail(batch, w.b1)).toBe(0);
  });

  it('records the cost of what was taken, floored per allocation, only for a batch that has a cost', async () => {
    const w = await world();
    const costed = await stock(w, { lot: 'COST', expiry: '2027-01-31', buckets: { available: 3 }, cost: { unitCostMinor: 705n, costUnitId: w.p.strip } });
    await stock(w, { lot: 'FREE', expiry: '2028-03-31', buckets: { available: 10 } });
    const made = dataOf(await act(w.cashier, saleActions.create, sale(w, { lines: [{ productId: w.p.id, unitId: w.p.tablet, qty: 5 }], payments: [cash(500n)] })));
    const allocations = await prisma().phSaleLineAllocation.findMany({ where: { saleLine: { saleId: made.id } }, orderBy: { baseQty: 'desc' } });
    // 705 per strip of 10: 3 tablets = 2115 / 10 = 211 (floor); the uncosted batch has no snapshot.
    expect(allocations.map((x) => [x.batchId === costed, x.baseQty, x.costSnapshotMinor, x.costCurrency])).toEqual([
      [true, 3, 211n, 'IQD'],
      [false, 2, null, null],
    ]);
  });
});

describe('batch override', () => {
  it('needs batch.override and a reason, and takes the chosen batch instead of FEFO', async () => {
    const w = await world();
    const early = await stock(w, { lot: 'EARLY', expiry: '2027-01-31', buckets: { available: 10 } });
    const late = await stock(w, { lot: 'LATE', expiry: '2028-03-31', buckets: { available: 10 } });
    const line = { productId: w.p.id, unitId: w.p.tablet, qty: 2, batchId: late };
    const denied = await act(w.cashier, saleActions.create, sale(w, { lines: [{ ...line, batchReason: 'customer asked' }], payments: [cash(200n)] }));
    expect([codeOf(denied), phCodeOf(denied)]).toEqual(['FORBIDDEN', 'BATCH_OVERRIDE_NOT_ALLOWED']);
    const noReason = await act(w.manager, saleActions.create, sale(w, { lines: [line], payments: [cash(200n)] }));
    expect(codeOf(noReason)).toBe('INVALID');
    expect(noReason.ok ? null : noReason.error.fields).toHaveProperty('lines.0.batchReason');
    expect((await counts()).sales).toBe(0);

    const made = dataOf(await act(w.manager, saleActions.create, sale(w, { lines: [{ ...line, batchReason: 'customer asked' }], payments: [cash(200n)] })));
    expect(made.status).toBe('COMPLETED');
    expect(await avail(late, w.b1)).toBe(8);
    expect(await avail(early, w.b1)).toBe(10);
    expect((await prisma().phStockMovement.findFirstOrThrow({ where: { type: 'SALE' } })).reason).toBe('customer asked');
  });

  it('serves batch overrides before FEFO lines, so an override is not starved by an earlier FEFO line', async () => {
    const w = await world();
    const early = await stock(w, { lot: 'EARLY', expiry: '2027-01-31', buckets: { available: 5 } });
    const late = await stock(w, { lot: 'LATE', expiry: '2028-03-31', buckets: { available: 5 } });
    dataOf(await act(w.manager, saleActions.create, sale(w, {
      lines: [{ productId: w.p.id, unitId: w.p.tablet, qty: 5 }, { productId: w.p.id, unitId: w.p.tablet, qty: 5, batchId: early, batchReason: 'asked for it' }],
      payments: [cash(1000n)],
    })));
    expect(await avail(early, w.b1)).toBe(0);
    expect(await avail(late, w.b1)).toBe(0);
  });

  it('refuses a batch of another product, an unsellable batch and one that cannot cover the quantity', async () => {
    const w = await world();
    const other = await makeProduct(w.a.id, 'Brufen');
    const otherBatch = await stock(w, { productId: other.id, lot: 'B1' });
    const expired = await stock(w, { lot: 'OLD', expiry: '2026-10-26' });
    const recalled = await stock(w, { lot: 'RC', status: 'RECALLED' });
    const small = await stock(w, { lot: 'SMALL', buckets: { available: 1 } });
    const attempt = (batchId: string, qty = 1) =>
      act(w.manager, saleActions.create, sale(w, { lines: [{ productId: w.p.id, unitId: w.p.tablet, qty, batchId, batchReason: 'because' }], payments: [cash(BigInt(100 * qty))] }));
    expect([await codeOf(await attempt(otherBatch))]).toEqual(['INVALID']);
    expect(phCodeOf(await attempt(expired))).toBe('BATCH_EXPIRED');
    expect(phCodeOf(await attempt(recalled))).toBe('BATCH_NOT_ACTIVE');
    expect(phCodeOf(await attempt(small, 2))).toBe('INSUFFICIENT_STOCK');
    expect(codeOf(await attempt('nonexistent-batch-id'))).toBe('INVALID');
    expect((await counts()).sales).toBe(0);
  });
});

describe('prescription levels', () => {
  it('RX needs a seller with rx.dispense and stores the pharmacist on the line and the sale', async () => {
    const w = await world();
    await stock(w);
    await prisma().phProduct.update({ where: { id: w.p.id }, data: { rxLevel: 'RX' } });
    const denied = await act(w.cashier, saleActions.create, sale(w));
    expect([codeOf(denied), phCodeOf(denied)]).toEqual(['INVALID', 'RX_NEEDS_PHARMACIST']);
    expect((await counts()).sales).toBe(0);
    const made = dataOf(await act(w.pharmacist, saleActions.create, sale(w)));
    const row = await prisma().phSale.findUniqueOrThrow({ where: { id: made.id }, include: { lines: true } });
    expect(row.pharmacistId).toBe(w.pharmacist.userId);
    expect(row.lines[0]).toMatchObject({ rxLevel: 'RX', pharmacistId: w.pharmacist.userId });
    expect(codeOf(await act(w.owner, saleActions.create, sale(w)))).toBe('OK');
  });

  it('OTC lines carry no pharmacist even when a pharmacist sells', async () => {
    const w = await world();
    await stock(w);
    const made = dataOf(await act(w.pharmacist, saleActions.create, sale(w)));
    const row = await prisma().phSale.findUniqueOrThrow({ where: { id: made.id }, include: { lines: true } });
    expect(row.pharmacistId).toBeNull();
    expect(row.lines[0]!.pharmacistId).toBeNull();
  });

  it('RESTRICTED cannot be sold by anyone in this phase', async () => {
    const w = await world();
    await stock(w);
    await prisma().phProduct.update({ where: { id: w.p.id }, data: { rxLevel: 'RESTRICTED' } });
    for (const who of [w.owner, w.pharmacist, w.manager]) {
      const r = await act(who, saleActions.create, sale(w));
      expect([codeOf(r), phCodeOf(r)]).toEqual(['CONFLICT', 'RESTRICTED_NOT_AVAILABLE']);
    }
    expect((await counts()).sales).toBe(0);
  });
});

describe('catalog checks', () => {
  it('refuses an archived product, a unit of another product, a unit that is not sellable and ids of another business', async () => {
    const w = await world();
    await stock(w);
    const other = await makeProduct(w.a.id, 'Brufen');
    const bad = async (lines: unknown[], field: string) => {
      const r = await act(w.cashier, saleActions.create, sale(w, { lines }));
      expect(codeOf(r), field).toBe('INVALID');
      expect(r.ok ? null : r.error.fields).toHaveProperty(field);
    };
    await bad([{ productId: w.p.id, unitId: other.tablet, qty: 1 }], 'lines.0.unitId');
    await prisma().phProductUnit.update({ where: { id: w.p.strip }, data: { sellable: false } });
    await bad([{ productId: w.p.id, unitId: w.p.strip, qty: 1 }], 'lines.0.unitId');
    await prisma().phProduct.update({ where: { id: other.id }, data: { active: false } });
    await bad([{ productId: other.id, unitId: other.tablet, qty: 1 }], 'lines.0.productId');
    const b = await pharmacy('B');
    const bProduct = await makeProduct(b.id, 'Foreign');
    await bad([{ productId: bProduct.id, unitId: bProduct.tablet, qty: 1 }], 'lines.0.productId');
    await bad([{ productId: w.p.id, unitId: w.p.tablet, qty: 0 }], 'lines.0.qty');
    await bad([{ productId: w.p.id, unitId: w.p.tablet, qty: 1.5 }], 'lines.0.qty');
    expect((await counts()).sales).toBe(0);
  });

  it('refuses a batch of another business', async () => {
    const w = await world();
    await stock(w);
    const b = await pharmacy('B');
    const bProduct = await makeProduct(b.id, 'Foreign');
    const bBatch = await makeBatch(b.id, b.branchId, bProduct.id, { buckets: { available: 5 } });
    const r = await act(w.manager, saleActions.create, sale(w, { lines: [{ productId: w.p.id, unitId: w.p.tablet, qty: 1, batchId: bBatch, batchReason: 'because' }] }));
    expect(codeOf(r)).toBe('INVALID');
    expect(await avail(bBatch, b.branchId)).toBe(5);
  });
});

describe('prices', () => {
  it('uses the branch price in its branch and the business-wide price elsewhere, and records the row used', async () => {
    const w = await world();
    await stock(w);
    await stock(w, { branchId: w.b2, lot: 'L2' });
    const branchRow = await prisma().phPrice.create({
      data: { restaurantId: w.a.id, productId: w.p.id, unitId: w.p.tablet, branchId: w.b1, currency: 'IQD', amountMinor: 120n, validFrom: new Date('2026-06-01T00:00:00.000Z'), changedById: 'seed' },
    });
    const one = dataOf(await act(w.cashier, saleActions.create, sale(w, { payments: [cash(120n)] })));
    const two = dataOf(await act(w.owner, saleActions.create, sale(w, { branchId: w.b2 })));
    expect([one.totalMinor, two.totalMinor]).toEqual(['120', '100']);
    const lineOne = await prisma().phSaleLine.findFirstOrThrow({ where: { saleId: one.id } });
    expect(lineOne.priceId).toBe(branchRow.id);
  });

  it('ignores a price that is not valid yet or has ended', async () => {
    const w = await world();
    await stock(w);
    await prisma().phPrice.updateMany({ data: { validTo: new Date('2026-10-01T00:00:00.000Z') } });
    const r = await act(w.cashier, saleActions.create, sale(w));
    expect([codeOf(r), phCodeOf(r)]).toEqual(['INVALID', 'NO_PRICE']);
  });

  it('a unit with no price in the sale currency cannot be sold and the answer names the product', async () => {
    const w = await world();
    await stock(w);
    const other = await makeProduct(w.a.id, 'Brufen');
    await stock(w, { productId: other.id, lot: 'B1' });
    const r = await act(w.cashier, saleActions.create, sale(w, { lines: [{ productId: w.p.id, unitId: w.p.tablet, qty: 1 }, { productId: other.id, unitId: other.tablet, qty: 1 }] }));
    expect([codeOf(r), phCodeOf(r)]).toEqual(['INVALID', 'NO_PRICE']);
    expect(r.ok ? null : r.error.fields).toMatchObject({ productName: 'Brufen', 'lines.1.unitId': expect.any(String) });
    expect((await counts()).sales).toBe(0);
  });

  it('a price override needs price.change and a reason, and is recorded on the line', async () => {
    const w = await world();
    await stock(w);
    const line = (extra: Record<string, unknown>) => [{ productId: w.p.id, unitId: w.p.tablet, qty: 2, unitPriceMinor: 80n, ...extra }];
    const denied = await act(w.cashier, saleActions.create, sale(w, { lines: line({ priceOverrideReason: 'regular customer' }), payments: [cash(160n)] }));
    expect([codeOf(denied), phCodeOf(denied)]).toEqual(['FORBIDDEN', 'PRICE_OVERRIDE_NOT_ALLOWED']);
    const noReason = await act(w.manager, saleActions.create, sale(w, { lines: line({}), payments: [cash(160n)] }));
    expect(codeOf(noReason)).toBe('INVALID');
    expect(noReason.ok ? null : noReason.error.fields).toHaveProperty('lines.0.priceOverrideReason');
    expect((await counts()).sales).toBe(0);
    const made = dataOf(await act(w.manager, saleActions.create, sale(w, { lines: line({ priceOverrideReason: 'regular customer' }), payments: [cash(160n)] })));
    expect(made.totalMinor).toBe('160');
    expect(await prisma().phSaleLine.findFirstOrThrow({ where: { saleId: made.id } })).toMatchObject({ unitPriceMinor: 80n, priceOverrideReason: 'regular customer' });
  });

  it('a price equal to the list price is not an override', async () => {
    const w = await world();
    await stock(w);
    const made = dataOf(await act(w.cashier, saleActions.create, sale(w, { lines: [{ productId: w.p.id, unitId: w.p.tablet, qty: 1, unitPriceMinor: 100n }] })));
    expect(made.totalMinor).toBe('100');
  });

  it('an override only replaces an existing price: a unit with no list price cannot be sold even by a price.change holder', async () => {
    const w = await world();
    await stock(w);
    await prisma().phPrice.deleteMany();
    const r = await act(w.manager, saleActions.create, sale(w, { lines: [{ productId: w.p.id, unitId: w.p.tablet, qty: 1, unitPriceMinor: 90n, priceOverrideReason: 'no list price' }], payments: [cash(90n)] }));
    expect([codeOf(r), phCodeOf(r)]).toEqual(['INVALID', 'NO_PRICE']);
    expect((await counts()).sales).toBe(0);
  });
});

describe('discounts', () => {
  const tens = (w: World, extra: Record<string, unknown> = {}) => ({ lines: [{ productId: w.p.id, unitId: w.p.tablet, qty: 10, ...extra }] });

  it('a line discount within the limit is applied and stored on the line', async () => {
    const w = await world();
    await stock(w);
    const made = dataOf(await act(w.cashier, saleActions.create, sale(w, { ...tens(w, { discount: { kind: 'percent', value: 5 } }), payments: [cash(950n)] })));
    expect(made).toMatchObject({ subtotalMinor: '1000', discountMinor: '50', totalMinor: '950' });
    expect(await prisma().phSaleLine.findFirstOrThrow({ where: { saleId: made.id } })).toMatchObject({ discountMinor: 50n, totalMinor: 950n });
  });

  it('an amount discount works and one larger than the line is refused', async () => {
    const w = await world();
    await stock(w);
    const made = dataOf(await act(w.cashier, saleActions.create, sale(w, { ...tens(w, { discount: { kind: 'amount', value: 30n } }), payments: [cash(970n)] })));
    expect(made.totalMinor).toBe('970');
    const r = await act(w.manager, saleActions.create, sale(w, { ...tens(w, { discount: { kind: 'amount', value: 5000n, reason: 'too big' } }), payments: [cash(1n)] }));
    expect(codeOf(r)).toBe('INVALID');
  });

  it('judges the combined line and invoice discount: 5% and 5% is over a 5% limit', async () => {
    const w = await world();
    await stock(w);
    const both = (reasons: boolean) =>
      sale(w, {
        ...tens(w, { discount: { kind: 'percent', value: 5, ...(reasons ? { reason: 'loyal customer' } : {}) } }),
        invoiceDiscount: { kind: 'percent', value: 5, ...(reasons ? { reason: 'promotion' } : {}) },
        payments: [cash(903n)],
      });
    // Each half alone is fine for a cashier.
    dataOf(await act(w.cashier, saleActions.create, sale(w, { ...tens(w), invoiceDiscount: { kind: 'percent', value: 5 }, payments: [cash(950n)] })));
    const cashierBoth = await act(w.cashier, saleActions.create, both(true));
    expect([codeOf(cashierBoth), phCodeOf(cashierBoth)]).toEqual(['FORBIDDEN', 'DISCOUNT_OVER_LIMIT']);
    const noReasons = await act(w.manager, saleActions.create, both(false));
    expect([codeOf(noReasons), phCodeOf(noReasons)]).toEqual(['INVALID', 'DISCOUNT_REASON_REQUIRED']);
    const before = await counts();
    const made = dataOf(await act(w.manager, saleActions.create, both(true)));
    expect(made).toMatchObject({ subtotalMinor: '1000', discountMinor: '97', totalMinor: '903' });
    const line = await prisma().phSaleLine.findFirstOrThrow({ where: { saleId: made.id } });
    expect(line).toMatchObject({ discountMinor: 97n, totalMinor: 903n });
    expect(line.discountReason).toContain('loyal customer');
    expect(line.discountReason).toContain('promotion');
    expect((await counts()).sales).toBe(before.sales + 1);
  });

  it('shares an invoice discount over the lines by largest remainder so the lines add up exactly', async () => {
    const w = await world();
    await stock(w);
    const made = dataOf(
      await act(w.manager, saleActions.create, sale(w, {
        lines: [{ productId: w.p.id, unitId: w.p.tablet, qty: 10 }, { productId: w.p.id, unitId: w.p.strip, qty: 1 }],
        invoiceDiscount: { kind: 'amount', value: 100n, reason: 'bulk' },
        payments: [cash(1800n)],
      })),
    );
    expect(made).toMatchObject({ subtotalMinor: '1900', discountMinor: '100', totalMinor: '1800' });
    const lines = await prisma().phSaleLine.findMany({ where: { saleId: made.id }, orderBy: { lineNo: 'asc' } });
    expect(lines.map((l) => [l.discountMinor, l.totalMinor])).toEqual([[53n, 947n], [47n, 853n]]);
  });

  it('an invoice discount larger than the sale is refused', async () => {
    const w = await world();
    await stock(w);
    const r = await act(w.manager, saleActions.create, sale(w, { invoiceDiscount: { kind: 'amount', value: 101n, reason: 'too much' }, payments: [cash(1n)] }));
    expect(codeOf(r)).toBe('INVALID');
    expect((await counts()).sales).toBe(0);
  });
});

describe('rounding and payments', () => {
  it('rounds an IQD invoice to the configured step and stores the signed difference', async () => {
    const w = await world();
    await stock(w);
    await prisma().phSettings.update({ where: { restaurantId: w.a.id }, data: { roundingStepMinor: 250n } });
    const made = dataOf(await act(w.cashier, saleActions.create, sale(w, { lines: [{ productId: w.p.id, unitId: w.p.tablet, qty: 3 }], payments: [cash(250n)] })));
    expect(made).toMatchObject({ subtotalMinor: '300', roundingMinor: '-50', totalMinor: '250', paidMinor: '250', changeMinor: '0' });
    const lineRow = await prisma().phSaleLine.findFirstOrThrow({ where: { saleId: made.id } });
    expect(lineRow.totalMinor).toBe(300n);
    const short = await act(w.cashier, saleActions.create, sale(w, { lines: [{ productId: w.p.id, unitId: w.p.tablet, qty: 3 }], payments: [cash(200n)] }));
    expect(phCodeOf(short)).toBe('PAYMENT_SHORT');
    // The refusal carries the total the server computed, so the screen can show it next to its own estimate.
    expect(short.ok ? '' : short.error.fields?.totalMinor).toBe('250');
  });

  it('never rounds a positive total down to zero: it rounds up to one step', async () => {
    const w = await world();
    await stock(w);
    await prisma().phSettings.update({ where: { restaurantId: w.a.id }, data: { roundingStepMinor: 250n } });
    const made = dataOf(await act(w.cashier, saleActions.create, sale(w, { payments: [cash(250n)] })));
    expect(made).toMatchObject({ subtotalMinor: '100', roundingMinor: '150', totalMinor: '250' });
  });

  it('refuses sales when the rounding setting is not an allowed step', async () => {
    const w = await world();
    await stock(w);
    await prisma().phSettings.update({ where: { restaurantId: w.a.id }, data: { roundingStepMinor: 7n } });
    const r = await act(w.cashier, saleActions.create, sale(w));
    expect([codeOf(r), phCodeOf(r)]).toEqual(['CONFLICT', 'ROUNDING_SETTING_INVALID']);
  });

  it('works with the defaults when the business has no settings row', async () => {
    const w = await world();
    await stock(w);
    await prisma().phSettings.delete({ where: { restaurantId: w.a.id } });
    expect(codeOf(await act(w.cashier, saleActions.create, sale(w)))).toBe('OK');
  });

  it('refuses payments that do not settle the total', async () => {
    const w = await world();
    await stock(w);
    const pay = (payments: unknown[]) => act(w.cashier, saleActions.create, sale(w, { payments }));
    const card = (amountMinor: bigint) => ({ method: 'CARD_MANUAL', amountMinor, clientKey: key('pay'), reference: 'slip 1' });
    expect(phCodeOf(await pay([cash(50n)]))).toBe('PAYMENT_SHORT');
    expect(phCodeOf(await pay([]))).toBe('PAYMENT_SHORT');
    expect(phCodeOf(await pay([card(150n)]))).toBe('PAYMENT_NON_CASH_OVERPAY');
    expect(phCodeOf(await pay([card(100n), cash(50n)]))).toBe('PAYMENT_CASH_NOT_NEEDED');
    expect(codeOf(await pay([cash(0n)]))).toBe('INVALID');
    expect(codeOf(await pay([{ method: 'CRYPTO', amountMinor: 100n, clientKey: key('pay') }]))).toBe('INVALID');
    expect((await counts()).sales).toBe(0);
  });

  it('a card payment is exact and moves no cash; a split gives change from the cash part only', async () => {
    const w = await world();
    await stock(w);
    const cardOnly = dataOf(await act(w.cashier, saleActions.create, sale(w, { payments: [{ method: 'TRANSFER_MANUAL', amountMinor: 100n, clientKey: key('pay'), reference: 'ref-77' }] })));
    expect(await prisma().phCashMovement.count()).toBe(0);
    expect((await prisma().phPayment.findFirstOrThrow({ where: { saleId: cardOnly.id } })).reference).toBe('ref-77');
    const split = dataOf(
      await act(w.cashier, saleActions.create, sale(w, {
        lines: [{ productId: w.p.id, unitId: w.p.tablet, qty: 10 }],
        payments: [{ method: 'CARD_MANUAL', amountMinor: 600n, clientKey: key('pay') }, cash(500n)],
      })),
    );
    expect(split).toMatchObject({ totalMinor: '1000', paidMinor: '1100', changeMinor: '100' });
    const rows = await prisma().phCashMovement.findMany({ orderBy: { amountMinor: 'desc' } });
    expect(rows.map((c) => [c.type, c.amountMinor])).toEqual([['SALE_CASH', 500n], ['CHANGE_OUT', -100n]]);
    expect(await prisma().phPayment.count({ where: { saleId: split.id } })).toBe(2);
  });

  it('a fully discounted sale needs no payment', async () => {
    const w = await world();
    await stock(w);
    const made = dataOf(await act(w.manager, saleActions.create, sale(w, { lines: [{ productId: w.p.id, unitId: w.p.tablet, qty: 1, discount: { kind: 'percent', value: 100, reason: 'gift' } }], payments: [] })));
    expect(made).toMatchObject({ totalMinor: '0', paidMinor: '0', changeMinor: '0', status: 'COMPLETED' });
  });

  it('keeps big totals exact and refuses a line above the sanity cap', async () => {
    const w = await world();
    await stock(w);
    const big = 100_000_000_000_000n;
    const line = (price: bigint) => ({ lines: [{ productId: w.p.id, unitId: w.p.tablet, qty: 9, unitPriceMinor: price, priceOverrideReason: 'big sale' }] });
    const made = dataOf(await act(w.manager, saleActions.create, sale(w, { ...line(big), payments: [cash(900_000_000_000_000n)] })));
    expect(made).toMatchObject({ subtotalMinor: '900000000000000', totalMinor: '900000000000000', paidMinor: '900000000000000', changeMinor: '0' });
    expect((await prisma().phSale.findUniqueOrThrow({ where: { id: made.id } })).totalMinor).toBe(900_000_000_000_000n);
    const over = await act(w.manager, saleActions.create, sale(w, { ...line(big * 2n), payments: [cash(1n)] }));
    expect(codeOf(over)).toBe('INVALID');
  });
});

describe('concurrency', () => {
  it('ten parallel sales of the last unit: exactly one succeeds, the rest are told there is no stock, stock is never negative', async () => {
    const w = await world();
    const batch = await stock(w, { buckets: { available: 1 } });
    const results = await Promise.all(Array.from({ length: 10 }, () => act(w.cashier, saleActions.create, sale(w))));
    const ok = results.filter((r) => r.ok);
    expect(ok).toHaveLength(1);
    for (const r of results.filter((x) => !x.ok)) expect([codeOf(r), phCodeOf(r)]).toEqual(['CONFLICT', 'INSUFFICIENT_STOCK']);
    expect(await avail(batch, w.b1)).toBe(0);
    expect(await counts()).toMatchObject({ sales: 1, payments: 1, allocations: 1, cash: 1, audit: 1 });
    expect(await prisma().phStockMovement.count({ where: { type: 'SALE' } })).toBe(1);
  });

  it('parallel sales of different units from the same batches both finish (no deadlock) with distinct numbers', async () => {
    const w = await world();
    const other = await makeProduct(w.a.id, 'Brufen');
    await price(w.a.id, other, null, 'IQD', 50n, 450n);
    const b1 = await stock(w, { buckets: { available: 50 } });
    const b2 = await stock(w, { productId: other.id, lot: 'B1', buckets: { available: 50 } });
    const one = (who: Person, order: 'ab' | 'ba') => {
      const a = { productId: w.p.id, unitId: w.p.tablet, qty: 2 };
      const b = { productId: other.id, unitId: other.tablet, qty: 3 };
      return act(who, saleActions.create, sale(w, { lines: order === 'ab' ? [a, b] : [b, a], payments: [cash(350n)] }));
    };
    const results = await Promise.all([one(w.cashier, 'ab'), one(w.manager, 'ba'), one(w.owner, 'ab'), one(w.pharmacist, 'ba'), one(w.cashier, 'ba'), one(w.manager, 'ab')]);
    const numbers = results.map((r) => dataOf(r).number);
    expect(new Set(numbers).size).toBe(6);
    expect(await avail(b1, w.b1)).toBe(50 - 12);
    expect(await avail(b2, w.b1)).toBe(50 - 18);
  }, 60_000);
});

describe('branch and business limits', () => {
  it('a person limited to branch 1 cannot sell in branch 2 or read its sales', async () => {
    const w = await world();
    await stock(w, { branchId: w.b2, lot: 'L2' });
    const r = await act(w.cashier, saleActions.create, sale(w, { branchId: w.b2 }));
    expect(['FORBIDDEN', 'NOT_FOUND']).toContain(codeOf(r));
    const made = dataOf(await act(w.owner, saleActions.create, sale(w, { branchId: w.b2 })));
    const read = await ask(w.cashier, saleQueries.get, { restaurantId: w.a.id, branchId: w.b1, saleId: made.id });
    expect(codeOf(read)).toBe('NOT_FOUND');
    const listed = await ask(w.manager, saleQueries.list, { restaurantId: w.a.id });
    expect(JSON.stringify(dataOf(listed))).not.toContain(made.id);
  });

  it('another business’s person cannot sell here', async () => {
    const w = await world();
    await stock(w);
    const b = await pharmacy('B');
    const outsider = await person('outsider', { membership: [b.id, 'OWNER'] });
    const r = await act(outsider, saleActions.create, sale(w));
    expect(['FORBIDDEN', 'NOT_FOUND']).toContain(codeOf(r));
    expect((await counts()).sales).toBe(0);
  });

  it('a support actor with no role cannot sell', async () => {
    const w = await world();
    await stock(w);
    const staff = await person('support', { superAdmin: true });
    const r = await act(staff, saleActions.create, sale(w));
    expect(['FORBIDDEN', 'NOT_FOUND']).toContain(codeOf(r));
  });
});

describe('reading sales', () => {
  async function made(w: World) {
    const cost = { unitCostMinor: 705n, costUnitId: w.p.strip };
    const batch = await stock(w, { cost });
    const first = dataOf(await act(w.cashier, saleActions.create, sale(w, { lines: [{ productId: w.p.id, unitId: w.p.tablet, qty: 3 }], payments: [cash(300n)] })));
    return { batch, first };
  }

  it('returns lines, allocations with lot and expiry, payments and status; cost only with cost.view', async () => {
    const w = await world();
    const { batch, first } = await made(w);
    const place = { restaurantId: w.a.id, branchId: w.b1, saleId: first.id };
    const asCashier = dataOf(await ask(w.cashier, saleQueries.get, place));
    expect(asCashier).toMatchObject({ id: first.id, number: first.number, status: 'COMPLETED', currency: 'IQD', totalMinor: '300', paidMinor: '300', branchId: w.b1 });
    expect(asCashier.lines[0]).toMatchObject({ lineNo: 1, productName: 'Panadol', unitLabel: 'tablet', qty: 3, baseQty: 3, unitPriceMinor: '100', totalMinor: '300' });
    expect(asCashier.lines[0]!.allocations[0]).toMatchObject({ batchId: batch, lot: 'L1', expiryDate: '2028-03-31', baseQty: 3 });
    expect(asCashier.payments[0]).toMatchObject({ method: 'CASH', amountMinor: '300' });
    expect(JSON.stringify(asCashier)).not.toMatch(/cost/i);
    const asOwner = dataOf(await ask(w.owner, saleQueries.get, place));
    expect(asOwner.lines[0]!.allocations[0]).toMatchObject({ costSnapshotMinor: '211', costCurrency: 'IQD' });
  });

  it('never returns cost from the create answer, the list or for a role without cost.view', async () => {
    const w = await world();
    const { first } = await made(w);
    expect(JSON.stringify(first)).not.toMatch(/cost/i);
    const listed = dataOf(await ask(w.manager, saleQueries.list, { restaurantId: w.a.id, branchId: w.b1 }));
    expect(JSON.stringify(listed)).not.toMatch(/cost/i);
    // The accountant holds cost.view, so the key is there for that role.
    const accountant = await person('accountant2', { staff: [w.a.id, 'ACCOUNTANT', [w.b1]] });
    const read = dataOf(await ask(accountant, saleQueries.get, { restaurantId: w.a.id, branchId: w.b1, saleId: first.id }));
    expect(read.lines[0]!.allocations[0]).toHaveProperty('costSnapshotMinor');
  });

  it('shift.use holders see sales of their own open shift only; report.view holders see the whole branch', async () => {
    const w = await world();
    await stock(w);
    const mine = dataOf(await act(w.cashier, saleActions.create, sale(w)));
    const theirs = dataOf(await act(w.pharmacist, saleActions.create, sale(w)));
    const place = { restaurantId: w.a.id, branchId: w.b1 };
    const cashierList = dataOf(await ask(w.cashier, saleQueries.list, place));
    expect(cashierList.items.map((s) => s.id)).toEqual([mine.id]);
    expect(codeOf(await ask(w.cashier, saleQueries.get, { ...place, saleId: theirs.id }))).toBe('NOT_FOUND');
    const managerList = dataOf(await ask(w.manager, saleQueries.list, place));
    expect(managerList.items.map((s) => s.id).sort()).toEqual([mine.id, theirs.id].sort());
    expect(codeOf(await ask(w.manager, saleQueries.get, { ...place, saleId: theirs.id }))).toBe('OK');
    // Once the cashier's shift closes the cashier no longer sees that sale.
    await prisma().phShift.updateMany({ where: { userId: w.cashier.userId }, data: { status: 'CLOSED', closedAt: NOW, countedMinor: 100n, expectedMinor: 100n, varianceMinor: 0n } });
    expect(dataOf(await ask(w.cashier, saleQueries.list, place)).items).toEqual([]);
    expect(codeOf(await ask(w.cashier, saleQueries.get, { ...place, saleId: mine.id }))).toBe('NOT_FOUND');
    expect(codeOf(await ask(w.manager, saleQueries.get, { ...place, saleId: mine.id }))).toBe('OK');
  });

  it('lists newest first with a cursor and filters by number, status and dates', async () => {
    const w = await world();
    await stock(w);
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      vi.setSystemTime(new Date(NOW.getTime() + i * 60_000));
      ids.push(dataOf(await act(w.cashier, saleActions.create, sale(w))).id);
    }
    const place = { restaurantId: w.a.id, branchId: w.b1 };
    const page1 = dataOf(await ask(w.manager, saleQueries.list, { ...place, pageSize: 2 }));
    expect(page1.items.map((s) => s.id)).toEqual([ids[2], ids[1]]);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = dataOf(await ask(w.manager, saleQueries.list, { ...place, pageSize: 2, cursor: page1.nextCursor }));
    expect(page2.items.map((s) => s.id)).toEqual([ids[0]]);
    expect(page2.nextCursor).toBeNull();
    const byNumber = dataOf(await ask(w.manager, saleQueries.list, { ...place, number: page1.items[1]!.number }));
    expect(byNumber.items.map((s) => s.id)).toEqual([ids[1]]);
    expect(dataOf(await ask(w.manager, saleQueries.list, { ...place, status: 'RETURNED_FULL' })).items).toEqual([]);
    expect(dataOf(await ask(w.manager, saleQueries.list, { ...place, status: 'COMPLETED' })).items).toHaveLength(3);
    const window = dataOf(await ask(w.manager, saleQueries.list, { ...place, from: new Date(NOW.getTime() + 30_000), to: new Date(NOW.getTime() + 90_000) }));
    expect(window.items.map((s) => s.id)).toEqual([ids[1]]);
  });

  it('a role with neither shift.use nor report.view reads no sales', async () => {
    const w = await world();
    await stock(w);
    const stockman = await person('stockman', { staff: [w.a.id, 'STOCK', [w.b1]] });
    const first = dataOf(await act(w.cashier, saleActions.create, sale(w)));
    expect(codeOf(await ask(stockman, saleQueries.list, { restaurantId: w.a.id, branchId: w.b1 }))).toBe('FORBIDDEN');
    expect(codeOf(await ask(stockman, saleQueries.get, { restaurantId: w.a.id, branchId: w.b1, saleId: first.id }))).toBe('FORBIDDEN');
    const accountant = await person('accountant', { staff: [w.a.id, 'ACCOUNTANT', [w.b1]] });
    expect(codeOf(await ask(accountant, saleQueries.get, { restaurantId: w.a.id, branchId: w.b1, saleId: first.id }))).toBe('OK');
  });
});
