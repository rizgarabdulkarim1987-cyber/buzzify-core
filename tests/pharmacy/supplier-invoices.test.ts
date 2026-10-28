import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { scopedClient } from '@/server/data/tenant-db';
import * as poActions from '@/server/pharmacy/actions/purchase-orders';
import * as receiptActions from '@/server/pharmacy/actions/receipts';
import * as invoiceActions from '@/server/pharmacy/actions/supplier-invoices';
import * as invoiceQueries from '@/server/pharmacy/queries/supplier-invoices';
import { asInvoiceError, getInvoice, listInvoices } from '@/server/pharmacy/supplier-invoices';
import { grant, NOW, DAY, asPh, person, pharmacy, prisma, resetWorld, useTestDatabase } from './fixture';
import { act, ask, codeOf, dataOf, makeProduct, phCodeOf } from './stock-helpers';

let keySeq = 0;
type World = Awaited<ReturnType<typeof world>>;
type P = { id: string; tablet: string; strip: string };

async function world() {
  const a = await pharmacy('A', { branches: 2 });
  const owner = await person('owner', { membership: [a.id, 'OWNER'] });
  const mkSupplier = (name: string, over: Record<string, unknown> = {}) =>
    prisma().phSupplier.create({
      data: { restaurantId: a.id, name, nameKey: name.toLowerCase(), defaultCurrency: 'IQD', termsDays: 30, clientKey: `sup-${(keySeq += 1)}-aaaa`, createdById: owner.userId, ...over },
      select: { id: true },
    });
  const supplier = await mkSupplier('Al-Noor');
  const supplierB = await mkSupplier('Beta Pharma');
  const p = await makeProduct(a.id, 'Panadol');
  const q = await makeProduct(a.id, 'Brufen');
  return { a, owner, supplierId: supplier.id, supplierB: supplierB.id, p, q };
}

const rLine = (p: P, over: Record<string, unknown> = {}) => ({
  productId: p.id,
  unitId: p.strip,
  qty: 100,
  lot: `lot-${(keySeq += 1)}`,
  expiry: '2028-03-15',
  unitCostMinor: '2500',
  currency: 'IQD',
  ...over,
});

/** A CONFIRMED receipt of `supplierId` (none for a legacy free-text one) with the given lines; returns its line ids in order. */
async function received(w: World, lines: unknown[], over: Record<string, unknown> = {}, branch = 0) {
  const made = dataOf(
    await act(w.owner, receiptActions.create, {
      restaurantId: w.a.id,
      branchId: w.a.branchIds[branch],
      clientKey: `rcpt-key-${(keySeq += 1)}-aaaa`,
      supplierId: w.supplierId,
      supplierName: '',
      reference: 'GRN',
      receivedOn: '2026-10-20',
      lines,
      ...over,
    }),
  );
  dataOf(await act(w.owner, receiptActions.confirm, { restaurantId: w.a.id, branchId: w.a.branchIds[branch], receiptId: made.id }));
  const rows = await prisma().phReceiptLine.findMany({ where: { receiptId: made.id }, orderBy: { lineNo: 'asc' }, select: { id: true } });
  return { id: made.id, lines: rows.map((r) => r.id) };
}

const iLine = (receiptLineId: string, qtyInvoiced: number, unitCostMinor: string | number = '2500') => ({ receiptLineId, qtyInvoiced, unitCostMinor });

const body = (w: World, lines: unknown[], over: Record<string, unknown> = {}) => ({
  restaurantId: w.a.id,
  clientKey: `inv-key-${(keySeq += 1)}-aaaa`,
  supplierId: w.supplierId,
  number: `INV-${(keySeq += 1)}`,
  invoiceDate: '2026-10-21',
  currency: 'IQD',
  lines,
  ...over,
});

