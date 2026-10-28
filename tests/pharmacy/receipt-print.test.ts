import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as printActions from '@/server/pharmacy/actions/receipt-print';
import * as returnActions from '@/server/pharmacy/actions/returns';
import * as saleActions from '@/server/pharmacy/actions/sales';
import * as printQueries from '@/server/pharmacy/queries/receipt-print';
import { NOW, grant, person, pharmacy, prisma, resetWorld, useTestDatabase, type Person } from './fixture';
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
      date: '2026-10-27 12:00', // the sale's 09:00 UTC in the default zone, Asia/Baghdad
      shop: { name: 'Al Noor', address: 'Karrada, Baghdad', phone: '+964 770 000 0000' },
    });
    expect(r.model.lines).toMatchObject([{ no: 1, name: 'Panadol', strength: '500 mg', qty: '3', unit: 'tablet', unitPrice: '100', total: '300', rx: false }]);
    expect(r.model.payments).toEqual([{ method: 'CASH', label: 'Cash', amount: '500' }]);
    expect(r.html).toContain('@page { size: 58mm auto; margin: 2mm }');
    expect(r.html).toContain(s.number);
    expect(r.text).toContain('Panadol 500 mg');
    expect(r.html).not.toContain('COPY');
  });

  it('prints the time in the business time zone from PhSettings (default Baghdad), and its reprint', async () => {
    const w = await world();
    await makeBatch(w.a.id, w.b1, w.p.id, { buckets: { available: 100 } });
    const s = await sell(w);
    const first = dataOf(await get(w, w.cashier, s.id)) as unknown as Receipt;
    expect(first.model.date).toBe('2026-10-27 12:00');
    expect(first.text).toContain('2026-10-27 12:00');
    expect(first.text).not.toContain('UTC');
    await prisma().phSettings.update({ where: { restaurantId: w.a.id }, data: { timeZone: 'America/New_York' } });
    expect(((dataOf(await get(w, w.cashier, s.id)) as unknown as Receipt).model).date).toBe('2026-10-27 05:00');
    const copy = dataOf(await reprint(w, w.cashier, s.id, { reason: 'Customer asked' })) as unknown as Receipt;
    expect(copy.model.date).toBe('2026-10-27 05:00');
    // A stored zone that is not a real one never breaks a print: the default zone is used.
    await prisma().phSettings.update({ where: { restaurantId: w.a.id }, data: { timeZone: 'Mars/Base' } });
    expect(((dataOf(await get(w, w.cashier, s.id)) as unknown as Receipt).model).date).toBe('2026-10-27 12:00');
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
    expect(slip.model.date).toBe('2026-10-27 12:00'); // the return's 09:00 UTC in Baghdad
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

describe('a replayed reprint must be the same request', () => {
  it('refuses the same key from another user, at another width, or with another reason, and writes nothing', async () => {
    const w = await world();
    await makeBatch(w.a.id, w.b1, w.p.id, { buckets: { available: 100 } });
    const s = await sell(w);
    const k = key('same');
    dataOf(await reprint(w, w.cashier, s.id, { clientKey: k, width: '58', reason: 'Lost' }));
    const audits = await prisma().auditLog.count({ where: { action: 'ph.receipt.reprint' } });
    expect(phCodeOf(await reprint(w, w.manager, s.id, { clientKey: k, width: '58', reason: 'Lost' }))).toBe('CLIENT_KEY_MISMATCH');
    expect(phCodeOf(await reprint(w, w.cashier, s.id, { clientKey: k, width: '80', reason: 'Lost' }))).toBe('CLIENT_KEY_MISMATCH');
    expect(phCodeOf(await reprint(w, w.cashier, s.id, { clientKey: k, width: '58', reason: 'Customer asked' }))).toBe('CLIENT_KEY_MISMATCH');
    expect(phCodeOf(await reprint(w, w.cashier, s.id, { clientKey: k, width: '58' }))).toBe('CLIENT_KEY_MISMATCH');
    expect(await prisma().phReceiptReprint.count()).toBe(1);
    expect(await prisma().auditLog.count({ where: { action: 'ph.receipt.reprint' } })).toBe(audits);
  });

  it('the same request again returns the stored copy at the stored width, with no new row or audit', async () => {
    const w = await world();
    await makeBatch(w.a.id, w.b1, w.p.id, { buckets: { available: 100 } });
    const s = await sell(w);
    const k = key('again');
    const one = dataOf(await reprint(w, w.cashier, s.id, { clientKey: k, width: '58', reason: ' Lost ' })) as unknown as Receipt;
    const two = dataOf(await reprint(w, w.cashier, s.id, { clientKey: k, width: '58', reason: 'Lost' })) as unknown as Receipt;
    expect(two).toMatchObject({ copyNumber: 1, replayed: true });
    expect(two.html).toContain('@page { size: 58mm auto; margin: 2mm }');
    expect(two.html).toBe(one.html);
    expect(await prisma().phReceiptReprint.count()).toBe(1);
    expect(await prisma().auditLog.count({ where: { action: 'ph.receipt.reprint' } })).toBe(1);
  });

  it('a return slip replay is checked the same way', async () => {
    const w = await world();
    await makeBatch(w.a.id, w.b1, w.p.id, { buckets: { available: 100 } });
    const s = await sell(w);
    const line = await prisma().phSaleLine.findFirstOrThrow({ where: { saleId: s.id } });
    const made = dataOf(await act(w.manager, returnActions.create, { ...at(w), saleId: s.id, lines: [{ saleLineId: line.id, baseQty: 1 }], reason: 'x y z', clientKey: key('ret') })) as { id: string };
    const k = key('rr');
    dataOf(await act(w.manager, printActions.reprintReceipt, { ...at(w), returnId: made.id, clientKey: k, width: '58' }));
    expect(phCodeOf(await act(w.manager, printActions.reprintReceipt, { ...at(w), returnId: made.id, clientKey: k, width: '80' }))).toBe('CLIENT_KEY_MISMATCH');
    expect(phCodeOf(await act(w.cashier, printActions.reprintReceipt, { ...at(w), returnId: made.id, clientKey: k, width: '58' }))).toBe('CLIENT_KEY_MISMATCH');
  });
});

describe('who may not print', () => {
  it('a stock-only role and a support grant are refused on every print, and nothing is logged', async () => {
    const w = await world();
    await makeBatch(w.a.id, w.b1, w.p.id, { buckets: { available: 100 } });
    const s = await sell(w);
    const line = await prisma().phSaleLine.findFirstOrThrow({ where: { saleId: s.id } });
    const made = dataOf(await act(w.manager, returnActions.create, { ...at(w), saleId: s.id, lines: [{ saleLineId: line.id, baseQty: 1 }], reason: 'x y z', clientKey: key('ret') })) as { id: string };
    const support = await person('support', { superAdmin: true });
    await grant(support, w.a.id, { scopes: ['catalog.read', 'sales.read', 'stock.read'] });
    for (const who of [w.stock, support]) {
      expect(codeOf(await get(w, who, s.id))).toBe('FORBIDDEN');
      expect(codeOf(await reprint(w, who, s.id))).toBe('FORBIDDEN');
      expect(codeOf(await ask(who, printQueries.returnReceipt, { ...at(w), returnId: made.id }))).toBe('FORBIDDEN');
      expect(codeOf(await act(who, printActions.reprintReceipt, { ...at(w), returnId: made.id, clientKey: key('rr') }))).toBe('FORBIDDEN');
    }
    expect(await prisma().phReceiptReprint.count()).toBe(0);
    expect(await prisma().auditLog.count({ where: { action: 'ph.receipt.reprint' } })).toBe(0);
  });
});

describe('six parallel reprints with distinct keys', () => {
  it('all succeed with the numbers 1 to 6', async () => {
    const w = await world();
    await makeBatch(w.a.id, w.b1, w.p.id, { buckets: { available: 100 } });
    const s = await sell(w);
    const many = await Promise.all([1, 2, 3, 4, 5, 6].map((i) => reprint(w, i % 2 ? w.cashier : w.manager, s.id)));
    expect(many.map(codeOf)).toEqual(Array(6).fill('OK'));
    expect((await prisma().phReceiptReprint.findMany({ orderBy: { copyNumber: 'asc' } })).map((r) => r.copyNumber)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(await prisma().auditLog.count({ where: { action: 'ph.receipt.reprint' } })).toBe(6);
  });
});

describe('the printed figures match hand figures from a real sale', () => {
  it('IQD: line and invoice discount, rounding step, cash with change plus a transfer', async () => {
    const w = await world();
    await makeBatch(w.a.id, w.b1, w.p.id, { buckets: { available: 100 } });
    await prisma().phSettings.update({ where: { restaurantId: w.a.id }, data: { roundingStepMinor: 250n } });
    // 4 tablets at 100 = 400 and 1 strip at 900: gross 1,300. Line discount 40 on the tablets; invoice discount 140 shared
    // over what is left (360 + 900 = 1,260): 40 and 100. Discount 180 in all, net 1,120 (tablets 320, strip 800).
    // Rounded to the step of 250: 1,000 (120 away; 1,250 is 130 away), so rounding -120 and total 1,000.
    // Paid cash 800 + transfer 300 = 1,100; change 100 (from the cash).
    const s = dataOf(
      await act(w.manager, saleActions.create, {
        ...at(w),
        clientKey: key('sale'),
        currency: 'IQD',
        lines: [
          { productId: w.p.id, unitId: w.p.tablet, qty: 4, discount: { kind: 'amount', value: 40n, reason: 'promo' } },
          { productId: w.p.id, unitId: w.p.strip, qty: 1 },
        ],
        invoiceDiscount: { kind: 'amount', value: 140n, reason: 'bulk' },
        payments: [
          { method: 'CASH', amountMinor: 800n, clientKey: key('pay') },
          { method: 'TRANSFER_MANUAL', amountMinor: 300n, clientKey: key('pay'), reference: 'ref-9' },
        ],
      }),
    ) as { id: string; number: string };
    expect(await prisma().phSale.findUniqueOrThrow({ where: { id: s.id } })).toMatchObject({ subtotalMinor: 1300n, discountMinor: 180n, roundingMinor: -120n, totalMinor: 1000n, paidMinor: 1100n, changeMinor: 100n });

    const first = dataOf(await get(w, w.cashier, s.id, { locale: 'en' })) as unknown as Receipt;
    expect(first.model).toMatchObject({ subtotal: '1,300', discount: '-180', rounding: '-120', total: '1,000', paid: '1,100', change: '100' });
    const payments = (first.model.payments as { method: string; amount: string }[]).map((p) => [p.method, p.amount]).sort();
    expect(payments).toEqual([['CASH', '800'], ['TRANSFER_MANUAL', '300']]);
    expect(first.model.lines).toMatchObject([
      { no: 1, qty: '4', unit: 'tablet', unitPrice: '100', discount: '-80', total: '320' },
      { no: 2, qty: '1', unit: 'strip', unitPrice: '900', discount: '-100', total: '800' },
    ]);
    const text = first.text;
    expect(text).toMatch(/Subtotal\s+1,300\n/);
    expect(text).toMatch(/\nDiscount\s+-180\n/);
    expect(text).toMatch(/\nRounding\s+-120\n/);
    expect(text).toMatch(/\nTotal\s+1,000 IQD\n/);
    expect(text).toMatch(/\nPaid\s+1,100 IQD\n/);
    expect(text).toMatch(/\nChange\s+100 IQD\n/);
    // a reprint prints the same figures
    const copy = dataOf(await reprint(w, w.manager, s.id)) as unknown as Receipt;
    expect(copy.model).toMatchObject({ subtotal: '1,300', discount: '-180', rounding: '-120', total: '1,000', paid: '1,100', change: '100' });
  });

  it('USD: two decimals, a line percent discount, change from a larger note', async () => {
    const w = await world();
    for (const [unitId, amountMinor] of [[w.p.tablet, 150n], [w.p.strip, 1350n]] as const) {
      await prisma().phPrice.create({ data: { restaurantId: w.a.id, productId: w.p.id, unitId, branchId: null, currency: 'USD', amountMinor, validFrom: new Date('2026-01-01T00:00:00.000Z'), changedById: 'seed' } });
    }
    await makeBatch(w.a.id, w.b1, w.p.id, { buckets: { available: 100 } });
    const usd = await person('usd', { staff: [w.a.id, 'BRANCH_MANAGER', [w.b1]] });
    await prisma().phShift.create({ data: { restaurantId: w.a.id, branchId: w.b1, userId: usd.userId, currency: 'USD', openingFloatMinor: 0n } });
    // 2 tablets at 1.50 = 3.00; 10% off = 0.30; total 2.70 (no rounding on USD); paid 5.00 cash; change 2.30.
    const s = dataOf(
      await act(usd, saleActions.create, {
        ...at(w),
        clientKey: key('sale'),
        currency: 'USD',
        lines: [{ productId: w.p.id, unitId: w.p.tablet, qty: 2, discount: { kind: 'percent', value: 10, reason: 'promo' } }],
        payments: [{ method: 'CASH', amountMinor: 500n, clientKey: key('pay') }],
      }),
    ) as { id: string };
    const r = dataOf(await get(w, usd, s.id)) as unknown as Receipt;
    expect(r.model).toMatchObject({ currency: 'USD', subtotal: '3.00', discount: '-0.30', rounding: null, total: '2.70', paid: '5.00', change: '2.30' });
    expect(r.model.lines).toMatchObject([{ unitPrice: '1.50', discount: '-0.30', total: '2.70' }]);
    expect(r.text).toMatch(/\nChange\s+2\.30 USD\n/);
  });

  it('a return slip from a real return, including the final return that takes the rounding, lists lines in sale order', async () => {
    const w = await world();
    await makeBatch(w.a.id, w.b1, w.p.id, { buckets: { available: 100 } });
    await prisma().phSettings.update({ where: { restaurantId: w.a.id }, data: { roundingStepMinor: 250n } });
    // 4 tablets (400) + 1 strip (900, ten base units) = 1,300; 50% off = 650; split 200 + 450; 650 rounds to 750 (+100).
    // Tablet 200 / 4 = 50 each, strip 450 / 10 = 45 each.
    const s = dataOf(
      await act(w.manager, saleActions.create, {
        ...at(w),
        clientKey: key('sale'),
        currency: 'IQD',
        lines: [{ productId: w.p.id, unitId: w.p.tablet, qty: 4 }, { productId: w.p.id, unitId: w.p.strip, qty: 1 }],
        invoiceDiscount: { kind: 'percent', value: 50, reason: 'Staff discount' },
        payments: [{ method: 'CASH', amountMinor: 750n, clientKey: key('pay') }],
      }),
    ) as { id: string };
    const rows = await prisma().phSaleLine.findMany({ where: { saleId: s.id }, orderBy: { lineNo: 'asc' } });
    const [tab, strip] = rows as [(typeof rows)[0], (typeof rows)[0]];
    const ret = async (lines: [string, number][]) =>
      dataOf(await act(w.manager, returnActions.create, { ...at(w), saleId: s.id, lines: lines.map(([saleLineId, baseQty]) => ({ saleLineId, baseQty })), reason: 'Wrong item', clientKey: key('ret') })) as { id: string; refundMinor: string };
    // first return: strip first in the request, tablets second: 4 * 45 + 2 * 50 = 280
    const first = await ret([[strip.id, 4], [tab.id, 2]]);
    expect(first.refundMinor).toBe('280');
    const slip1 = dataOf(await ask(w.manager, printQueries.returnReceipt, { ...at(w), returnId: first.id })) as unknown as Receipt;
    expect(slip1.model).toMatchObject({ total: '280', rounding: null });
    expect(slip1.model.lines).toMatchObject([{ qty: '2', total: '100' }, { qty: '4', total: '180' }]);
    // final return: 6 * 45 + 2 * 50 = 370, plus the rounding 100 = 470
    const last = await ret([[strip.id, 6], [tab.id, 2]]);
    expect(last.refundMinor).toBe('470');
    const slip2 = dataOf(await ask(w.manager, printQueries.returnReceipt, { ...at(w), returnId: last.id })) as unknown as Receipt;
    expect(slip2.model).toMatchObject({ total: '470', rounding: '100' });
    expect(slip2.model.lines).toMatchObject([{ qty: '2', total: '100' }, { qty: '6', total: '270' }]);
    expect(slip2.text).toMatch(/\nRounding\s+100\n/);
    expect(slip2.text).toMatch(/\nRefund\s+470 IQD\n/);
    expect(280 + 470).toBe(750);
  });
});
