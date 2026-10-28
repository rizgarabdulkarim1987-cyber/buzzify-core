import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { scopedClient } from '@/server/data/tenant-db';
import * as receiptActions from '@/server/pharmacy/actions/receipts';
import * as invoiceActions from '@/server/pharmacy/actions/supplier-invoices';
import * as payActions from '@/server/pharmacy/actions/supplier-payments';
import * as payQueries from '@/server/pharmacy/queries/supplier-payments';
import { getPayment, listPayments } from '@/server/pharmacy/supplier-payments';
import { grant, NOW, asPh, person, pharmacy, prisma, resetWorld, useTestDatabase } from './fixture';
import { act, ask, codeOf, dataOf, makeProduct, phCodeOf } from './stock-helpers';

let keySeq = 0;
const nextKey = (prefix: string) => `${prefix}-${(keySeq += 1)}-aaaa`;
type World = Awaited<ReturnType<typeof world>>;

async function world(label = 'A') {
  const a = await pharmacy(label, { branches: 2 });
  const owner = await person(`owner${label}`, { membership: [a.id, 'OWNER'] });
  const mkSupplier = (name: string) =>
    prisma().phSupplier.create({
      data: { restaurantId: a.id, name, nameKey: name.toLowerCase(), defaultCurrency: 'IQD', termsDays: 30, clientKey: nextKey('sup'), createdById: owner.userId },
      select: { id: true },
    });
  const supplier = await mkSupplier('Al-Noor');
  const supplierB = await mkSupplier('Beta Pharma');
  const p = await makeProduct(a.id, 'Panadol');
  return { a, owner, supplierId: supplier.id, supplierB: supplierB.id, p };
}

/** A confirmed receipt of one line and an invoice of that whole line: an invoice of exactly `total` minor units. */
async function invoice(w: World, total: number | string, over: { supplierId?: string; currency?: 'IQD' | 'USD'; dueDate?: string } = {}): Promise<string> {
  const currency = over.currency ?? 'IQD';
  const supplierId = over.supplierId ?? w.supplierId;
  const made = dataOf(
    await act(w.owner, receiptActions.create, {
      restaurantId: w.a.id,
      branchId: w.a.branchIds[0],
      clientKey: nextKey('rcpt'),
      supplierId,
      supplierName: '',
      reference: 'GRN',
      receivedOn: '2026-10-20',
      lines: [{ productId: w.p.id, unitId: w.p.strip, qty: 1, lot: nextKey('lot'), expiry: '2028-03-15', unitCostMinor: String(total), currency }],
    }),
  );
  dataOf(await act(w.owner, receiptActions.confirm, { restaurantId: w.a.id, branchId: w.a.branchIds[0], receiptId: made.id }));
  const line = await prisma().phReceiptLine.findFirstOrThrow({ where: { receiptId: made.id }, select: { id: true } });
  return dataOf(
    await act(w.owner, invoiceActions.create, {
      restaurantId: w.a.id,
      clientKey: nextKey('inv'),
      supplierId,
      number: nextKey('INV'),
      invoiceDate: '2026-10-21',
      dueDate: over.dueDate ?? '2026-11-20',
      currency,
      lines: [{ receiptLineId: line.id, qtyInvoiced: 1, unitCostMinor: String(total) }],
    }),
  ).id;
}

const rowOf = (id: string) => prisma().phSupplierInvoice.findUniqueOrThrow({ where: { id } });
const figures = async (id: string) => {
  const r = await rowOf(id);
  return { status: r.status, paid: r.paidMinor, credited: r.creditedMinor };
};

const payBody = (w: World, over: Record<string, unknown> = {}) => ({
  restaurantId: w.a.id,
  clientKey: nextKey('pay'),
  supplierId: w.supplierId,
  currency: 'IQD',
  method: 'CASH',
  amountMinor: '1200000',
  paidOn: '2026-10-27',
  reference: '',
  ...over,
});
const pay = (w: World, over: Record<string, unknown> = {}) => act(w.owner, payActions.create, payBody(w, over));
const alloc = (invoiceId: string, amountMinor: number | string) => ({ invoiceId, amountMinor: String(amountMinor) });
const reverse = (w: World, paymentId: string, over: Record<string, unknown> = {}) =>
  act(w.owner, payActions.reverse, { restaurantId: w.a.id, paymentId, reason: 'Paid twice by mistake', clientKey: nextKey('rev'), ...over });

async function creditNote(w: World, amountMinor: number | string, over: { supplierId?: string; currency?: 'IQD' | 'USD'; restaurantId?: string; userId?: string } = {}): Promise<string> {
  const row = await prisma().phCreditNote.create({
    data: {
      restaurantId: over.restaurantId ?? w.a.id,
      supplierId: over.supplierId ?? w.supplierId,
      number: nextKey('CN'),
      currency: over.currency ?? 'IQD',
      amountMinor: BigInt(amountMinor),
      noteDate: new Date('2026-10-25T00:00:00Z'),
      clientKey: nextKey('cn'),
      createdById: over.userId ?? w.owner.userId,
    },
    select: { id: true },
  });
  return row.id;
}
const apply = (w: World, creditNoteId: string, allocations?: unknown[], over: Record<string, unknown> = {}) =>
  act(w.owner, payActions.applyCreditNote, { restaurantId: w.a.id, clientKey: nextKey('cr'), creditNoteId, ...(allocations ? { allocations } : {}), ...over });
const noteOf = (id: string) => prisma().phCreditNote.findUniqueOrThrow({ where: { id } });

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

