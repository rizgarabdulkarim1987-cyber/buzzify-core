import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as printActions from '@/server/pharmacy/actions/receipt-print';
import * as returnActions from '@/server/pharmacy/actions/returns';
import * as saleActions from '@/server/pharmacy/actions/sales';
import * as printQueries from '@/server/pharmacy/queries/receipt-print';
import { NOW, person, pharmacy, prisma, resetWorld, useTestDatabase, type Person } from './fixture';
import { act, ask, codeOf, dataOf, makeBatch, makeProduct, phCodeOf } from './stock-helpers';

/**
 * Printing data (phase 3, task 6): a receipt is rendered from the stored sale, a reprint is logged and numbered and
 * idempotent by key, nothing about printing changes a sale, and no cost or customer field reaches the paper.
 * (The stock receiving tests are in receipts.test.ts; the pure builder and golden files are in receipt.test.ts.)
 */

interface World {
  a: { id: string; branchId: string; branchIds: string[] };
  b1: string;
  b2: string;
  owner: Person;
  cashier: Person;
  manager: Person;
  stock: Person;
  p: { id: string; tablet: string; strip: string };
}

let seq = 0;
const key = (label: string) => `${label}-${(seq += 1)}-${'x'.repeat(8)}`;

async function world(productName = 'Panadol'): Promise<World> {
  const a = await pharmacy('Al Noor', { branches: 2 });
  await prisma().restaurant.update({ where: { id: a.id }, data: { address: 'Karrada, Baghdad', phone: '+964 770 000 0000' } });
  const [b1, b2] = a.branchIds as [string, string];
  const owner = await person('owner', { membership: [a.id, 'OWNER'] });
  const cashier = await person('cashier', { staff: [a.id, 'CASHIER', [b1]] });
  const manager = await person('manager', { staff: [a.id, 'BRANCH_MANAGER', [b1]] });
  const stock = await person('stock', { staff: [a.id, 'STOCK', [b1]] });
  await prisma().phSettings.create({ data: { restaurantId: a.id } });
  const p = await makeProduct(a.id, productName);
  await prisma().phProduct.update({ where: { id: p.id }, data: { strength: '500 mg' } });
  for (const [unitId, amountMinor] of [[p.tablet, 100n], [p.strip, 900n]] as const) {
    await prisma().phPrice.create({ data: { restaurantId: a.id, productId: p.id, unitId, branchId: null, currency: 'IQD', amountMinor, validFrom: new Date('2026-01-01T00:00:00.000Z'), changedById: 'seed' } });
  }
  for (const who of [owner, cashier, manager]) await prisma().phShift.create({ data: { restaurantId: a.id, branchId: b1, userId: who.userId, currency: 'IQD', openingFloatMinor: 0n } });
  await prisma().phShift.create({ data: { restaurantId: a.id, branchId: b2, userId: owner.userId, currency: 'IQD', openingFloatMinor: 0n } });
  return { a, b1, b2, owner, cashier, manager, stock, p };
}

const at = (w: World, branchId = w.b1) => ({ restaurantId: w.a.id, branchId });
async function sell(w: World, over: Record<string, unknown> = {}, who: Person = w.cashier) {
  const made = dataOf(
    await act(who, saleActions.create, {
      ...at(w),
      clientKey: key('sale'),
      currency: 'IQD',
      lines: [{ productId: w.p.id, unitId: w.p.tablet, qty: 3 }],
      payments: [{ method: 'CASH', amountMinor: 500n, clientKey: key('pay') }],
      ...over,
    }),
  );
  return made as { id: string; number: string };
}
const get = (w: World, who: Person, saleId: string, over: Record<string, unknown> = {}) => ask(who, printQueries.get, { ...at(w), saleId, ...over });
const reprint = (w: World, who: Person, saleId: string, over: Record<string, unknown> = {}) => act(who, printActions.reprintReceipt, { ...at(w), saleId, clientKey: key('rp'), ...over });
type Receipt = { html: string; text: string; copyNumber: number; replayed: boolean; model: Record<string, unknown> & { total: string; copyMarker: string | null; lines: Record<string, unknown>[] } };