const create = (w: World, lines: unknown[], over: Record<string, unknown> = {}) => act(w.owner, invoiceActions.create, body(w, lines, over));
const ref = (w: World, invoiceId: string, expectedVersion = 1) => ({ restaurantId: w.a.id, invoiceId, expectedVersion });
const rowOf = (id: string) => prisma().phSupplierInvoice.findUniqueOrThrow({ where: { id }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
const invoicedOf = async (lineId: string) => (await prisma().phReceiptLine.findUniqueOrThrow({ where: { id: lineId }, select: { invoicedQty: true } })).invoicedQty;

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

describe('creating an invoice', () => {
  it('computes the totals by hand: 2 lines + a negative adjustment, due date from the terms, status OPEN, counters raised', async () => {
    const w = await world();
    const r = await received(w, [rLine(w.p, { qty: 100, bonusQty: 10 }), rLine(w.q, { qty: 20, unitCostMinor: '1000' })]);
    // 100 x 2500 = 250000; 20 x 1000 = 20000; adjustment -5000 (a discount) => 265000.
    const made = dataOf(await create(w, [iLine(r.lines[0]!, 100), iLine(r.lines[1]!, 20, '1000')], { number: ' inv-٠٠٧ ', adjustmentMinor: '-5000', adjustmentReason: 'Early payment discount' }));
    expect(made).toMatchObject({ version: 1, status: 'OPEN', totalMinor: '265000', dueDate: '2026-11-20', currency: 'IQD', lineCount: 2, replayed: false });
    const row = await rowOf(made.id);
    expect(row).toMatchObject({
      supplierId: w.supplierId,
      number: 'INV-007',
      numberRaw: 'inv-٠٠٧',
      status: 'OPEN',
      totalMinor: 265000n,
      adjustmentMinor: -5000n,
      paidMinor: 0n,
      creditedMinor: 0n,
      version: 1,
    });
    expect(row.invoiceDate.toISOString().slice(0, 10)).toBe('2026-10-21');
    expect(row.dueDate.toISOString().slice(0, 10)).toBe('2026-11-20');
    expect(row.fingerprint).toHaveLength(64);
    expect(row.lines.map((l) => [l.lineNo, l.receiptLineId, l.qtyInvoiced, l.unitCostMinor, l.lineTotalMinor])).toEqual([
      [1, r.lines[0], 100, 2500n, 250000n],
      [2, r.lines[1], 20, 1000n, 20000n],
    ]);
    expect(await invoicedOf(r.lines[0]!)).toBe(100);
    expect(await invoicedOf(r.lines[1]!)).toBe(20);
  });

  it('uses the given due date when there is one, and refuses one before the invoice date', async () => {
    const w = await world();
    const r = await received(w, [rLine(w.p)]);
    const made = dataOf(await create(w, [iLine(r.lines[0]!, 10)], { dueDate: '2026-12-31' }));
    expect(made.dueDate).toBe('2026-12-31');
    const r2 = await received(w, [rLine(w.p)]);
    const early = await create(w, [iLine(r2.lines[0]!, 10)], { dueDate: '2026-10-20' });
    expect(codeOf(early)).toBe('INVALID');
    expect(await invoicedOf(r2.lines[0]!)).toBe(0);
  });

  it('validates the input: number, adjustment reason, negative total, line count, quantities and costs', async () => {
    const w = await world();
    const r = await received(w, [rLine(w.p)]);
    const line = iLine(r.lines[0]!, 10);
    expect(codeOf(await create(w, [line], { number: '   ' }))).toBe('INVALID');
    expect(codeOf(await create(w, [line], { number: '​؜' }))).toBe('INVALID');
    expect(codeOf(await create(w, [line], { number: 'x'.repeat(61) }))).toBe('INVALID');
    expect(codeOf(await create(w, [line], { adjustmentMinor: '100' }))).toBe('INVALID'); // reason missing
    expect(codeOf(await create(w, [line], { adjustmentMinor: '-30000', adjustmentReason: 'too big' }))).toBe('INVALID'); // total below zero (25000 - 30000)
    expect(codeOf(await create(w, []))).toBe('INVALID');
    expect(codeOf(await create(w, Array.from({ length: 201 }, () => line)))).toBe('INVALID');
    expect(codeOf(await create(w, [iLine(r.lines[0]!, 0)]))).toBe('INVALID');
    expect(codeOf(await create(w, [iLine(r.lines[0]!, 1.5)]))).toBe('INVALID');
    expect(codeOf(await create(w, [iLine(r.lines[0]!, 1, '-1')]))).toBe('INVALID');
    expect(codeOf(await create(w, [line], { currency: 'EUR' }))).toBe('INVALID');
    expect(codeOf(await create(w, [line], { invoiceDate: '2026-02-30' }))).toBe('INVALID');
    expect(await prisma().phSupplierInvoice.count()).toBe(0);
    expect(await invoicedOf(r.lines[0]!)).toBe(0);
  });

  it('refuses the same receipt line twice in one request (DUPLICATE_LINE)', async () => {
    const w = await world();
    const r = await received(w, [rLine(w.p)]);
    const result = await create(w, [iLine(r.lines[0]!, 10), iLine(r.lines[0]!, 20)]);
    expect(codeOf(result)).toBe('INVALID');
    expect(phCodeOf(result)).toBe('DUPLICATE_LINE');
    expect(await prisma().phSupplierInvoice.count()).toBe(0);
  });

  it('accepts a zero unit cost (a free line): the total is zero', async () => {
    const w = await world();
    const r = await received(w, [rLine(w.p, { qty: 5, bonusQty: 5 })]);
    const made = dataOf(await create(w, [iLine(r.lines[0]!, 10, 0)]));
    expect(made.totalMinor).toBe('0');
  });

  it('audits ids, status, currency, amounts and line count, never the adjustment reason', async () => {
    const w = await world();
    const r = await received(w, [rLine(w.p)]);
    const made = dataOf(await create(w, [iLine(r.lines[0]!, 10)], { adjustmentMinor: '1000', adjustmentReason: 'Freight from the depot SECRETWORD', number: 'A-1' }));
    const audit = await prisma().auditLog.findMany({ where: { action: 'ph.invoice.create', entityId: made.id } });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.changes).toMatchObject({
      status: { before: null, after: 'OPEN' },
      currency: { after: 'IQD' },
      totalMinor: { after: '26000' },
      adjustmentMinor: { after: '1000' },
      lineCount: { after: 1 },
      supplierId: { after: w.supplierId },
    });
    expect(JSON.stringify(audit[0]!.changes)).not.toContain('SECRETWORD');
    expect(JSON.stringify(audit[0]!.changes)).not.toContain('Freight');
  });
});

describe('quantities', () => {
  it('lets bonus units be invoiced only up to qty + bonus', async () => {
    const w = await world();
    const r = await received(w, [rLine(w.p, { qty: 100, bonusQty: 10 })]);
    const over = await create(w, [iLine(r.lines[0]!, 111)]);
    expect(codeOf(over)).toBe('CONFLICT');
    expect(phCodeOf(over)).toBe('INVOICE_EXCEEDS_RECEIVED');
    dataOf(await create(w, [iLine(r.lines[0]!, 110)]));
    expect(await invoicedOf(r.lines[0]!)).toBe(110);
  });

  it('invoices a line partly across two invoices and refuses one unit more than what is left', async () => {
    const w = await world();
    const r = await received(w, [rLine(w.p, { qty: 100 })]);
    dataOf(await create(w, [iLine(r.lines[0]!, 60)]));
    dataOf(await create(w, [iLine(r.lines[0]!, 40)]));
    expect(await invoicedOf(r.lines[0]!)).toBe(100);
    expect(phCodeOf(await create(w, [iLine(r.lines[0]!, 1)]))).toBe('INVOICE_EXCEEDS_RECEIVED');
    expect(await invoicedOf(r.lines[0]!)).toBe(100);
    // 40 left on a line of 50: 41 is one unit too many, 40 is exactly right.
    const r2 = await received(w, [rLine(w.q, { qty: 50 })]);
    dataOf(await create(w, [iLine(r2.lines[0]!, 10)]));
    expect(phCodeOf(await create(w, [iLine(r2.lines[0]!, 41)]))).toBe('INVOICE_EXCEEDS_RECEIVED');
    dataOf(await create(w, [iLine(r2.lines[0]!, 40)]));
    expect(await invoicedOf(r2.lines[0]!)).toBe(50);
  });

  it('lets exactly one of two parallel invoices win the same received units; the counter never passes what was received', async () => {
    const w = await world();
    const r = await received(w, [rLine(w.p, { qty: 100 })]);
    const results = await Promise.all([create(w, [iLine(r.lines[0]!, 70)]), create(w, [iLine(r.lines[0]!, 70)])]);
    expect(results.map(codeOf).sort()).toEqual(['CONFLICT', 'OK']);
    const lost = results.find((x) => !x.ok)!;
    expect(phCodeOf(lost)).toBe('INVOICE_EXCEEDS_RECEIVED');
    expect(await invoicedOf(r.lines[0]!)).toBe(70);
    expect(await prisma().phSupplierInvoice.count()).toBe(1);
  });

  it('lets two parallel invoices that fit together both succeed', async () => {
    const w = await world();
    const r = await received(w, [rLine(w.p, { qty: 100 })]);
    const results = await Promise.all([create(w, [iLine(r.lines[0]!, 50)]), create(w, [iLine(r.lines[0]!, 50)])]);
    expect(results.map(codeOf)).toEqual(['OK', 'OK']);
    expect(await invoicedOf(r.lines[0]!)).toBe(100);
  });
});

describe('what can be invoiced', () => {
  it('refuses a legacy receipt (no supplier), another supplier’s receipt and a draft receipt: NOT_INVOICEABLE', async () => {
    const w = await world();
    const legacy = await received(w, [rLine(w.p)], { supplierId: undefined, supplierName: 'Free text' });
    const theirs = await received(w, [rLine(w.p)], { supplierId: w.supplierB });
    const draft = dataOf(
      await act(w.owner, receiptActions.create, {
        restaurantId: w.a.id, branchId: w.a.branchId, clientKey: `rcpt-key-${(keySeq += 1)}-aaaa`, supplierId: w.supplierId, supplierName: '', reference: 'D', receivedOn: '2026-10-20', lines: [rLine(w.p)],
      }),
    );
    const draftLine = (await prisma().phReceiptLine.findFirstOrThrow({ where: { receiptId: draft.id } })).id;
    for (const lineId of [legacy.lines[0]!, theirs.lines[0]!, draftLine]) {
      const result = await create(w, [iLine(lineId, 1)]);
      expect(codeOf(result), lineId).toBe('CONFLICT');
      expect(phCodeOf(result), lineId).toBe('NOT_INVOICEABLE');
      expect(await invoicedOf(lineId)).toBe(0);
    }
    expect(await prisma().phSupplierInvoice.count()).toBe(0);
  });

  it('refuses a void receipt’s line', async () => {
    const w = await world();
    const r = await received(w, [rLine(w.p)]);
    await prisma().phReceipt.update({ where: { id: r.id }, data: { status: 'VOID' } });
    expect(phCodeOf(await create(w, [iLine(r.lines[0]!, 1)]))).toBe('NOT_INVOICEABLE');
  });

  it('accepts receipts of any branch of the business in one invoice', async () => {
    const w = await world();
    const r1 = await received(w, [rLine(w.p)], {}, 0);
    const r2 = await received(w, [rLine(w.q)], {}, 1);
    const made = dataOf(await create(w, [iLine(r1.lines[0]!, 5), iLine(r2.lines[0]!, 5)]));
    expect(made.lineCount).toBe(2);
  });

  it('refuses a currency that differs from the receipt line’s cost currency', async () => {
    const w = await world();
    const r = await received(w, [rLine(w.p, { currency: 'USD', unitCostMinor: '150' })]);
    const result = await create(w, [iLine(r.lines[0]!, 1, '150')], { currency: 'IQD' });
    expect(phCodeOf(result)).toBe('CURRENCY_MISMATCH');
    expect(codeOf(await create(w, [iLine(r.lines[0]!, 1, '150')], { currency: 'USD' }))).toBe('OK');
  });

  it('refuses an archived supplier and an unknown supplier', async () => {
    const w = await world();
    const r = await received(w, [rLine(w.p)]);
    await prisma().phSupplier.update({ where: { id: w.supplierId }, data: { active: false } });
    expect(phCodeOf(await create(w, [iLine(r.lines[0]!, 1)]))).toBe('SUPPLIER_ARCHIVED');
    expect(codeOf(await create(w, [iLine(r.lines[0]!, 1)], { supplierId: 'nope' }))).toBe('NOT_FOUND');
    expect(await prisma().phSupplierInvoice.count()).toBe(0);
  });
});

describe('duplicates', () => {
  it('refuses the same number with other spacing, case or Arabic-Indic digits, and names the first invoice', async () => {
    const w = await world();
    const r = await received(w, [rLine(w.p, { qty: 100 })]);
    const first = dataOf(await create(w, [iLine(r.lines[0]!, 10)], { number: 'ab 123' }));
    for (const number of ['AB  123', ' ab 123 ', 'Ab 123', 'ab 1٢٣', 'ab​ 123']) {
      const result = await create(w, [iLine(r.lines[0]!, 10)], { number });
      expect(codeOf(result), number).toBe('CONFLICT');
      expect(phCodeOf(result), number).toBe('DUPLICATE_INVOICE');
      expect(!result.ok && result.error.fields?.existingInvoiceId, number).toBe(first.id);
    }
    expect(await invoicedOf(r.lines[0]!)).toBe(10);
    expect(await prisma().phSupplierInvoice.count()).toBe(1);
  });

  it('allows the same number for another supplier', async () => {
    const w = await world();
    const r = await received(w, [rLine(w.p)]);
    const r2 = await received(w, [rLine(w.q)], { supplierId: w.supplierB });
    dataOf(await create(w, [iLine(r.lines[0]!, 1)], { number: 'SAME-1' }));
    dataOf(await create(w, [iLine(r2.lines[0]!, 1)], { number: 'SAME-1', supplierId: w.supplierB }));
    expect(await prisma().phSupplierInvoice.count()).toBe(2);
  });

  it('pins the behaviour: same supplier, date, currency and total under a different number is NOT a duplicate', async () => {
    const w = await world();
    const r = await received(w, [rLine(w.p, { qty: 100 })]);
    dataOf(await create(w, [iLine(r.lines[0]!, 10)], { number: 'N-1' }));
    dataOf(await create(w, [iLine(r.lines[0]!, 10)], { number: 'N-2' }));
    expect(await prisma().phSupplierInvoice.count()).toBe(2);
  });

  it('keeps one invoice when two parallel creates with different keys carry the same number', async () => {
    const w = await world();
    const r = await received(w, [rLine(w.p, { qty: 100 })]);
    const results = await Promise.all([create(w, [iLine(r.lines[0]!, 10)], { number: 'RACE-1' }), create(w, [iLine(r.lines[0]!, 10)], { number: 'RACE-1' })]);
    expect(results.map(codeOf).sort()).toEqual(['CONFLICT', 'OK']);
    expect(phCodeOf(results.find((x) => !x.ok)!)).toBe('DUPLICATE_INVOICE');
    expect(await prisma().phSupplierInvoice.count()).toBe(1);
    expect(await invoicedOf(r.lines[0]!)).toBe(10);
  });
});

describe('replay', () => {
  it('returns the stored invoice for the same key and payload, and changes nothing', async () => {
    const w = await world();
    const r = await received(w, [rLine(w.p)]);
    const payload = body(w, [iLine(r.lines[0]!, 10)]);
    const first = dataOf(await act(w.owner, invoiceActions.create, payload));
    const again = dataOf(await act(w.owner, invoiceActions.create, payload));
    expect(again).toMatchObject({ id: first.id, replayed: true, totalMinor: first.totalMinor, dueDate: first.dueDate });
    expect(await prisma().phSupplierInvoice.count()).toBe(1);
    expect(await invoicedOf(r.lines[0]!)).toBe(10);
    expect(await prisma().auditLog.count({ where: { action: 'ph.invoice.create' } })).toBe(1);
  });

  it('refuses the same key with another payload or another person', async () => {
    const w = await world();
    const r = await received(w, [rLine(w.p, { qty: 100 })]);
    const manager = await person('mgr', { staff: [w.a.id, 'PHARMACIST_IN_CHARGE', w.a.branchIds] });
    const payload = body(w, [iLine(r.lines[0]!, 10)]);
    dataOf(await act(w.owner, invoiceActions.create, payload));
    for (const over of [{ number: 'OTHER' }, { invoiceDate: '2026-10-22' }, { lines: [iLine(r.lines[0]!, 11)] }, { adjustmentMinor: '5', adjustmentReason: 'x' }, { dueDate: '2026-12-01' }]) {
      const mismatch = await act(w.owner, invoiceActions.create, { ...payload, ...over });
      expect(codeOf(mismatch), JSON.stringify(over)).toBe('CONFLICT');
      expect(phCodeOf(mismatch)).toBe('CLIENT_KEY_MISMATCH');
    }
    expect(phCodeOf(await act(manager, invoiceActions.create, payload))).toBe('CLIENT_KEY_MISMATCH');
    expect(await prisma().phSupplierInvoice.count()).toBe(1);
    expect(await invoicedOf(r.lines[0]!)).toBe(10);
  });

  it('replays a voided invoice as it is stored (VOID), and survives a change of the supplier’s terms', async () => {
    const w = await world();
    const r = await received(w, [rLine(w.p)]);
    const payload = body(w, [iLine(r.lines[0]!, 10)]);
    const first = dataOf(await act(w.owner, invoiceActions.create, payload));
    await prisma().phSupplier.update({ where: { id: w.supplierId }, data: { termsDays: 90 } });
    dataOf(await act(w.owner, invoiceActions.voidInvoice, { ...ref(w, first.id), reason: 'entered twice' }));
    const again = dataOf(await act(w.owner, invoiceActions.create, payload));
    expect(again).toMatchObject({ id: first.id, replayed: true, status: 'VOID', dueDate: first.dueDate });
    expect(await invoicedOf(r.lines[0]!)).toBe(0);
  });

  it('keeps one row when two creates with one key run at once', async () => {
    const w = await world();
    const r = await received(w, [rLine(w.p)]);
    const payload = body(w, [iLine(r.lines[0]!, 10)]);
    const results = await Promise.all([act(w.owner, invoiceActions.create, payload), act(w.owner, invoiceActions.create, payload)]);
    expect(results.map(codeOf)).toEqual(['OK', 'OK']);
    expect(await prisma().phSupplierInvoice.count()).toBe(1);
    expect(results.filter((x) => x.ok && x.data.replayed)).toHaveLength(1);
    expect(await invoicedOf(r.lines[0]!)).toBe(10);
  });
});

describe('voiding', () => {
  it('releases the invoiced quantities, renames the keys, keeps the raw number, and lets the same number be entered again', async () => {
    const w = await world();
    const r = await received(w, [rLine(w.p, { qty: 100 })]);
    const made = dataOf(await create(w, [iLine(r.lines[0]!, 100)], { number: 'Real-77' }));
    const before = await rowOf(made.id);
    const voided = dataOf(await act(w.owner, invoiceActions.voidInvoice, { ...ref(w, made.id), reason: 'Wrong supplier invoice' }));
    expect(voided).toMatchObject({ id: made.id, version: 2, status: 'VOID' });
    const row = await rowOf(made.id);
    expect(row).toMatchObject({ status: 'VOID', voidedById: expect.any(String), voidReason: 'Wrong supplier invoice', numberRaw: 'Real-77', version: 2 });
    expect(row.voidedAt).not.toBeNull();
    expect(row.number).toBe(`REAL-77#void-${made.id}`);
    expect(row.fingerprint).toBe(`${before.fingerprint}#void-${made.id}`);
    expect(await invoicedOf(r.lines[0]!)).toBe(0);
    const again = dataOf(await create(w, [iLine(r.lines[0]!, 100)], { number: 'Real-77' }));
    expect(again.id).not.toBe(made.id);
    expect(await invoicedOf(r.lines[0]!)).toBe(100);
    // The voided row still shows the supplier's own number in the list.
    const listed = dataOf(await ask(w.owner, invoiceQueries.list, { restaurantId: w.a.id, status: 'VOID' }));
    expect(listed.items.map((i) => [i.id, i.numberRaw])).toEqual([[made.id, 'Real-77']]);
    const audit = await prisma().auditLog.findFirstOrThrow({ where: { action: 'ph.invoice.void', entityId: made.id } });
    expect(audit.changes).toMatchObject({ status: { before: 'OPEN', after: 'VOID' }, version: { before: 1, after: 2 } });
    expect(JSON.stringify(audit.changes)).not.toContain('Wrong supplier');
  });

  it('refuses a stale version, a second void, and an invoice with a payment or a credit (INVOICE_SETTLED)', async () => {
    const w = await world();
    const r = await received(w, [rLine(w.p, { qty: 100 })]);
    const a = dataOf(await create(w, [iLine(r.lines[0]!, 10)]));
    expect(codeOf(await act(w.owner, invoiceActions.voidInvoice, { ...ref(w, a.id, 7), reason: 'stale version' }))).toBe('CONFLICT');
    dataOf(await act(w.owner, invoiceActions.voidInvoice, { ...ref(w, a.id), reason: 'first void' }));
    expect(phCodeOf(await act(w.owner, invoiceActions.voidInvoice, { ...ref(w, a.id, 2), reason: 'second void' }))).toBe('ALREADY_VOID');

    const paid = dataOf(await create(w, [iLine(r.lines[0]!, 20)]));
    await prisma().phSupplierInvoice.update({ where: { id: paid.id }, data: { paidMinor: 1000n, status: 'PARTIAL' } });
    expect(phCodeOf(await act(w.owner, invoiceActions.voidInvoice, { ...ref(w, paid.id), reason: 'has a payment' }))).toBe('INVOICE_SETTLED');
    const credited = dataOf(await create(w, [iLine(r.lines[0]!, 30)]));
    await prisma().phSupplierInvoice.update({ where: { id: credited.id }, data: { creditedMinor: 1n, status: 'PARTIAL' } });
    expect(phCodeOf(await act(w.owner, invoiceActions.voidInvoice, { ...ref(w, credited.id), reason: 'has a credit' }))).toBe('INVOICE_SETTLED');
    expect(await invoicedOf(r.lines[0]!)).toBe(50);
    expect(await rowOf(paid.id)).toMatchObject({ status: 'PARTIAL', version: 1 });
  });

  it('validates the reason length', async () => {
    const w = await world();
    const r = await received(w, [rLine(w.p)]);
    const a = dataOf(await create(w, [iLine(r.lines[0]!, 10)]));
    expect(codeOf(await act(w.owner, invoiceActions.voidInvoice, { ...ref(w, a.id), reason: 'xx' }))).toBe('INVALID');
    expect(codeOf(await act(w.owner, invoiceActions.voidInvoice, { ...ref(w, a.id), reason: 'x'.repeat(301) }))).toBe('INVALID');
    expect((await rowOf(a.id)).status).toBe('OPEN');
  });

  it('ends two parallel voids in one void, with the counters released once', async () => {
    const w = await world();
    const r = await received(w, [rLine(w.p)]);
    const a = dataOf(await create(w, [iLine(r.lines[0]!, 10)]));
    const results = await Promise.all([act(w.owner, invoiceActions.voidInvoice, { ...ref(w, a.id), reason: 'racing one' }), act(w.owner, invoiceActions.voidInvoice, { ...ref(w, a.id), reason: 'racing two' })]);
    expect(results.map(codeOf).sort()).toEqual(['CONFLICT', 'OK']);
    expect(await invoicedOf(r.lines[0]!)).toBe(0);
  });
});

describe('the total check at commit', () => {
  it('maps the database’s deferred total check (23514) to INVOICE_TOTAL_MISMATCH', async () => {
    const w = await world();
    const r = await received(w, [rLine(w.p)]);
    let caught: unknown;
    try {
      await prisma().$transaction(async (tx) => {
        const inv = await tx.phSupplierInvoice.create({
          data: {
            restaurantId: w.a.id, supplierId: w.supplierId, number: 'TAMPER', numberRaw: 'TAMPER', invoiceDate: new Date('2026-10-21T00:00:00Z'), dueDate: new Date('2026-10-21T00:00:00Z'),
            currency: 'IQD', totalMinor: 999n, fingerprint: 'fp-tamper', clientKey: 'tamper-key-1', createdById: w.owner.userId,
          },
          select: { id: true },
        });
        await tx.phSupplierInvoiceLine.create({ data: { restaurantId: w.a.id, invoiceId: inv.id, lineNo: 1, receiptLineId: r.lines[0]!, qtyInvoiced: 1, unitCostMinor: 100n, lineTotalMinor: 100n } });
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeDefined();
    const mapped = asInvoiceError(caught) as { code?: string; fields?: Record<string, string> };
    expect(mapped.code).toBe('CONFLICT');
    expect(mapped.fields?.phCode).toBe('INVOICE_TOTAL_MISMATCH');
    expect(await prisma().phSupplierInvoice.count()).toBe(0);
    // Other errors are not touched.
    const other = new Error('boom');
    expect(asInvoiceError(other)).toBe(other);
  });
});

describe('who may use invoices', () => {
  it('lets STOCK create but not void; ACCOUNTANT, BRANCH_MANAGER and PIC do both; PHARMACIST and CASHIER and a support grant do neither', async () => {
    const w = await world();
    const r = await received(w, [rLine(w.p, { qty: 1000 })]);
    const mk = async (role: 'STOCK' | 'ACCOUNTANT' | 'BRANCH_MANAGER' | 'PHARMACIST_IN_CHARGE') => person(role.toLowerCase(), { staff: [w.a.id, role, [w.a.branchId]] });
    const made = dataOf(await create(w, [iLine(r.lines[0]!, 1)]));

    const stock = await mk('STOCK');
    const byStock = dataOf(await act(stock, invoiceActions.create, body(w, [iLine(r.lines[0]!, 1)])));
    expect(codeOf(await act(stock, invoiceActions.voidInvoice, { ...ref(w, byStock.id), reason: 'stock may not void' }))).toBe('FORBIDDEN');
    expect(codeOf(await ask(stock, invoiceQueries.list, { restaurantId: w.a.id }))).toBe('OK');
    expect(codeOf(await ask(stock, invoiceQueries.get, { restaurantId: w.a.id, invoiceId: byStock.id }))).toBe('OK');
    expect((await rowOf(byStock.id)).status).toBe('OPEN');

    for (const role of ['ACCOUNTANT', 'BRANCH_MANAGER', 'PHARMACIST_IN_CHARGE'] as const) {
      const who = await mk(role);
      const mine = dataOf(await act(who, invoiceActions.create, body(w, [iLine(r.lines[0]!, 1)])));
      expect(codeOf(await act(who, invoiceActions.voidInvoice, { ...ref(w, mine.id), reason: 'allowed to void' })), role).toBe('OK');
    }

    for (const role of ['PHARMACIST', 'CASHIER'] as const) {
      const who = await person(role.toLowerCase(), { staff: [w.a.id, role, [w.a.branchId]] });
      expect(codeOf(await act(who, invoiceActions.create, body(w, [iLine(r.lines[0]!, 1)]))), role).toBe('FORBIDDEN');
      expect(codeOf(await act(who, invoiceActions.voidInvoice, { ...ref(w, made.id), reason: 'not allowed' })), role).toBe('FORBIDDEN');
      expect(codeOf(await ask(who, invoiceQueries.list, { restaurantId: w.a.id })), role).toBe('FORBIDDEN');
      expect(codeOf(await ask(who, invoiceQueries.get, { restaurantId: w.a.id, invoiceId: made.id })), role).toBe('FORBIDDEN');
      expect(codeOf(await ask(who, invoiceQueries.variance, { restaurantId: w.a.id, invoiceId: made.id })), role).toBe('FORBIDDEN');
      expect(codeOf(await ask(who, invoiceQueries.invoiceable, { restaurantId: w.a.id, supplierId: w.supplierId })), role).toBe('FORBIDDEN');
    }
    const admin = await person('support', { superAdmin: true });
    await grant(admin, w.a.id, { scopes: ['catalog.read', 'stock.read'] });
    expect(codeOf(await act(admin, invoiceActions.create, body(w, [iLine(r.lines[0]!, 1)])))).toBe('FORBIDDEN');
    expect(codeOf(await act(admin, invoiceActions.voidInvoice, { ...ref(w, made.id), reason: 'support may not' }))).toBe('FORBIDDEN');
    expect(codeOf(await ask(admin, invoiceQueries.list, { restaurantId: w.a.id }))).toBe('FORBIDDEN');
    expect(codeOf(await ask(admin, invoiceQueries.get, { restaurantId: w.a.id, invoiceId: made.id }))).toBe('FORBIDDEN');
    expect((await rowOf(made.id)).status).toBe('OPEN');
  });
});

describe('another business', () => {
  it('treats a foreign receipt line, supplier and invoice as not found, and changes nothing of theirs', async () => {
    const w = await world();
    const b = await pharmacy('B');
    const ownerB = await person('ownerb', { membership: [b.id, 'OWNER'] });
    const supplierB = await prisma().phSupplier.create({
      data: { restaurantId: b.id, name: 'Theirs', nameKey: 'theirs', defaultCurrency: 'IQD', clientKey: 'theirs-key-2', createdById: ownerB.userId },
      select: { id: true },
    });
    const productB = await makeProduct(b.id, 'Theirs');
    const theirReceipt = dataOf(
      await act(ownerB, receiptActions.create, {
        restaurantId: b.id, branchId: b.branchId, clientKey: 'theirs-rcpt-key-1', supplierId: supplierB.id, supplierName: '', reference: 'T', receivedOn: '2026-10-20', lines: [rLine(productB)],
      }),
    );
    dataOf(await act(ownerB, receiptActions.confirm, { restaurantId: b.id, branchId: b.branchId, receiptId: theirReceipt.id }));
    const theirLine = (await prisma().phReceiptLine.findFirstOrThrow({ where: { receiptId: theirReceipt.id } })).id;
    const theirs = dataOf(await act(ownerB, invoiceActions.create, { restaurantId: b.id, clientKey: 'theirs-inv-key-1', supplierId: supplierB.id, number: 'T-1', invoiceDate: '2026-10-21', currency: 'IQD', lines: [iLine(theirLine, 5)] }));
    const before = await rowOf(theirs.id);
    const lineBefore = await prisma().phReceiptLine.findUniqueOrThrow({ where: { id: theirLine } });

    expect(codeOf(await create(w, [iLine(theirLine, 1)]))).toBe('NOT_FOUND');
    expect(codeOf(await create(w, [iLine(theirLine, 1)], { supplierId: supplierB.id }))).toBe('NOT_FOUND');
    expect(codeOf(await act(w.owner, invoiceActions.voidInvoice, { ...ref(w, theirs.id), reason: 'not mine at all' }))).toBe('NOT_FOUND');
    expect(codeOf(await ask(w.owner, invoiceQueries.get, { restaurantId: w.a.id, invoiceId: theirs.id }))).toBe('NOT_FOUND');
    expect(codeOf(await ask(w.owner, invoiceQueries.variance, { restaurantId: w.a.id, invoiceId: theirs.id }))).toBe('NOT_FOUND');
    expect(codeOf(await ask(w.owner, invoiceQueries.invoiceable, { restaurantId: w.a.id, supplierId: supplierB.id }))).toBe('NOT_FOUND');
    expect(dataOf(await ask(w.owner, invoiceQueries.list, { restaurantId: w.a.id })).items).toHaveLength(0);
    expect(await rowOf(theirs.id)).toEqual(before);
    expect(await prisma().phReceiptLine.findUniqueOrThrow({ where: { id: theirLine } })).toEqual(lineBefore);
    expect(codeOf(await ask(w.owner, invoiceQueries.list, { restaurantId: b.id }))).not.toBe('OK');
  });
});

describe('invoiceable receipt lines', () => {
  it('lists confirmed lines of the supplier with something left to invoice, with the labels the entry screen needs', async () => {
    const w = await world();
    const r = await received(w, [rLine(w.p, { qty: 100, bonusQty: 10, lot: 'LOT-A' }), rLine(w.q, { qty: 20, lot: 'LOT-B' })]);
    await received(w, [rLine(w.p)], { supplierId: w.supplierB });
    await received(w, [rLine(w.p)], { supplierId: undefined, supplierName: 'Legacy' });
    dataOf(await create(w, [iLine(r.lines[1]!, 20)])); // fully invoiced: drops out
    dataOf(await create(w, [iLine(r.lines[0]!, 30)]));
    const got = dataOf(await ask(w.owner, invoiceQueries.invoiceable, { restaurantId: w.a.id, supplierId: w.supplierId }));
    expect(got.items).toHaveLength(1);
    expect(got.items[0]).toMatchObject({
      receiptLineId: r.lines[0],
      receiptId: r.id,
      receiptDate: '2026-10-20',
      productName: 'Panadol',
      unitLabel: 'strip',
      lot: 'LOT-A',
      expiry: '2028-03-15',
      qty: 100,
      bonusQty: 10,
      invoicedQty: 30,
      invoiceableQty: 80,
      currency: 'IQD',
      unitCostMinor: '2500',
    });
    expect(typeof got.items[0]!.receiptNumber).toBe('string');
  });
});

describe('reading invoices', () => {
  async function makeThree(w: World) {
    const r = await received(w, [rLine(w.p, { qty: 100, lot: 'LOT-1' }), rLine(w.q, { qty: 50, unitCostMinor: '1000', lot: 'LOT-2' })]);
    const one = dataOf(await create(w, [iLine(r.lines[0]!, 10), iLine(r.lines[1]!, 5, '1000')], { number: 'ZZ-100', invoiceDate: '2026-09-01', dueDate: '2026-10-01' })); // 26 days overdue at NOW (Oct 27)
    const two = dataOf(await create(w, [iLine(r.lines[0]!, 20)], { number: 'AA-200', invoiceDate: '2026-10-20' })); // due Nov 19
    const three = dataOf(await create(w, [iLine(r.lines[1]!, 10, '1000')], { number: 'AA-300', invoiceDate: '2026-10-25', dueDate: '2026-10-30' })); // due in 3 days
    return { r, one, two, three };
  }

  it('gets an invoice with lines, labels, totals, paid, credited, balance and status', async () => {
    const w = await world();
    const { r, one } = await makeThree(w);
    await prisma().phSupplierInvoice.update({ where: { id: one.id }, data: { paidMinor: 20000n, creditedMinor: 1000n, status: 'PARTIAL' } });
    const got = dataOf(await ask(w.owner, invoiceQueries.get, { restaurantId: w.a.id, invoiceId: one.id }));
    expect(got).toMatchObject({
      id: one.id,
      number: 'ZZ-100',
      numberRaw: 'ZZ-100',
      supplierId: w.supplierId,
      supplierName: 'Al-Noor',
      status: 'PARTIAL',
      currency: 'IQD',
      invoiceDate: '2026-09-01',
      dueDate: '2026-10-01',
      totalMinor: '30000',
      paidMinor: '20000',
      creditedMinor: '1000',
      balanceMinor: '9000',
      adjustmentMinor: '0',
      version: 1,
    });
    expect(got.lines).toHaveLength(2);
    expect(got.lines[0]).toMatchObject({ lineNo: 1, receiptLineId: r.lines[0], productName: 'Panadol', unitLabel: 'strip', lot: 'LOT-1', expiry: '2028-03-15', qtyInvoiced: 10, unitCostMinor: '2500', lineTotalMinor: '25000', receiptId: r.id });
    expect(typeof got.lines[0]!.receiptNumber).toBe('string');
  });

  it('lists with filters: supplier, status, dates, overdue, number search; with balance and due band; newest first', async () => {
    const w = await world();
    const { one, two, three } = await makeThree(w);
    const all = dataOf(await ask(w.owner, invoiceQueries.list, { restaurantId: w.a.id }));
    expect(all.items.map((i) => i.id)).toEqual([three.id, two.id, one.id]);
    const bands = Object.fromEntries(all.items.map((i) => [i.id, i.dueBand]));
    expect(bands).toEqual({ [one.id]: 'OVERDUE_1_30', [two.id]: 'NOT_DUE', [three.id]: 'DUE_7' });
    expect(all.items.find((i) => i.id === one.id)).toMatchObject({ numberRaw: 'ZZ-100', supplierName: 'Al-Noor', totalMinor: '30000', balanceMinor: '30000', status: 'OPEN' });

    expect(dataOf(await ask(w.owner, invoiceQueries.list, { restaurantId: w.a.id, overdue: true })).items.map((i) => i.id)).toEqual([one.id]);
    expect(dataOf(await ask(w.owner, invoiceQueries.list, { restaurantId: w.a.id, search: 'aa-' })).items.map((i) => i.id)).toEqual([three.id, two.id]);
    expect(dataOf(await ask(w.owner, invoiceQueries.list, { restaurantId: w.a.id, from: '2026-10-01', to: '2026-10-22' })).items.map((i) => i.id)).toEqual([two.id]);
    expect(dataOf(await ask(w.owner, invoiceQueries.list, { restaurantId: w.a.id, supplierId: w.supplierB })).items).toHaveLength(0);
    await prisma().phSupplierInvoice.update({ where: { id: two.id }, data: { paidMinor: 50000n, status: 'PAID' } });
    expect(dataOf(await ask(w.owner, invoiceQueries.list, { restaurantId: w.a.id, status: 'PAID' })).items.map((i) => [i.id, i.dueBand, i.balanceMinor])).toEqual([[two.id, null, '0']]);
    // A settled invoice is never overdue, even past its due date.
    await prisma().phSupplierInvoice.update({ where: { id: one.id }, data: { paidMinor: 30000n, status: 'PAID' } });
    expect(dataOf(await ask(w.owner, invoiceQueries.list, { restaurantId: w.a.id, overdue: true })).items).toHaveLength(0);
  });

  it('pages 50 at a time by cursor', async () => {
    const w = await world();
    const rows = Array.from({ length: 55 }, (_, i) => ({
      restaurantId: w.a.id, supplierId: w.supplierId, number: `P-${i}`, numberRaw: `P-${i}`, invoiceDate: new Date('2026-10-21T00:00:00Z'), dueDate: new Date('2026-11-21T00:00:00Z'),
      currency: 'IQD' as const, totalMinor: 0n, fingerprint: `fp-${i}`, clientKey: `page-key-${i}-aaaa`, createdById: w.owner.userId,
    }));
    await prisma().phSupplierInvoice.createMany({ data: rows });
    const first = dataOf(await ask(w.owner, invoiceQueries.list, { restaurantId: w.a.id }));
    expect(first.items).toHaveLength(50);
    expect(first.nextCursor).not.toBeNull();
    const second = dataOf(await ask(w.owner, invoiceQueries.list, { restaurantId: w.a.id, cursor: first.nextCursor }));
    expect(second.items).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map((i) => i.id)).size).toBe(55);
  });

  it('keeps every invoice when the cursor invoice leaves the status filter between two pages', async () => {
    const w = await world();
    const rows = Array.from({ length: 55 }, (_, i) => ({
      restaurantId: w.a.id, supplierId: w.supplierId, number: `Q-${i}`, numberRaw: `Q-${i}`, invoiceDate: new Date('2026-10-21T00:00:00Z'), dueDate: new Date('2026-11-21T00:00:00Z'),
      currency: 'IQD' as const, totalMinor: 0n, fingerprint: `fq-${i}`, clientKey: `keyset-key-${i}-aaaa`, createdById: w.owner.userId,
    }));
    await prisma().phSupplierInvoice.createMany({ data: rows });
    const first = dataOf(await ask(w.owner, invoiceQueries.list, { restaurantId: w.a.id, status: 'OPEN' }));
    expect(first.items).toHaveLength(50);
    // The invoice the next page continues from is paid in the meantime.
    await prisma().phSupplierInvoice.update({ where: { id: first.nextCursor! }, data: { status: 'PAID' } });
    const second = dataOf(await ask(w.owner, invoiceQueries.list, { restaurantId: w.a.id, status: 'OPEN', cursor: first.nextCursor }));
    expect(second.items).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map((i) => i.id)).size).toBe(55);
    expect(codeOf(await ask(w.owner, invoiceQueries.list, { restaurantId: w.a.id, cursor: 'nope' }))).toBe('INVALID');
  });

  it('shows the three cost variances per line (order, received, invoiced) and the positive and negative totals', async () => {
    const w = await world();
    // The order says 2500 and 1000; goods arrive booked at 2600 and 1000; the invoice says 2700, 900 and a line with no order.
    const order = dataOf(
      await act(w.owner, poActions.create, {
        restaurantId: w.a.id, branchId: w.a.branchId, clientKey: `po-key-${(keySeq += 1)}-aaaa`, supplierId: w.supplierId, currency: 'IQD',
        lines: [
          { productId: w.p.id, unitId: w.p.strip, qtyOrdered: 100, unitCostMinor: '2500' },
          { productId: w.q.id, unitId: w.q.strip, qtyOrdered: 50, unitCostMinor: '1000' },
        ],
      }),
    );
    dataOf(await act(w.owner, poActions.order, { restaurantId: w.a.id, branchId: w.a.branchId, purchaseOrderId: order.id, expectedVersion: 1 }));
    const pol = await prisma().phPurchaseOrderLine.findMany({ where: { purchaseOrderId: order.id }, orderBy: { lineNo: 'asc' } });
    const r = await received(
      w,
      [
        rLine(w.p, { qty: 100, unitCostMinor: '2600', purchaseOrderLineId: pol[0]!.id }),
        rLine(w.q, { qty: 50, unitCostMinor: '1000', purchaseOrderLineId: pol[1]!.id }),
      ],
      { purchaseOrderId: order.id },
    );
    const noOrder = await received(w, [rLine(w.p, { qty: 10, unitCostMinor: '2000' })]);
    const inv = dataOf(await create(w, [iLine(r.lines[0]!, 100, '2700'), iLine(r.lines[1]!, 50, '900'), iLine(noOrder.lines[0]!, 10, '2000')]));
    const got = dataOf(await ask(w.owner, invoiceQueries.variance, { restaurantId: w.a.id, invoiceId: inv.id }));
    expect(got.lines).toHaveLength(3);
    expect(got.lines[0]).toMatchObject({ lineNo: 1, productName: 'Panadol', qtyInvoiced: 100, orderedUnitCostMinor: '2500', receivedUnitCostMinor: '2600', invoicedUnitCostMinor: '2700', orderVsReceived: '100', receivedVsInvoiced: '100', orderVsInvoiced: '200' });
    expect(got.lines[1]).toMatchObject({ orderedUnitCostMinor: '1000', receivedUnitCostMinor: '1000', invoicedUnitCostMinor: '900', orderVsReceived: '0', receivedVsInvoiced: '-100', orderVsInvoiced: '-100' });
    expect(got.lines[2]).toMatchObject({ orderedUnitCostMinor: null, receivedUnitCostMinor: '2000', invoicedUnitCostMinor: '2000', orderVsReceived: null, receivedVsInvoiced: '0', orderVsInvoiced: null });
    // Money against the received cost: +100 x 100 = +10000 and -100 x 50 = -5000.
    expect(got).toMatchObject({ currency: 'IQD', positiveMinor: '10000', negativeMinor: '-5000', netMinor: '5000' });
  });

  it('shows no money to a role without cost.view (list, get)', async () => {
    const w = await world();
    const { one } = await makeThree(w);
    const clerk = await person('pharmacist', { staff: [w.a.id, 'PHARMACIST', [w.a.branchId]] });
    const ph = (await asPh(clerk.userId, w.a.id, w.a.branchId))!;
    expect(ph.role).toBe('PHARMACIST');
    const scoped = scopedClient(prisma(), { restaurantId: w.a.id, branchIds: ph.branchIds });
    const got = await getInvoice(scoped, ph, one.id);
    expect(got.lines).toHaveLength(2);
    const text = JSON.stringify(got);
    for (const key of ['unitCostMinor', 'lineTotalMinor', 'totalMinor', 'paidMinor', 'creditedMinor', 'balanceMinor', 'adjustmentMinor']) expect(text, key).not.toContain(key);
    const listed = await listInvoices(scoped, ph, {});
    expect(listed.items).toHaveLength(3);
    const listedText = JSON.stringify(listed);
    for (const key of ['totalMinor', 'paidMinor', 'balanceMinor']) expect(listedText, key).not.toContain(key);
    expect(listed.items[0]).toHaveProperty('dueBand');
  });
});