describe('paying a supplier', () => {
  it('splits 1,200,000 oldest-due-first over 1,000,000 and 500,000: the first PAID, the second PARTIAL with 300,000 left', async () => {
    const w = await world();
    const later = await invoice(w, 500_000, { dueDate: '2026-11-25' });
    const first = await invoice(w, 1_000_000, { dueDate: '2026-11-10' });
    const made = dataOf(await pay(w, { reference: 'CHQ 77' }));
    expect(made).toMatchObject({ supplierId: w.supplierId, currency: 'IQD', method: 'CASH', amountMinor: '1200000', paidOn: '2026-10-27', replayed: false });
    expect(made.allocations).toEqual([
      { invoiceId: first, amountMinor: '1000000' },
      { invoiceId: later, amountMinor: '200000' },
    ]);
    expect(await figures(first)).toEqual({ status: 'PAID', paid: 1_000_000n, credited: 0n });
    expect(await figures(later)).toEqual({ status: 'PARTIAL', paid: 200_000n, credited: 0n });
    const row = await prisma().phSupplierPayment.findUniqueOrThrow({ where: { id: made.id }, include: { allocations: true } });
    expect(row).toMatchObject({ amountMinor: 1_200_000n, isReversal: false, reversesId: null, reference: 'CHQ 77', createdById: w.owner.userId });
    expect(row.allocations.map((a) => [a.invoiceId, a.amountMinor, a.supplierId, a.currency]).sort()).toEqual(
      [[first, 1_000_000n, w.supplierId, 'IQD'], [later, 200_000n, w.supplierId, 'IQD']].sort(),
    );
    // The invoice version moved, so a stale void is a CONFLICT, not a success.
    expect((await rowOf(later)).version).toBe(2);
  });

  it('allocates as told when told: 100,000 and 400,000 leave both PARTIAL', async () => {
    const w = await world();
    const a = await invoice(w, 1_000_000);
    const b = await invoice(w, 500_000);
    const made = dataOf(await pay(w, { amountMinor: '500000', allocations: [alloc(a, 100_000), alloc(b, 400_000)] }));
    expect(made.allocations).toHaveLength(2);
    expect(await figures(a)).toEqual({ status: 'PARTIAL', paid: 100_000n, credited: 0n });
    expect(await figures(b)).toEqual({ status: 'PARTIAL', paid: 400_000n, credited: 0n });
  });

  it('refuses a payment that cannot be placed (UNALLOCATED) and writes nothing: 2,000,000 against 1,500,000 open', async () => {
    const w = await world();
    const a = await invoice(w, 1_000_000);
    const b = await invoice(w, 500_000);
    const result = await pay(w, { amountMinor: '2000000' });
    expect(phCodeOf(result)).toBe('UNALLOCATED');
    expect(codeOf(result)).toBe('CONFLICT');
    expect(await prisma().phSupplierPayment.count()).toBe(0);
    expect((await figures(a)).paid + (await figures(b)).paid).toBe(0n);
    // Explicit parts that do not add up to the amount are the same refusal.
    expect(phCodeOf(await pay(w, { amountMinor: '600000', allocations: [alloc(a, 100_000)] }))).toBe('UNALLOCATED');
    expect(await prisma().phSupplierPayment.count()).toBe(0);
  });

  it('refuses more than an invoice balance (OVER_ALLOCATION), more than the amount, and a settled invoice', async () => {
    const w = await world();
    const a = await invoice(w, 1_000_000);
    const b = await invoice(w, 500_000);
    expect(phCodeOf(await pay(w, { amountMinor: '600000', allocations: [alloc(b, 600_000)] }))).toBe('OVER_ALLOCATION');
    expect(phCodeOf(await pay(w, { amountMinor: '100000', allocations: [alloc(a, 60_000), alloc(b, 60_000)] }))).toBe('OVER_ALLOCATION');
    dataOf(await pay(w, { amountMinor: '500000', allocations: [alloc(b, 500_000)] }));
    expect(await figures(b)).toEqual({ status: 'PAID', paid: 500_000n, credited: 0n });
    expect(phCodeOf(await pay(w, { amountMinor: '1', allocations: [alloc(b, 1)] }))).toBe('OVER_ALLOCATION');
    expect(await prisma().phSupplierPayment.count()).toBe(1);
    expect((await figures(a)).paid).toBe(0n);
  });

  it('keeps currencies apart: a USD payment cannot settle an IQD invoice, named or automatic', async () => {
    const w = await world();
    const iqd = await invoice(w, 1_000_000);
    const named = await pay(w, { currency: 'USD', amountMinor: '1000', allocations: [alloc(iqd, 1000)] });
    expect(phCodeOf(named)).toBe('CURRENCY_MISMATCH');
    expect(phCodeOf(await pay(w, { currency: 'USD', amountMinor: '1000' }))).toBe('UNALLOCATED');
    const usd = await invoice(w, 25_000, { currency: 'USD' });
    dataOf(await pay(w, { currency: 'USD', amountMinor: '10000' }));
    expect(await figures(usd)).toEqual({ status: 'PARTIAL', paid: 10_000n, credited: 0n });
    expect((await figures(iqd)).paid).toBe(0n);
  });

  it('does not find another supplier’s invoice, and skips a void invoice when planning', async () => {
    const w = await world();
    const mine = await invoice(w, 300_000);
    const theirs = await invoice(w, 300_000, { supplierId: w.supplierB });
    const wrong = await pay(w, { amountMinor: '100000', allocations: [alloc(theirs, 100_000)] });
    expect(codeOf(wrong)).toBe('NOT_FOUND');
    expect(await prisma().phSupplierPayment.count()).toBe(0);
    expect((await figures(theirs)).paid).toBe(0n);
    // Automatic planning for a supplier never reaches the other supplier's invoices.
    expect(phCodeOf(await pay(w, { amountMinor: '400000' }))).toBe('UNALLOCATED');
    const gone = await invoice(w, 200_000, { dueDate: '2026-11-01' });
    dataOf(await act(w.owner, invoiceActions.voidInvoice, { restaurantId: w.a.id, invoiceId: gone, expectedVersion: 1, reason: 'Entered by mistake' }));
    expect(phCodeOf(await pay(w, { amountMinor: '100000', allocations: [alloc(gone, 100_000)] }))).toBe('INVOICE_VOID');
    const made = dataOf(await pay(w, { amountMinor: '300000' }));
    expect(made.allocations).toEqual([{ invoiceId: mine, amountMinor: '300000' }]);
    expect(await figures(gone)).toEqual({ status: 'VOID', paid: 0n, credited: 0n });
  });

  it('validates the amount, the date, the method and the reference', async () => {
    const w = await world();
    await invoice(w, 1_000_000);
    expect(codeOf(await pay(w, { amountMinor: '0' }))).toBe('INVALID');
    expect(codeOf(await pay(w, { amountMinor: '-5' }))).toBe('INVALID');
    expect(codeOf(await pay(w, { paidOn: '2026-10-29' }))).toBe('INVALID');
    expect(codeOf(await pay(w, { paidOn: '2027-01-01' }))).toBe('INVALID');
    expect(codeOf(await pay(w, { paidOn: '27/10/2026' }))).toBe('INVALID');
    expect(codeOf(await pay(w, { method: 'BARTER' }))).toBe('INVALID');
    expect(codeOf(await pay(w, { reference: 'x'.repeat(101) }))).toBe('INVALID');
    expect(codeOf(await pay(w, { clientKey: 'short' }))).toBe('INVALID');
    expect(codeOf(await pay(w, { allocations: [] }))).toBe('INVALID');
    expect(await prisma().phSupplierPayment.count()).toBe(0);
    // Tomorrow (UTC) is the latest day allowed.
    expect(codeOf(await pay(w, { paidOn: '2026-10-28', amountMinor: '1000' }))).toBe('OK');
  });

  it('pays an archived supplier, and refuses an unknown one', async () => {
    const w = await world();
    const a = await invoice(w, 100_000);
    await prisma().phSupplier.update({ where: { id: w.supplierId }, data: { active: false } });
    expect(codeOf(await pay(w, { amountMinor: '100000' }))).toBe('OK');
    expect((await figures(a)).status).toBe('PAID');
    expect(codeOf(await pay(w, { supplierId: 'no-such-supplier', amountMinor: '100000' }))).toBe('NOT_FOUND');
  });
});