/** Everything a print must not touch. */
async function state() {
  return JSON.stringify(
    {
      sales: await prisma().phSale.findMany({ orderBy: { id: 'asc' } }),
      lines: await prisma().phSaleLine.findMany({ orderBy: { id: 'asc' } }),
      allocations: await prisma().phSaleLineAllocation.findMany({ orderBy: { id: 'asc' } }),
      payments: await prisma().phPayment.findMany({ orderBy: { id: 'asc' } }),
      cash: await prisma().phCashMovement.findMany({ orderBy: { id: 'asc' } }),
      balances: await prisma().phStockBalance.findMany({ orderBy: { id: 'asc' } }),
      movements: await prisma().phStockMovement.findMany({ orderBy: { id: 'asc' } }),
      returns: await prisma().phReturn.findMany({ orderBy: { id: 'asc' } }),
    },
    (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v),
  );
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

describe('the first print (ph.receipts.get)', () => {
  it('shows exactly the stored figures: 3 tablets at 100 = 300, paid 500, change 200', async () => {
    const w = await world();
    await makeBatch(w.a.id, w.b1, w.p.id, { buckets: { available: 100 } });
    const s = await sell(w);
    const r = dataOf(await get(w, w.cashier, s.id, { width: '58', locale: 'en' })) as unknown as Receipt;
    expect(r.model).toMatchObject({
      kind: 'sale',
      number: s.number,
      currency: 'IQD',
      cashier: 'cashier person',
      subtotal: '300',
      discount: null,
      rounding: null,
      total: '300',
      paid: '500',
      change: '200',
      copy: false,
      copyMarker: null,
      width: '58',
      dateUtc: '2026-10-27 09:00 UTC',
      shop: { name: 'Al Noor', address: 'Karrada, Baghdad', phone: '+964 770 000 0000' },
    });
    expect(r.model.lines).toMatchObject([{ no: 1, name: 'Panadol', strength: '500 mg', qty: '3', unit: 'tablet', unitPrice: '100', total: '300', rx: false }]);
    expect(r.model.payments).toEqual([{ method: 'CASH', label: 'Cash', amount: '500' }]);
    expect(r.html).toContain('@page { size: 58mm auto; margin: 2mm }');
    expect(r.html).toContain(s.number);
    expect(r.text).toContain('Panadol 500 mg');
    expect(r.html).not.toContain('COPY');
  });

  it('is Arabic on request, right to left, with Latin digits', async () => {
    const w = await world();
    await makeBatch(w.a.id, w.b1, w.p.id, { buckets: { available: 100 } });
    const s = await sell(w);
    const ar = dataOf(await get(w, w.cashier, s.id, { locale: 'ar' })) as unknown as Receipt;
    expect(ar.html).toContain('dir="rtl"');
    expect(ar.html).toContain('الإجمالي');
    expect(ar.model.total).toBe('300');
  });

  it('writes nothing: no reprint row, no audit, sale, payments and stock untouched', async () => {
    const w = await world();
    await makeBatch(w.a.id, w.b1, w.p.id, { buckets: { available: 100 } });
    const s = await sell(w);
    const before = await state();
    const audits = await prisma().auditLog.count();
    for (let i = 0; i < 3; i += 1) dataOf(await get(w, w.cashier, s.id));
    expect(await state()).toBe(before);
    expect(await prisma().phReceiptReprint.count()).toBe(0);
    expect(await prisma().auditLog.count()).toBe(audits);
  });

  it('can be read by a seller, a manager and the owner; a stock-only role is refused', async () => {
    const w = await world();
    await makeBatch(w.a.id, w.b1, w.p.id, { buckets: { available: 100 } });
    const s = await sell(w);
    for (const who of [w.cashier, w.manager, w.owner]) expect(codeOf(await get(w, who, s.id))).toBe('OK');
    expect(codeOf(await get(w, w.stock, s.id))).toBe('FORBIDDEN');
  });

  it('refuses a width that is not 80 or 58', async () => {
    const w = await world();
    await makeBatch(w.a.id, w.b1, w.p.id, { buckets: { available: 100 } });
    const s = await sell(w);
    expect(codeOf(await get(w, w.cashier, s.id, { width: '100' }))).toBe('INVALID');
  });
});

describe('what may be printed', () => {
  it('a sale of another branch or another business is refused, a held sale has no receipt', async () => {
    const w = await world();
    await makeBatch(w.a.id, w.b1, w.p.id, { buckets: { available: 100 } });
    const mine = await sell(w, {}, w.owner); // sold in branch 1
    const owner2Shift = await prisma().phShift.findFirstOrThrow({ where: { branchId: w.b2 } });
    const inB2 = await prisma().phSale.create({
      data: { restaurantId: w.a.id, branchId: w.b2, shiftId: owner2Shift.id, number: '20261027-000001', status: 'COMPLETED', currency: 'IQD', clientKey: key('seed'), soldById: w.owner.userId, completedAt: NOW },
      select: { id: true },
    });
    // the cashier works branch 1 only
    expect(codeOf(await get(w, w.cashier, inB2.id))).toBe('NOT_FOUND');
    expect(codeOf(await reprint(w, w.cashier, inB2.id))).toBe('NOT_FOUND');
    expect(codeOf(await get(w, w.cashier, mine.id))).toBe('OK');

    const b = await pharmacy('Rival');
    const rival = await person('rival', { membership: [b.id, 'OWNER'] });
    expect(codeOf(await ask(rival, printQueries.get, { restaurantId: w.a.id, branchId: w.b1, saleId: mine.id }))).not.toBe('OK');
    expect(codeOf(await act(rival, printActions.reprintReceipt, { restaurantId: w.a.id, branchId: w.b1, saleId: mine.id, clientKey: key('rv') }))).not.toBe('OK');
    expect(await prisma().phReceiptReprint.count()).toBe(0);

    const held = await prisma().phSale.create({
      data: { restaurantId: w.a.id, branchId: w.b1, shiftId: (await prisma().phShift.findFirstOrThrow({ where: { userId: w.cashier.userId } })).id, status: 'HELD', currency: 'IQD', clientKey: key('held'), soldById: w.cashier.userId },
      select: { id: true },
    });
    const res = await get(w, w.cashier, held.id);
    expect(codeOf(res)).toBe('CONFLICT');
    expect(phCodeOf(res)).toBe('NOT_PRINTABLE');
    expect(phCodeOf(await reprint(w, w.cashier, held.id))).toBe('NOT_PRINTABLE');
    expect(await prisma().phReceiptReprint.count()).toBe(0);
  });
});

describe('a reprint (ph.receipts.reprint)', () => {
  it('logs who, when and the width, marks the paper COPY, and numbers the copies', async () => {
    const w = await world();
    await makeBatch(w.a.id, w.b1, w.p.id, { buckets: { available: 100 } });
    const s = await sell(w);
    const first = dataOf(await reprint(w, w.manager, s.id, { width: '58', reason: 'Customer lost it' })) as unknown as Receipt;
    expect(first).toMatchObject({ copyNumber: 1, replayed: false });
    expect(first.model.copyMarker).toBe('COPY');
    expect(first.html).toContain('COPY');
    expect(first.text).toContain('*** COPY ***');
    expect(first.html).toContain('@page { size: 58mm auto; margin: 2mm }');
    const second = dataOf(await reprint(w, w.cashier, s.id, { width: '80' })) as unknown as Receipt;
    expect(second.model.copyMarker).toBe('COPY 2');
    const rows = await prisma().phReceiptReprint.findMany({ orderBy: { copyNumber: 'asc' } });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ saleId: s.id, returnId: null, userId: w.manager.userId, copyNumber: 1, width: 58, reason: 'Customer lost it', printedAt: NOW });
    expect(rows[1]).toMatchObject({ userId: w.cashier.userId, copyNumber: 2, width: 80 });
    // the figures are the same as the first print, which has no COPY
    expect(first.model.total).toBe('300');
    const original = dataOf(await get(w, w.cashier, s.id)) as unknown as Receipt;
    expect(original.model.copyMarker).toBeNull();
    expect(original.html).not.toContain('COPY');
  });

  it('audits ids only: document, branch, copy number, width; never the reason or a name', async () => {
    const w = await world();
    await makeBatch(w.a.id, w.b1, w.p.id, { buckets: { available: 100 } });
    const s = await sell(w);
    dataOf(await reprint(w, w.manager, s.id, { width: '58', reason: 'Mrs Smith asked' }));
    const rows = await prisma().auditLog.findMany({ where: { action: 'ph.receipt.reprint' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entityType: 'PhSale', entityId: s.id });
    expect(rows[0]!.changes).toEqual({ branchId: { before: null, after: w.b1 }, copyNumber: { before: null, after: 1 }, width: { before: null, after: '58' } });
    expect(JSON.stringify(rows[0]!.changes)).not.toMatch(/Smith|reason|cost/);
  });

  it('is idempotent by key: a repeat returns the copy already logged, with no second row or audit', async () => {
    const w = await world();
    await makeBatch(w.a.id, w.b1, w.p.id, { buckets: { available: 100 } });
    const s = await sell(w);
    const k = key('same');
    const one = dataOf(await reprint(w, w.cashier, s.id, { clientKey: k })) as unknown as Receipt;
    const two = dataOf(await reprint(w, w.cashier, s.id, { clientKey: k })) as unknown as Receipt;
    expect(one).toMatchObject({ copyNumber: 1, replayed: false });
    expect(two).toMatchObject({ copyNumber: 1, replayed: true });
    expect(two.html).toBe(one.html);
    expect(await prisma().phReceiptReprint.count()).toBe(1);
    expect(await prisma().auditLog.count({ where: { action: 'ph.receipt.reprint' } })).toBe(1);
  });

  it('refuses the same key for another document', async () => {
    const w = await world();
    await makeBatch(w.a.id, w.b1, w.p.id, { buckets: { available: 100 } });
    const s1 = await sell(w);
    const s2 = await sell(w);
    const k = key('mix');
    dataOf(await reprint(w, w.cashier, s1.id, { clientKey: k }));
    expect(phCodeOf(await reprint(w, w.cashier, s2.id, { clientKey: k }))).toBe('CLIENT_KEY_MISMATCH');
    expect(await prisma().phReceiptReprint.count()).toBe(1);
  });

  it('parallel reprints with different keys get different numbers; with one key, one row', async () => {
    const w = await world();
    await makeBatch(w.a.id, w.b1, w.p.id, { buckets: { available: 100 } });
    const s = await sell(w);
    const many = await Promise.all([1, 2, 3, 4].map(() => reprint(w, w.cashier, s.id)));
    expect(many.map(codeOf)).toEqual(['OK', 'OK', 'OK', 'OK']);
    expect((await prisma().phReceiptReprint.findMany({ orderBy: { copyNumber: 'asc' } })).map((r) => r.copyNumber)).toEqual([1, 2, 3, 4]);
    const k = key('par');
    const same = await Promise.all([1, 2, 3].map(() => reprint(w, w.manager, s.id, { clientKey: k })));
    expect(same.map(codeOf)).toEqual(['OK', 'OK', 'OK']);
    expect(await prisma().phReceiptReprint.count({ where: { clientKey: k } })).toBe(1);
  });

  it('never changes the sale, payments, cash or stock', async () => {
    const w = await world();
    await makeBatch(w.a.id, w.b1, w.p.id, { buckets: { available: 100 } });
    const s = await sell(w);
    const before = await state();
    dataOf(await reprint(w, w.cashier, s.id));
    dataOf(await reprint(w, w.manager, s.id));
    expect(await state()).toBe(before);
  });

  it('needs a sale or a return, not both and not neither', async () => {
    const w = await world();
    expect(codeOf(await act(w.cashier, printActions.reprintReceipt, { ...at(w), clientKey: key('none') }))).toBe('INVALID');
    expect(codeOf(await act(w.cashier, printActions.reprintReceipt, { ...at(w), saleId: 'a', returnId: 'b', clientKey: key('both') }))).toBe('INVALID');
  });
});