describe('the clock', () => {
  it('bands follow the day of now', async () => {
    const w = await world();
    const r = await received(w, [rLine(w.p)]);
    const made = dataOf(await create(w, [iLine(r.lines[0]!, 1)], { dueDate: '2026-10-27' }));
    expect(dataOf(await ask(w.owner, invoiceQueries.list, { restaurantId: w.a.id })).items.find((i) => i.id === made.id)?.dueBand).toBe('DUE_7');
    vi.setSystemTime(new Date(NOW.getTime() + 9 * DAY));
    expect(dataOf(await ask(w.owner, invoiceQueries.list, { restaurantId: w.a.id })).items.find((i) => i.id === made.id)?.dueBand).toBe('OVERDUE_1_30');
  });
});

describe('review fixes (task 6b)', () => {
  /** Panadol received in branch 1 on the 20th, Brufen in branch 2 on the 25th; one invoice bills both (made by the owner). */
  async function twoBranches(w: World) {
    const r0 = await received(w, [rLine(w.p, { qty: 100, lot: 'B1-LOT', unitCostMinor: '2600' })], { receivedOn: '2026-10-20' }, 0);
    const r1 = await received(w, [rLine(w.q, { qty: 50, lot: 'B2-LOT', unitCostMinor: '1000' })], { receivedOn: '2026-10-25' }, 1);
    const both = dataOf(await create(w, [iLine(r0.lines[0]!, 10, '2700'), iLine(r1.lines[0]!, 5, '900')], { number: 'MIX-1' }));
    const onlyTwo = dataOf(await create(w, [iLine(r1.lines[0]!, 5, '1000')], { number: 'TWO-1' }));
    const limited = await person('limited2', { staff: [w.a.id, 'ACCOUNTANT', [w.a.branchIds[1]!]] });
    return { r0, r1, both, onlyTwo, limited };
  }

  it('a branch-limited actor bills only receipt lines of their branch, and creates with them', async () => {
    const w = await world();
    const { r0, r1, limited } = await twoBranches(w);
    expect(codeOf(await act(limited, invoiceActions.create, body(w, [iLine(r0.lines[0]!, 1)])))).toBe('NOT_FOUND');
    expect(codeOf(await act(limited, invoiceActions.create, body(w, [iLine(r1.lines[0]!, 1)])))).toBe('OK');
  });

  it('get redacts the receipt detail of a branch the actor lacks and keeps product, unit, quantity, invoiced cost and line total', async () => {
    const w = await world();
    const { r0, r1, both, limited } = await twoBranches(w);
    const got = dataOf(await ask(limited, invoiceQueries.get, { restaurantId: w.a.id, invoiceId: both.id }));
    expect(got.lines).toHaveLength(2);
    const [hidden, shown] = got.lines;
    expect(hidden).toMatchObject({ lineNo: 1, productName: 'Panadol', unitLabel: 'strip', qtyInvoiced: 10, unitCostMinor: '2700', lineTotalMinor: '27000', redacted: true, receiptId: null, receiptNumber: null, lot: null, expiry: null });
    expect(shown).toMatchObject({ lineNo: 2, productName: 'Brufen', redacted: false, receiptId: r1.id, lot: 'B2-LOT', expiry: '2028-03-15' });
    const text = JSON.stringify(got);
    for (const secret of [r0.id, r0.lines[0]!, 'B1-LOT']) expect(text).not.toContain(secret);
    // The owner sees everything.
    const all = dataOf(await ask(w.owner, invoiceQueries.get, { restaurantId: w.a.id, invoiceId: both.id }));
    expect(all.lines.map((l) => [l.redacted, l.lot])).toEqual([[false, 'B1-LOT'], [false, 'B2-LOT']]);
  });

  it('variance hides the received and order cost of a branch the actor lacks, and totals only what they may see', async () => {
    const w = await world();
    const { both, limited } = await twoBranches(w);
    const got = dataOf(await ask(limited, invoiceQueries.variance, { restaurantId: w.a.id, invoiceId: both.id }));
    expect(got.lines[0]).toMatchObject({ redacted: true, productName: 'Panadol', invoicedUnitCostMinor: '2700', orderedUnitCostMinor: null, receivedUnitCostMinor: null, orderVsReceived: null, receivedVsInvoiced: null, orderVsInvoiced: null });
    expect(got.lines[1]).toMatchObject({ redacted: false, receivedUnitCostMinor: '1000', receivedVsInvoiced: '-100' });
    // Only the visible line counts: -100 x 5.
    expect(got).toMatchObject({ positiveMinor: '0', negativeMinor: '-500', netMinor: '-500' });
    const all = dataOf(await ask(w.owner, invoiceQueries.variance, { restaurantId: w.a.id, invoiceId: both.id }));
    expect(all).toMatchObject({ positiveMinor: '1000', negativeMinor: '-500' });
  });

  it('void is refused with INVOICE_OTHER_BRANCH when a line belongs to a branch the actor lacks, and allowed for their own', async () => {
    const w = await world();
    const { both, onlyTwo, r0, limited } = await twoBranches(w);
    const refused = await act(limited, invoiceActions.voidInvoice, { ...ref(w, both.id), reason: 'not mine to void' });
    expect(codeOf(refused)).toBe('FORBIDDEN');
    expect(phCodeOf(refused)).toBe('INVOICE_OTHER_BRANCH');
    expect(await rowOf(both.id)).toMatchObject({ status: 'OPEN', version: 1 });
    expect(await invoicedOf(r0.lines[0]!)).toBe(10);
    expect(codeOf(await act(limited, invoiceActions.voidInvoice, { ...ref(w, onlyTwo.id), reason: 'my branch only' }))).toBe('OK');
  });

  it('list shows the invoice header to a branch-limited actor and invoiceable offers only their branch, filtered before the 200 limit', async () => {
    const w = await world();
    const { r0, r1, limited } = await twoBranches(w);
    expect(dataOf(await ask(limited, invoiceQueries.list, { restaurantId: w.a.id })).items).toHaveLength(2);
    // 205 more uninvoiced lines of branch 1's older receipt: they would fill the limit of 200 ahead of branch 2's line.
    const base = await prisma().phReceiptLine.findUniqueOrThrow({ where: { id: r0.lines[0]! } });
    await prisma().phReceiptLine.createMany({
      data: Array.from({ length: 205 }, (_, i) => ({
        restaurantId: w.a.id, receiptId: r0.id, lineNo: 10 + i, productId: base.productId, unitId: base.unitId, qty: 5, baseQty: 50, lot: `bulk-${i}`, expiryDate: base.expiryDate,
      })),
    });
    const owner = dataOf(await ask(w.owner, invoiceQueries.invoiceable, { restaurantId: w.a.id, supplierId: w.supplierId }));
    expect(owner.items).toHaveLength(200);
    const got = dataOf(await ask(limited, invoiceQueries.invoiceable, { restaurantId: w.a.id, supplierId: w.supplierId }));
    expect(got.items.map((i) => i.receiptLineId)).toEqual([r1.lines[0]]);
    expect(JSON.stringify(got)).not.toContain(r0.id);
  });

  it('variance gives no order figures when the order currency differs from the receipt and invoice currency, and names the order currency', async () => {
    const w = await world();
    const order = dataOf(
      await act(w.owner, poActions.create, {
        restaurantId: w.a.id, branchId: w.a.branchId, clientKey: `po-key-${(keySeq += 1)}-aaaa`, supplierId: w.supplierId, currency: 'USD',
        lines: [{ productId: w.p.id, unitId: w.p.strip, qtyOrdered: 10, unitCostMinor: '150' }],
      }),
    );
    dataOf(await act(w.owner, poActions.order, { restaurantId: w.a.id, branchId: w.a.branchId, purchaseOrderId: order.id, expectedVersion: 1 }));
    const pol = await prisma().phPurchaseOrderLine.findFirstOrThrow({ where: { purchaseOrderId: order.id } });
    const r = await received(w, [rLine(w.p, { qty: 10, unitCostMinor: '2600', currency: 'IQD', purchaseOrderLineId: pol.id })], { purchaseOrderId: order.id });
    const inv = dataOf(await create(w, [iLine(r.lines[0]!, 10, '2700')]));
    const got = dataOf(await ask(w.owner, invoiceQueries.variance, { restaurantId: w.a.id, invoiceId: inv.id }));
    expect(got.lines[0]).toMatchObject({ orderedUnitCostMinor: '150', orderCurrency: 'USD', orderVsReceived: null, orderVsInvoiced: null, receivedVsInvoiced: '100' });
  });

  it('answers DUPLICATE_INVOICE, not INVOICE_EXCEEDS_RECEIVED, to the loser of two parallel entries of the whole quantity under one number', async () => {
    const w = await world();
    const r = await received(w, [rLine(w.p, { qty: 100 })]);
    const results = await Promise.all([create(w, [iLine(r.lines[0]!, 100)], { number: 'FULL-1' }), create(w, [iLine(r.lines[0]!, 100)], { number: 'FULL-1' })]);
    expect(results.map(codeOf).sort()).toEqual(['CONFLICT', 'OK']);
    const lost = results.find((x) => !x.ok)!;
    const won = results.find((x) => x.ok)!;
    expect(phCodeOf(lost)).toBe('DUPLICATE_INVOICE');
    expect(!lost.ok && lost.error.fields?.existingInvoiceId).toBe(won.ok && won.data.id);
    expect(await invoicedOf(r.lines[0]!)).toBe(100);
  });

  it('maps a commit-time total mismatch to INVOICE_TOTAL_MISMATCH through the action, with no row, no counter and no audit', async () => {
    const w = await world();
    const r = await received(w, [rLine(w.p)]);
    const domain = await import('@/server/domain/pharmacy/purchasing');
    const spy = vi.spyOn(domain, 'invoiceTotal').mockImplementation((lines, adjustment) => lines.reduce((a, b) => a + b, adjustment) + 1n);
    try {
      const result = await create(w, [iLine(r.lines[0]!, 10)]);
      expect(codeOf(result)).toBe('CONFLICT');
      expect(phCodeOf(result)).toBe('INVOICE_TOTAL_MISMATCH');
    } finally {
      spy.mockRestore();
    }
    expect(await prisma().phSupplierInvoice.count()).toBe(0);
    expect(await invoicedOf(r.lines[0]!)).toBe(0);
    expect(await prisma().auditLog.count({ where: { action: 'ph.invoice.create' } })).toBe(0);
  });

  it('searches the normalised number too (Arabic-Indic digits, case, spacing)', async () => {
    const w = await world();
    const r = await received(w, [rLine(w.p)]);
    const made = dataOf(await create(w, [iLine(r.lines[0]!, 1)], { number: 'ab-123' }));
    for (const search of ['AB-١٢٣', 'ab-123', 'B-12']) {
      expect(dataOf(await ask(w.owner, invoiceQueries.list, { restaurantId: w.a.id, search })).items.map((i) => i.id), search).toEqual([made.id]);
    }
    expect(dataOf(await ask(w.owner, invoiceQueries.list, { restaurantId: w.a.id, search: 'zzz' })).items).toHaveLength(0);
  });
});