describe('replaying a payment', () => {
  it('returns the stored payment with its stored allocations for the same key and request, and writes one row', async () => {
    const w = await world();
    const a = await invoice(w, 1_000_000);
    const body = payBody(w, { amountMinor: '400000' });
    const first = dataOf(await act(w.owner, payActions.create, body));
    const again = dataOf(await act(w.owner, payActions.create, body));
    expect(again).toMatchObject({ id: first.id, replayed: true, allocations: [{ invoiceId: a, amountMinor: '400000' }] });
    expect(await prisma().phSupplierPayment.count()).toBe(1);
    expect((await figures(a)).paid).toBe(400_000n);
    expect(await prisma().auditLog.count({ where: { action: 'ph.supplierPayment.create' } })).toBe(1);
  });

  it('refuses the same key with another request or another person (CLIENT_KEY_MISMATCH)', async () => {
    const w = await world();
    await invoice(w, 1_000_000);
    const body = payBody(w, { amountMinor: '400000' });
    dataOf(await act(w.owner, payActions.create, body));
    expect(phCodeOf(await act(w.owner, payActions.create, { ...body, amountMinor: '400001' }))).toBe('CLIENT_KEY_MISMATCH');
    expect(phCodeOf(await act(w.owner, payActions.create, { ...body, method: 'TRANSFER_MANUAL' }))).toBe('CLIENT_KEY_MISMATCH');
    expect(phCodeOf(await act(w.owner, payActions.create, { ...body, reference: 'other' }))).toBe('CLIENT_KEY_MISMATCH');
    const other = await person('accountant', { staff: [w.a.id, 'ACCOUNTANT', [w.a.branchId]] });
    expect(phCodeOf(await act(other, payActions.create, body))).toBe('CLIENT_KEY_MISMATCH');
    expect(await prisma().phSupplierPayment.count()).toBe(1);
  });

  it('makes one payment of two parallel requests with one key', async () => {
    const w = await world();
    const a = await invoice(w, 1_000_000);
    const body = payBody(w, { amountMinor: '400000' });
    const results = await Promise.all([act(w.owner, payActions.create, body), act(w.owner, payActions.create, body)]);
    expect(results.map(codeOf)).toEqual(['OK', 'OK']);
    expect(new Set(results.map((r) => dataOf(r).id)).size).toBe(1);
    expect(results.filter((r) => dataOf(r).replayed)).toHaveLength(1);
    expect(await prisma().phSupplierPayment.count()).toBe(1);
    expect((await figures(a)).paid).toBe(400_000n);
  });
});

describe('payments that race', () => {
  it('lets one of two explicit payments for one balance win; the other is OVER_ALLOCATION; paid never exceeds the total', async () => {
    const w = await world();
    const a = await invoice(w, 1_000_000);
    const results = await Promise.all([
      pay(w, { amountMinor: '700000', allocations: [alloc(a, 700_000)] }),
      pay(w, { amountMinor: '700000', allocations: [alloc(a, 700_000)] }),
    ]);
    expect(results.map(codeOf).sort()).toEqual(['CONFLICT', 'OK']);
    expect(results.map(phCodeOf).sort()).toEqual(['OK', 'OVER_ALLOCATION']);
    expect(await figures(a)).toEqual({ status: 'PARTIAL', paid: 700_000n, credited: 0n });
    expect(await prisma().phSupplierPayment.count()).toBe(1);
  });

  it('plans an automatic payment against the balance it sees under the lock', async () => {
    const w = await world();
    const a = await invoice(w, 1_000_000);
    const results = await Promise.all([pay(w, { amountMinor: '700000' }), pay(w, { amountMinor: '700000' })]);
    expect(results.map(phCodeOf).sort()).toEqual(['OK', 'UNALLOCATED']);
    expect((await rowOf(a)).paidMinor).toBe(700_000n);
    const split = await Promise.all([pay(w, { amountMinor: '200000' }), pay(w, { amountMinor: '100000' })]);
    expect(split.map(codeOf)).toEqual(['OK', 'OK']);
    expect(await figures(a)).toEqual({ status: 'PAID', paid: 1_000_000n, credited: 0n });
  });

  it('keeps an invoice voided at the same moment coherent: either the payment lands and the void is refused, or the void wins and the payment is refused', async () => {
    const w = await world();
    const a = await invoice(w, 1_000_000);
    const [paid, voided] = await Promise.all([
      pay(w, { amountMinor: '300000', allocations: [alloc(a, 300_000)] }),
      act(w.owner, invoiceActions.voidInvoice, { restaurantId: w.a.id, invoiceId: a, expectedVersion: 1, reason: 'Racing the payment' }),
    ]);
    const row = await rowOf(a);
    if (row.status === 'VOID') {
      expect(codeOf(voided)).toBe('OK');
      expect(phCodeOf(paid)).toBe('INVOICE_VOID');
      expect(row.paidMinor).toBe(0n);
      expect(await prisma().phSupplierPayment.count()).toBe(0);
    } else {
      expect(codeOf(paid)).toBe('OK');
      expect(codeOf(voided)).toBe('CONFLICT');
      expect(row.paidMinor).toBe(300_000n);
      expect(row.status).toBe('PARTIAL');
    }
  });

  it('refuses to void an invoice that has been paid, and the database state stays consistent', async () => {
    const w = await world();
    const a = await invoice(w, 1_000_000);
    dataOf(await pay(w, { amountMinor: '300000' }));
    const version = (await rowOf(a)).version;
    const voided = await act(w.owner, invoiceActions.voidInvoice, { restaurantId: w.a.id, invoiceId: a, expectedVersion: version, reason: 'Trying to void a paid one' });
    expect(phCodeOf(voided)).toBe('INVOICE_SETTLED');
    expect(await figures(a)).toEqual({ status: 'PARTIAL', paid: 300_000n, credited: 0n });
  });
});