describe('a return slip (ph.receipts.returnReceipt)', () => {
  it('shows the refund, the sale number and the approver; its reprint is logged against the return', async () => {
    const w = await world();
    await makeBatch(w.a.id, w.b1, w.p.id, { buckets: { available: 100 } });
    const s = await sell(w);
    const line = await prisma().phSaleLine.findFirstOrThrow({ where: { saleId: s.id } });
    const made = dataOf(await act(w.manager, returnActions.create, { ...at(w), saleId: s.id, lines: [{ saleLineId: line.id, baseQty: 1 }], reason: 'Wrong item', clientKey: key('ret') })) as { id: string; number: string };
    const slip = dataOf(await ask(w.cashier, printQueries.returnReceipt, { ...at(w), returnId: made.id, width: '58' })) as unknown as Receipt;
    expect(slip.model).toMatchObject({ kind: 'return', number: made.number, saleNumber: s.number, total: '100', cashier: 'manager person', title: 'Return slip', copyMarker: null });
    expect(slip.model.lines).toMatchObject([{ name: 'Panadol', qty: '1', total: '100' }]);
    expect(slip.html).not.toContain('Wrong item');
    const again = dataOf(await act(w.manager, printActions.reprintReceipt, { ...at(w), returnId: made.id, clientKey: key('rp') })) as unknown as Receipt;
    expect(again.model.copyMarker).toBe('COPY');
    expect(await prisma().phReceiptReprint.findFirstOrThrow()).toMatchObject({ saleId: null, returnId: made.id, copyNumber: 1 });
    expect(codeOf(await ask(w.cashier, printQueries.returnReceipt, { ...at(w), returnId: 'nope' }))).toBe('NOT_FOUND');
  });
});