describe('reversing a payment', () => {
  it('restores the balances and statuses exactly, with a reversal row and no allocation rows of its own', async () => {
    const w = await world();
    const first = await invoice(w, 1_000_000, { dueDate: '2026-11-10' });
    const later = await invoice(w, 500_000, { dueDate: '2026-11-25' });
    const made = dataOf(await pay(w, { method: 'TRANSFER_MANUAL' }));
    expect((await figures(first)).status).toBe('PAID');
    const undone = dataOf(await reverse(w, made.id));
    expect(undone).toMatchObject({ reversesId: made.id, supplierId: w.supplierId, currency: 'IQD', amountMinor: '1200000', replayed: false });
    expect(undone.allocations).toEqual([
      { invoiceId: first, amountMinor: '1000000' },
      { invoiceId: later, amountMinor: '200000' },
    ]);
    expect(await figures(first)).toEqual({ status: 'OPEN', paid: 0n, credited: 0n });
    expect(await figures(later)).toEqual({ status: 'OPEN', paid: 0n, credited: 0n });
    const row = await prisma().phSupplierPayment.findUniqueOrThrow({ where: { id: undone.id }, include: { allocations: true } });
    expect(row).toMatchObject({ isReversal: true, reversesId: made.id, amountMinor: 1_200_000n, method: 'TRANSFER_MANUAL', supplierId: w.supplierId, currency: 'IQD' });
    expect(row.allocations).toHaveLength(0);
    // The original is untouched and still has its allocations.
    expect(await prisma().phSupplierPaymentAllocation.count({ where: { paymentId: made.id } })).toBe(2);
    // The balances can be paid again, and the invoice can now be voided.
    dataOf(await pay(w, { amountMinor: '1000000', allocations: [alloc(first, 1_000_000)] }));
    expect((await figures(first)).status).toBe('PAID');
  });

  it('restores a partial invoice to its earlier figures when only one of two payments is reversed', async () => {
    const w = await world();
    const a = await invoice(w, 1_000_000);
    const p1 = dataOf(await pay(w, { amountMinor: '300000' }));
    dataOf(await pay(w, { amountMinor: '200000' }));
    expect((await figures(a)).paid).toBe(500_000n);
    dataOf(await reverse(w, p1.id));
    expect(await figures(a)).toEqual({ status: 'PARTIAL', paid: 200_000n, credited: 0n });
  });

  it('can be done once only, and a reversal cannot be reversed', async () => {
    const w = await world();
    const a = await invoice(w, 1_000_000);
    const made = dataOf(await pay(w, { amountMinor: '400000' }));
    const undone = dataOf(await reverse(w, made.id));
    const second = await reverse(w, made.id);
    expect(codeOf(second)).toBe('CONFLICT');
    expect(phCodeOf(second)).toBe('ALREADY_REVERSED');
    const third = await reverse(w, undone.id);
    expect(codeOf(third)).toBe('CONFLICT');
    expect(phCodeOf(third)).toBe('ALREADY_REVERSAL');
    expect(await prisma().phSupplierPayment.count({ where: { isReversal: true } })).toBe(1);
    expect(await figures(a)).toEqual({ status: 'OPEN', paid: 0n, credited: 0n });
  });

  it('ends two parallel reversals of one payment in one reversal', async () => {
    const w = await world();
    const a = await invoice(w, 1_000_000);
    const made = dataOf(await pay(w, { amountMinor: '400000' }));
    const results = await Promise.all([reverse(w, made.id), reverse(w, made.id)]);
    expect(results.map(phCodeOf).sort()).toEqual(['ALREADY_REVERSED', 'OK']);
    expect(await prisma().phSupplierPayment.count({ where: { isReversal: true } })).toBe(1);
    expect(await figures(a)).toEqual({ status: 'OPEN', paid: 0n, credited: 0n });
  });

  it('replays by key, refuses a different request on the same key, validates the reason, and does not find another business’s payment', async () => {
    const w = await world();
    await invoice(w, 1_000_000);
    const made = dataOf(await pay(w, { amountMinor: '400000' }));
    expect(codeOf(await reverse(w, made.id, { reason: 'xx' }))).toBe('INVALID');
    expect(codeOf(await reverse(w, made.id, { reason: 'x'.repeat(301) }))).toBe('INVALID');
    expect(codeOf(await reverse(w, made.id, { clientKey: 'short' }))).toBe('INVALID');
    expect(codeOf(await reverse(w, 'no-such-payment'))).toBe('NOT_FOUND');
    const body = { restaurantId: w.a.id, paymentId: made.id, reason: 'Paid twice by mistake', clientKey: nextKey('rev') };
    const first = dataOf(await act(w.owner, payActions.reverse, body));
    const again = dataOf(await act(w.owner, payActions.reverse, body));
    expect(again).toMatchObject({ id: first.id, replayed: true });
    expect(phCodeOf(await act(w.owner, payActions.reverse, { ...body, reason: 'A different reason' }))).toBe('CLIENT_KEY_MISMATCH');
    expect(await prisma().phSupplierPayment.count({ where: { isReversal: true } })).toBe(1);
    // A payment key cannot be reused as a reversal key.
    const taken = await prisma().phSupplierPayment.findUniqueOrThrow({ where: { id: made.id }, select: { clientKey: true } });
    expect(phCodeOf(await reverse(w, made.id, { clientKey: taken.clientKey }))).toBe('CLIENT_KEY_MISMATCH');
  });
});

describe('applying a credit note', () => {
  it('applies part of a credit to one invoice (auto): credited and applied both move, the rest stays on the note', async () => {
    const w = await world();
    const a = await invoice(w, 1_000_000);
    const cn = await creditNote(w, 300_000);
    const done = dataOf(await apply(w, cn));
    expect(done).toMatchObject({ creditNoteId: cn, currency: 'IQD', appliedNowMinor: '300000', appliedMinor: '300000', remainingMinor: '0', replayed: false });
    expect(done.allocations).toEqual([{ invoiceId: a, amountMinor: '300000' }]);
    expect(await figures(a)).toEqual({ status: 'PARTIAL', paid: 0n, credited: 300_000n });
    expect((await noteOf(cn)).appliedMinor).toBe(300_000n);
    const rows = await prisma().phCreditAllocation.findMany({ where: { creditNoteId: cn } });
    expect(rows.map((r) => [r.invoiceId, r.amountMinor, r.supplierId, r.currency])).toEqual([[a, 300_000n, w.supplierId, 'IQD']]);
  });

  it('spends oldest-due-first across invoices and leaves the unspent credit on the note without an error', async () => {
    const w = await world();
    const later = await invoice(w, 500_000, { dueDate: '2026-11-25' });
    const first = await invoice(w, 1_000_000, { dueDate: '2026-11-10' });
    const cn = await creditNote(w, 2_000_000);
    const done = dataOf(await apply(w, cn));
    expect(done).toMatchObject({ appliedNowMinor: '1500000', appliedMinor: '1500000', remainingMinor: '500000' });
    expect(await figures(first)).toEqual({ status: 'PAID', paid: 0n, credited: 1_000_000n });
    expect(await figures(later)).toEqual({ status: 'PAID', paid: 0n, credited: 500_000n });
    expect((await noteOf(cn)).appliedMinor).toBe(1_500_000n);
    // Nothing left to apply it to: a clean refusal, not a zero row.
    expect(phCodeOf(await apply(w, cn))).toBe('NOTHING_TO_APPLY');
    expect(await prisma().phCreditAllocation.count({ where: { creditNoteId: cn } })).toBe(2);
  });

  it('applies as told, refuses more than the credit that is left or than a balance, and counts a payment against the balance', async () => {
    const w = await world();
    const a = await invoice(w, 1_000_000);
    const b = await invoice(w, 500_000);
    const cn = await creditNote(w, 400_000);
    expect(phCodeOf(await apply(w, cn, [alloc(a, 250_000), alloc(b, 250_000)]))).toBe('OVER_ALLOCATION');
    expect(await prisma().phCreditAllocation.count()).toBe(0);
    dataOf(await pay(w, { amountMinor: '300000', allocations: [alloc(b, 300_000)] }));
    expect(phCodeOf(await apply(w, cn, [alloc(b, 250_000)]))).toBe('OVER_ALLOCATION');
    const ok = dataOf(await apply(w, cn, [alloc(b, 200_000), alloc(a, 100_000)]));
    expect(ok).toMatchObject({ appliedNowMinor: '300000', remainingMinor: '100000' });
    expect(await figures(b)).toEqual({ status: 'PAID', paid: 300_000n, credited: 200_000n });
    expect(await figures(a)).toEqual({ status: 'PARTIAL', paid: 0n, credited: 100_000n });
  });

  it('keeps one allocation row per credit note and invoice: a second application to the same invoice is refused, and automatic planning skips it', async () => {
    const w = await world();
    const a = await invoice(w, 1_000_000, { dueDate: '2026-11-01' });
    const b = await invoice(w, 1_000_000, { dueDate: '2026-11-20' });
    const cn = await creditNote(w, 900_000);
    dataOf(await apply(w, cn, [alloc(a, 300_000)]));
    expect(phCodeOf(await apply(w, cn, [alloc(a, 100_000)]))).toBe('CREDIT_ALREADY_ON_INVOICE');
    const auto = dataOf(await apply(w, cn));
    expect(auto.allocations).toEqual([{ invoiceId: b, amountMinor: '600000' }]);
    expect((await noteOf(cn)).appliedMinor).toBe(900_000n);
  });

  it('keeps currency and supplier apart, and does not find a missing credit note', async () => {
    const w = await world();
    const iqd = await invoice(w, 1_000_000);
    const theirs = await invoice(w, 1_000_000, { supplierId: w.supplierB });
    const usd = await creditNote(w, 1_000, { currency: 'USD' });
    expect(phCodeOf(await apply(w, usd, [alloc(iqd, 1_000)]))).toBe('CURRENCY_MISMATCH');
    expect(phCodeOf(await apply(w, usd))).toBe('NOTHING_TO_APPLY');
    const cn = await creditNote(w, 1_000_000);
    expect(codeOf(await apply(w, cn, [alloc(theirs, 100_000)]))).toBe('NOT_FOUND');
    expect(codeOf(await apply(w, 'no-such-note'))).toBe('NOT_FOUND');
    expect(codeOf(await apply(w, cn, []))).toBe('INVALID');
    expect(await prisma().phCreditAllocation.count()).toBe(0);
    expect((await noteOf(cn)).appliedMinor).toBe(0n);
    expect((await figures(theirs)).credited).toBe(0n);
  });

  it('refuses a void invoice, and a credited invoice can no longer be voided', async () => {
    const w = await world();
    const gone = await invoice(w, 300_000);
    dataOf(await act(w.owner, invoiceActions.voidInvoice, { restaurantId: w.a.id, invoiceId: gone, expectedVersion: 1, reason: 'Entered by mistake' }));
    const cn = await creditNote(w, 100_000);
    expect(phCodeOf(await apply(w, cn, [alloc(gone, 100_000)]))).toBe('INVOICE_VOID');
    const live = await invoice(w, 300_000);
    dataOf(await apply(w, cn, [alloc(live, 100_000)]));
    const version = (await rowOf(live)).version;
    expect(phCodeOf(await act(w.owner, invoiceActions.voidInvoice, { restaurantId: w.a.id, invoiceId: live, expectedVersion: version, reason: 'Trying to void a credited one' }))).toBe('INVOICE_SETTLED');
  });

  it('lets one of two parallel applications of one note win when the credit covers one only', async () => {
    const w = await world();
    const a = await invoice(w, 1_000_000);
    const b = await invoice(w, 1_000_000);
    const cn = await creditNote(w, 1_000_000);
    const results = await Promise.all([apply(w, cn, [alloc(a, 700_000)]), apply(w, cn, [alloc(b, 700_000)])]);
    expect(results.map(phCodeOf).sort()).toEqual(['OK', 'OVER_ALLOCATION']);
    expect((await noteOf(cn)).appliedMinor).toBe(700_000n);
    expect((await figures(a)).credited + (await figures(b)).credited).toBe(700_000n);
  });

  it('keeps an invoice settled by a payment and a credit racing within its total', async () => {
    const w = await world();
    const a = await invoice(w, 1_000_000);
    const cn = await creditNote(w, 800_000);
    const results = await Promise.all([pay(w, { amountMinor: '600000', allocations: [alloc(a, 600_000)] }), apply(w, cn, [alloc(a, 600_000)])]);
    expect(results.map(phCodeOf).sort()).toEqual(['OK', 'OVER_ALLOCATION']);
    const row = await rowOf(a);
    expect(row.paidMinor + row.creditedMinor).toBe(600_000n);
    expect(row.status).toBe('PARTIAL');
  });

  it('replays by key, refuses a different request on the same key, and runs once for two parallel requests', async () => {
    const w = await world();
    const a = await invoice(w, 1_000_000);
    const cn = await creditNote(w, 300_000);
    const body = { restaurantId: w.a.id, clientKey: nextKey('cr'), creditNoteId: cn, allocations: [alloc(a, 100_000)] };
    const results = await Promise.all([act(w.owner, payActions.applyCreditNote, body), act(w.owner, payActions.applyCreditNote, body)]);
    expect(results.map(codeOf)).toEqual(['OK', 'OK']);
    expect(results.filter((r) => dataOf(r).replayed)).toHaveLength(1);
    expect((await noteOf(cn)).appliedMinor).toBe(100_000n);
    const again = dataOf(await act(w.owner, payActions.applyCreditNote, body));
    expect(again).toMatchObject({ replayed: true, appliedNowMinor: '100000', allocations: [{ invoiceId: a, amountMinor: '100000' }] });
    expect(phCodeOf(await act(w.owner, payActions.applyCreditNote, { ...body, allocations: [alloc(a, 100_001)] }))).toBe('CLIENT_KEY_MISMATCH');
    expect(await prisma().phCreditAllocation.count()).toBe(1);
    expect(await prisma().auditLog.count({ where: { action: 'ph.credit.apply' } })).toBe(1);
  });
});