describe('what never reaches the paper', () => {
  it('no cost, whatever the batch cost, and no patient or customer field', async () => {
    const w = await world();
    await makeBatch(w.a.id, w.b1, w.p.id, { buckets: { available: 100 }, cost: { unitCostMinor: 7777n, costUnitId: w.p.tablet } });
    const s = await sell(w);
    const printed = dataOf(await get(w, w.cashier, s.id)) as unknown as Receipt;
    const copy = dataOf(await reprint(w, w.cashier, s.id)) as unknown as Receipt;
    for (const r of [printed, copy]) {
      const all = JSON.stringify(r);
      expect(all).not.toContain('7777');
      expect(all).not.toMatch(/cost|profit|patient|customer|snapshot/i);
    }
  });

  it('escapes a hostile product name and shop name', async () => {
    const w = await world('<script>alert(1)</script>');
    await prisma().restaurant.update({ where: { id: w.a.id }, data: { name: '<img src=x onerror=alert(2)>' } });
    await makeBatch(w.a.id, w.b1, w.p.id, { buckets: { available: 100 } });
    const s = await sell(w);
    const r = dataOf(await get(w, w.cashier, s.id)) as unknown as Receipt;
    expect(r.html).not.toContain('<script>');
    expect(r.html).not.toContain('<img');
    expect(r.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(r.html).toContain('&lt;img src=x onerror=alert(2)&gt;');
  });
});