describe('who may pay', () => {
  it('lets OWNER, BRANCH_MANAGER, PHARMACIST_IN_CHARGE and ACCOUNTANT pay, reverse and apply; refuses STOCK, PHARMACIST, CASHIER and a support grant on all three', async () => {
    const w = await world();
    const a = await invoice(w, 10_000_000);
    const cn = await creditNote(w, 5_000_000);
    const made = dataOf(await pay(w, { amountMinor: '100000' }));
    const mk = (role: 'STOCK' | 'ACCOUNTANT' | 'BRANCH_MANAGER' | 'PHARMACIST_IN_CHARGE' | 'PHARMACIST' | 'CASHIER') =>
      person(role.toLowerCase(), { staff: [w.a.id, role, [w.a.branchId]] });

    const people = new Map<string, Awaited<ReturnType<typeof mk>>>();
    for (const role of ['STOCK', 'PHARMACIST', 'CASHIER'] as const) {
      const who = await mk(role);
      people.set(role, who);
      expect(codeOf(await act(who, payActions.create, payBody(w, { amountMinor: '1000', allocations: [alloc(a, 1000)] }))), `${role} pays`).toBe('FORBIDDEN');
      expect(codeOf(await act(who, payActions.reverse, { restaurantId: w.a.id, paymentId: made.id, reason: 'not allowed', clientKey: nextKey('rev') })), `${role} reverses`).toBe('FORBIDDEN');
      expect(codeOf(await act(who, payActions.applyCreditNote, { restaurantId: w.a.id, clientKey: nextKey('cr'), creditNoteId: cn })), `${role} applies`).toBe('FORBIDDEN');
    }
    const clerk = people.get('STOCK')!;
    expect(codeOf(await ask(clerk, payQueries.list, { restaurantId: w.a.id }))).toBe('OK');
    expect(codeOf(await ask(clerk, payQueries.get, { restaurantId: w.a.id, paymentId: made.id }))).toBe('OK');
    for (const role of ['PHARMACIST', 'CASHIER'] as const) {
      const who = people.get(role)!;
      expect(codeOf(await ask(who, payQueries.list, { restaurantId: w.a.id })), `${role} lists`).toBe('FORBIDDEN');
      expect(codeOf(await ask(who, payQueries.get, { restaurantId: w.a.id, paymentId: made.id })), `${role} reads`).toBe('FORBIDDEN');
    }
    expect(await prisma().phSupplierPayment.count()).toBe(1);
    expect(await prisma().phCreditAllocation.count()).toBe(0);

    for (const role of ['ACCOUNTANT', 'BRANCH_MANAGER', 'PHARMACIST_IN_CHARGE'] as const) {
      const who = await mk(role);
      const mine = dataOf(await act(who, payActions.create, payBody(w, { amountMinor: '1000', allocations: [alloc(a, 1000)] })));
      expect(codeOf(await act(who, payActions.reverse, { restaurantId: w.a.id, paymentId: mine.id, reason: 'allowed to reverse', clientKey: nextKey('rev') })), `${role} reverses`).toBe('OK');
      expect(codeOf(await act(who, payActions.applyCreditNote, { restaurantId: w.a.id, clientKey: nextKey('cr'), creditNoteId: cn, allocations: [alloc(await invoice(w, 10_000), 1000)] })), `${role} applies`).toBe('OK');
    }

    const admin = await person('support', { superAdmin: true });
    await grant(admin, w.a.id, { scopes: ['catalog.read', 'stock.read'] });
    expect(codeOf(await act(admin, payActions.create, payBody(w, { amountMinor: '1000' })))).toBe('FORBIDDEN');
    expect(codeOf(await act(admin, payActions.reverse, { restaurantId: w.a.id, paymentId: made.id, reason: 'support may not', clientKey: nextKey('rev') }))).toBe('FORBIDDEN');
    expect(codeOf(await act(admin, payActions.applyCreditNote, { restaurantId: w.a.id, clientKey: nextKey('cr'), creditNoteId: cn }))).toBe('FORBIDDEN');
    expect(codeOf(await ask(admin, payQueries.list, { restaurantId: w.a.id }))).toBe('FORBIDDEN');
    expect(codeOf(await ask(admin, payQueries.get, { restaurantId: w.a.id, paymentId: made.id }))).toBe('FORBIDDEN');
    // Only the three allowed roles applied (one each); the refused ones and the support grant added none.
    expect(await prisma().phCreditAllocation.count()).toBe(3);
  });
});

describe('another business', () => {
  it('treats a foreign supplier, invoice, payment and credit note as not found, in both directions, and changes nothing of theirs', async () => {
    const w = await world('A');
    const b = await world('B');
    const mineInvoice = await invoice(w, 1_000_000);
    const theirInvoice = await invoice(b, 1_000_000);
    const theirPayment = dataOf(await act(b.owner, payActions.create, payBody(b, { amountMinor: '200000' })));
    const theirNote = await creditNote(b, 500_000);
    const myNote = await creditNote(w, 500_000);
    const before = async () =>
      JSON.stringify(
        [
          await prisma().phSupplierInvoice.findMany({ orderBy: { id: 'asc' } }),
          await prisma().phSupplierPayment.findMany({ orderBy: { id: 'asc' } }),
          await prisma().phSupplierPaymentAllocation.findMany({ orderBy: { id: 'asc' } }),
          await prisma().phCreditNote.findMany({ orderBy: { id: 'asc' } }),
          await prisma().phCreditAllocation.findMany({ orderBy: { id: 'asc' } }),
        ],
        (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v),
      );
    const snapshot = await before();

    expect(codeOf(await pay(w, { supplierId: b.supplierId, amountMinor: '100000' }))).toBe('NOT_FOUND');
    expect(codeOf(await pay(w, { amountMinor: '100000', allocations: [alloc(theirInvoice, 100_000)] }))).toBe('NOT_FOUND');
    expect(codeOf(await reverse(w, theirPayment.id))).toBe('NOT_FOUND');
    expect(codeOf(await apply(w, theirNote))).toBe('NOT_FOUND');
    expect(codeOf(await apply(w, myNote, [alloc(theirInvoice, 100_000)]))).toBe('NOT_FOUND');
    expect(codeOf(await ask(w.owner, payQueries.get, { restaurantId: w.a.id, paymentId: theirPayment.id }))).toBe('NOT_FOUND');
    expect(JSON.stringify(dataOf(await ask(w.owner, payQueries.list, { restaurantId: w.a.id })))).not.toContain(theirPayment.id);
    // The other direction: B's owner naming A's rows in A's pharmacy is refused at the door.
    expect(['FORBIDDEN', 'NOT_FOUND']).toContain(codeOf(await act(b.owner, payActions.create, { ...payBody(w, { amountMinor: '100000' }), restaurantId: w.a.id })));
    expect(codeOf(await act(b.owner, payActions.create, payBody(b, { supplierId: w.supplierId, amountMinor: '100000' })))).toBe('NOT_FOUND');
    expect(codeOf(await act(b.owner, payActions.create, payBody(b, { amountMinor: '100000', allocations: [alloc(mineInvoice, 100_000)] })))).toBe('NOT_FOUND');
    expect(await before()).toBe(snapshot);
  });
});

describe('what is audited', () => {
  it('records ids, amounts, currency, method and counts, and never the reference or the reason', async () => {
    const w = await world();
    const a = await invoice(w, 1_000_000);
    const made = dataOf(await pay(w, { amountMinor: '400000', reference: 'SECRET-REF-9931', method: 'CHEQUE_MANUAL' }));
    const undone = dataOf(await reverse(w, made.id, { reason: 'SECRET-REASON-5527 typed twice' }));
    const cn = await creditNote(w, 100_000);
    dataOf(await apply(w, cn, [alloc(a, 50_000)]));
    const rows = await prisma().auditLog.findMany({ where: { restaurantId: w.a.id, action: { in: ['ph.supplierPayment.create', 'ph.supplierPayment.reverse', 'ph.credit.apply'] } } });
    expect(rows.map((r) => r.action).sort()).toEqual(['ph.credit.apply', 'ph.supplierPayment.create', 'ph.supplierPayment.reverse']);
    const row = (action: string) => rows.find((r) => r.action === action)!;
    const text = JSON.stringify(rows.map((r) => r.changes));
    expect(text).not.toContain('SECRET');
    expect(row('ph.supplierPayment.create')).toMatchObject({ entityType: 'PhSupplierPayment', entityId: made.id });
    expect(JSON.stringify(row('ph.supplierPayment.create').changes)).toContain('400000');
    expect(JSON.stringify(row('ph.supplierPayment.create').changes)).toContain('CHEQUE_MANUAL');
    expect(JSON.stringify(row('ph.supplierPayment.create').changes)).toContain('IQD');
    expect(row('ph.supplierPayment.reverse')).toMatchObject({ entityType: 'PhSupplierPayment', entityId: undone.id });
    expect(JSON.stringify(row('ph.supplierPayment.reverse').changes)).toContain(made.id);
    expect(row('ph.credit.apply')).toMatchObject({ entityType: 'PhCreditNote', entityId: cn });
    expect(JSON.stringify(row('ph.credit.apply').changes)).toContain('50000');
    // The reversal row keeps the reason where it belongs: in the data, not in the log.
    expect((await prisma().phSupplierPayment.findUniqueOrThrow({ where: { id: undone.id } })).reference).toContain('SECRET-REASON-5527');
  });
});

describe('reading payments', () => {
  it('lists newest first with the reversed flag, filters by supplier, dates and reversals, and pages', async () => {
    const w = await world();
    await invoice(w, 10_000_000);
    await invoice(w, 10_000_000, { supplierId: w.supplierB });
    const p1 = dataOf(await pay(w, { amountMinor: '100000', paidOn: '2026-10-20' }));
    const p2 = dataOf(await pay(w, { amountMinor: '200000', paidOn: '2026-10-22' }));
    const p3 = dataOf(await pay(w, { amountMinor: '300000', paidOn: '2026-10-25', supplierId: w.supplierB }));
    const undone = dataOf(await reverse(w, p1.id));
    const all = dataOf(await ask(w.owner, payQueries.list, { restaurantId: w.a.id }));
    expect(all.items.map((i) => i.id)).toEqual([p3.id, p2.id, p1.id]);
    expect(all.items.find((i) => i.id === p1.id)).toMatchObject({ reversed: true, isReversal: false, amountMinor: '100000', supplierName: 'Al-Noor', method: 'CASH', currency: 'IQD', paidOn: '2026-10-20' });
    expect(all.items.find((i) => i.id === p2.id)?.reversed).toBe(false);
    const withReversals = dataOf(await ask(w.owner, payQueries.list, { restaurantId: w.a.id, includeReversals: true }));
    expect(withReversals.items.map((i) => i.id)).toContain(undone.id);
    expect(withReversals.items.find((i) => i.id === undone.id)).toMatchObject({ isReversal: true, reversesId: p1.id, reversed: false });
    expect(dataOf(await ask(w.owner, payQueries.list, { restaurantId: w.a.id, supplierId: w.supplierB })).items.map((i) => i.id)).toEqual([p3.id]);
    expect(dataOf(await ask(w.owner, payQueries.list, { restaurantId: w.a.id, from: '2026-10-21', to: '2026-10-22' })).items.map((i) => i.id)).toEqual([p2.id]);
    // Pages of 50: 55 payments page cleanly.
    for (let i = 0; i < 52; i += 1) dataOf(await pay(w, { amountMinor: '1000', paidOn: '2026-10-26' }));
    const page1 = dataOf(await ask(w.owner, payQueries.list, { restaurantId: w.a.id }));
    expect(page1.items).toHaveLength(50);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = dataOf(await ask(w.owner, payQueries.list, { restaurantId: w.a.id, cursor: page1.nextCursor }));
    expect(page2.items).toHaveLength(5);
    expect(page2.nextCursor).toBeNull();
    expect(new Set([...page1.items, ...page2.items].map((i) => i.id)).size).toBe(55);
  });

  it('gets a payment with its allocations and the invoice numbers; a reversal shows the allocations it undid', async () => {
    const w = await world();
    const a = await invoice(w, 1_000_000, { dueDate: '2026-11-10' });
    const b = await invoice(w, 500_000, { dueDate: '2026-11-25' });
    const made = dataOf(await pay(w, { amountMinor: '1200000', reference: 'CHQ 77' }));
    const got = dataOf(await ask(w.owner, payQueries.get, { restaurantId: w.a.id, paymentId: made.id }));
    const numbers = new Map((await prisma().phSupplierInvoice.findMany({ where: { id: { in: [a, b] } }, select: { id: true, number: true } })).map((r) => [r.id, r.number]));
    expect(got).toMatchObject({ id: made.id, reference: 'CHQ 77', reversed: false, reversedById: null, isReversal: false, amountMinor: '1200000' });
    expect(got.allocations).toEqual([
      { invoiceId: a, invoiceNumber: numbers.get(a), amountMinor: '1000000' },
      { invoiceId: b, invoiceNumber: numbers.get(b), amountMinor: '200000' },
    ]);
    const undone = dataOf(await reverse(w, made.id));
    const after = dataOf(await ask(w.owner, payQueries.get, { restaurantId: w.a.id, paymentId: made.id }));
    expect(after).toMatchObject({ reversed: true, reversedById: undone.id });
    const reversal = dataOf(await ask(w.owner, payQueries.get, { restaurantId: w.a.id, paymentId: undone.id }));
    expect(reversal).toMatchObject({ isReversal: true, reversesId: made.id, reversed: false });
    expect(reversal.allocations.map((x) => x.amountMinor)).toEqual(['1000000', '200000']);
    expect(codeOf(await ask(w.owner, payQueries.get, { restaurantId: w.a.id, paymentId: 'nope' }))).toBe('NOT_FOUND');
  });

  it('shows no money to a role without cost.view', async () => {
    const w = await world();
    await invoice(w, 1_000_000);
    const made = dataOf(await pay(w, { amountMinor: '400000' }));
    const clerk = await person('pharmacist', { staff: [w.a.id, 'PHARMACIST', [w.a.branchId]] });
    const ph = (await asPh(clerk.userId, w.a.id, w.a.branchId))!;
    expect(ph.role).toBe('PHARMACIST');
    const scoped = scopedClient(prisma(), { restaurantId: w.a.id, branchIds: ph.branchIds });
    const text = JSON.stringify([await getPayment(scoped, ph, made.id), await listPayments(scoped, ph, {})]);
    expect(text).toContain(made.id);
    expect(text).not.toContain('amountMinor');
    expect(text).not.toContain('400000');
  });
});
