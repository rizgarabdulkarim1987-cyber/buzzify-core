import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@/generated/prisma/client';
import { scopedClient } from '@/server/data/tenant-db';
import * as creditActions from '@/server/pharmacy/actions/credit-notes';
import * as receiptActions from '@/server/pharmacy/actions/receipts';
import * as invoiceActions from '@/server/pharmacy/actions/supplier-invoices';
import * as payActions from '@/server/pharmacy/actions/supplier-payments';
import { listBalances, listPayables, supplierStatement } from '@/server/pharmacy/payables-reads';
import * as payables from '@/server/pharmacy/queries/payables';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { runQuery } from '@/server/studio/framework/query';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { grant, NOW, asPh, person, pharmacy, prisma, resetWorld, useTestDatabase } from './fixture';
import { act, ask, codeOf, dataOf, makeProduct } from './stock-helpers';

/**
 * Supplier statement and payables reads (phase 4, task 9). The worlds are built through the real services; every expected
 * figure is written out by hand next to the data that makes it. Today is 2026-10-27 (the clock of every pharmacy test).
 */

let keySeq = 0;
const nextKey = (prefix: string) => `${prefix}-${(keySeq += 1)}-aaaa`;
type World = Awaited<ReturnType<typeof world>>;
type Currency = 'IQD' | 'USD';

async function world(label = 'A') {
  const a = await pharmacy(label, { branches: 2 });
  const owner = await person(`owner${label}`, { membership: [a.id, 'OWNER'] });
  const mkSupplier = (name: string, defaultCurrency: Currency = 'IQD') =>
    prisma().phSupplier.create({
      data: { restaurantId: a.id, name, nameKey: name.toLowerCase(), defaultCurrency, termsDays: 30, clientKey: nextKey('sup'), createdById: owner.userId },
      select: { id: true },
    });
  const supplier = await mkSupplier('Al-Noor');
  const supplierB = await mkSupplier('Beta Pharma', 'USD');
  const p = await makeProduct(a.id, 'Panadol');
  return { a, owner, supplierId: supplier.id, supplierB: supplierB.id, p, mkSupplier };
}

/** A confirmed receipt of one line and an invoice of that whole line: an invoice of exactly `total` minor units. */
async function invoice(w: World, total: number | string, over: { supplierId?: string; currency?: Currency; invoiceDate?: string; dueDate?: string; number?: string } = {}): Promise<string> {
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
      receivedOn: '2026-07-20',
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
      number: over.number ?? nextKey('INV'),
      invoiceDate: over.invoiceDate ?? '2026-07-21',
      dueDate: over.dueDate ?? '2026-11-20',
      currency,
      lines: [{ receiptLineId: line.id, qtyInvoiced: 1, unitCostMinor: String(total) }],
    }),
  ).id;
}

const pay = (w: World, body: Record<string, unknown>) =>
  act(w.owner, payActions.create, { restaurantId: w.a.id, clientKey: nextKey('pay'), supplierId: w.supplierId, currency: 'IQD', method: 'CASH', reference: '', ...body });
const note = (w: World, body: Record<string, unknown>) =>
  act(w.owner, creditActions.record, { restaurantId: w.a.id, clientKey: nextKey('cn'), supplierId: w.supplierId, currency: 'IQD', ...body });
const alloc = (invoiceId: string, amountMinor: number | string) => ({ invoiceId, amountMinor: String(amountMinor) });
const at = (w: World) => ({ restaurantId: w.a.id });

/**
 * The statement world. Supplier Al-Noor, IQD: Inv1 1,000,000 (dated 09-01), Inv2 500,000 (10-05), Inv4 300,000 (10-12, voided today).
 * P1 400,000 on Inv1 (09-20); P2 200,000 on Inv1 (10-15) reversed on 10-20; credit note C1 250,000 (10-10), 100,000 of it on Inv2.
 * USD: Inv3 20,000 (10-10); P3 5,000 (10-18); credit note C2 1,000 (10-22), unapplied.
 */
async function statementWorld() {
  const w = await world();
  const ids = {
    inv1: await invoice(w, 1_000_000, { number: 'A-1', invoiceDate: '2026-09-01', dueDate: '2026-10-01' }),
    inv2: await invoice(w, 500_000, { number: 'A-2', invoiceDate: '2026-10-05', dueDate: '2026-11-04' }),
    inv3: await invoice(w, 20_000, { number: 'U-1', currency: 'USD', invoiceDate: '2026-10-10', dueDate: '2026-10-30' }),
    inv4: await invoice(w, 300_000, { number: 'A-4', invoiceDate: '2026-10-12', dueDate: '2026-11-11' }),
  };
  const p1 = dataOf(await pay(w, { amountMinor: '400000', paidOn: '2026-09-20', reference: 'CHQ 1', allocations: [alloc(ids.inv1, 400_000)] }));
  const p2 = dataOf(await pay(w, { amountMinor: '200000', paidOn: '2026-10-15', reference: 'CHQ 2', allocations: [alloc(ids.inv1, 200_000)] }));
  const p3 = dataOf(await pay(w, { currency: 'USD', amountMinor: '5000', paidOn: '2026-10-18', reference: 'WIRE', allocations: [alloc(ids.inv3, 5_000)] }));
  const c1 = dataOf(await note(w, { number: 'CN-1', amountMinor: '250000', noteDate: '2026-10-10' }));
  const c2 = dataOf(await note(w, { number: 'CN-2', currency: 'USD', amountMinor: '1000', noteDate: '2026-10-22' }));
  dataOf(await act(w.owner, payActions.applyCreditNote, { restaurantId: w.a.id, clientKey: nextKey('cr'), creditNoteId: c1.id, allocations: [alloc(ids.inv2, 100_000)] }));
  vi.setSystemTime(new Date('2026-10-20T09:00:00.000Z'));
  const r2 = dataOf(await act(w.owner, payActions.reverse, { restaurantId: w.a.id, paymentId: p2.id, reason: 'Paid twice by mistake', clientKey: nextKey('rev') }));
  vi.setSystemTime(NOW);
  const invoiceRow = await prisma().phSupplierInvoice.findUniqueOrThrow({ where: { id: ids.inv4 }, select: { version: true } });
  dataOf(await act(w.owner, invoiceActions.voidInvoice, { restaurantId: w.a.id, invoiceId: ids.inv4, expectedVersion: invoiceRow.version, reason: 'Entered by mistake' }));
  return { w, ids, p1, p2, p3, c1, c2, r2 };
}

const statement = async (w: World, body: Record<string, unknown>, who = w.owner) => dataOf(await ask(who, payables.statement, { ...at(w), supplierId: w.supplierId, currency: 'IQD', from: '2026-09-01', to: '2026-10-27', ...body }));
const brief = (rows: { date: string; kind: string; ref: string; amountMinor?: string; balanceMinor?: string }[]) => rows.map((r) => [r.date, r.kind, r.ref, r.amountMinor, r.balanceMinor]);

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

describe('the supplier statement', () => {
  it('lists IQD rows with hand-figured running balances, and the closing, totals and invariant', async () => {
    const { w, ids, p1, p2, r2, c1 } = await statementWorld();
    const s = await statement(w, {});
    expect(s).toMatchObject({ supplier: { id: w.supplierId, name: 'Al-Noor' }, currency: 'IQD', from: '2026-09-01', to: '2026-10-27', opening: '0', closing: '850000' });
    expect(brief(s.rows)).toEqual([
      ['2026-09-01', 'INVOICE', 'A-1', '1000000', '1000000'],
      ['2026-09-20', 'PAYMENT', 'CHQ 1', '400000', '600000'],
      ['2026-10-05', 'INVOICE', 'A-2', '500000', '1100000'],
      ['2026-10-10', 'CREDIT_NOTE', 'CN-1', '250000', '850000'],
      ['2026-10-12', 'INVOICE', 'A-4', '300000', '1150000'],
      ['2026-10-15', 'PAYMENT', 'CHQ 2', '200000', '950000'],
      ['2026-10-20', 'PAYMENT_REVERSAL', 'CHQ 2', '200000', '1150000'],
      ['2026-10-27', 'INVOICE_VOID', 'A-4', '300000', '850000'],
    ]);
    // Every row names the record it came from (the invoice twice: it was billed and then voided) and has an id of its own.
    expect(new Set(s.rows.map((r: { id: string }) => r.id)).size).toBe(8);
    expect(s.rows[7].id).toBe(`${ids.inv4}#void`);
    expect(s.rows.map((r: { recordId: string }) => r.recordId)).toEqual([ids.inv1, p1.id, ids.inv2, c1.id, ids.inv4, p2.id, r2.id, ids.inv4]);
    expect(s.totalsByKind).toEqual({ INVOICE: '1800000', PAYMENT: '600000', PAYMENT_REVERSAL: '200000', CREDIT_NOTE: '250000', INVOICE_VOID: '300000' });
    // Open invoices: Inv1 1,000,000 - 400,000 = 600,000 and Inv2 500,000 - 100,000 = 400,000; unapplied credit 150,000: 1,000,000 - 150,000 = 850,000.
    expect(s.invariant).toEqual({ ok: true, difference: '0' });
    expect(s.counts).toEqual({ INVOICE: 3, PAYMENT: 2, PAYMENT_REVERSAL: 1, CREDIT_NOTE: 1, INVOICE_VOID: 1 });
  });

  it('keeps USD apart with its own figures', async () => {
    const { w, c2 } = await statementWorld();
    const s = await statement(w, { currency: 'USD', from: '2026-10-01' });
    expect(s).toMatchObject({ currency: 'USD', opening: '0', closing: '14000' });
    expect(brief(s.rows)).toEqual([
      ['2026-10-10', 'INVOICE', 'U-1', '20000', '20000'],
      ['2026-10-18', 'PAYMENT', 'WIRE', '5000', '15000'],
      ['2026-10-22', 'CREDIT_NOTE', 'CN-2', '1000', '14000'],
    ]);
    expect(s.rows[2].recordId).toBe(c2.id);
    // Open Inv3 15,000 minus the unapplied USD credit 1,000.
    expect(s.invariant).toEqual({ ok: true, difference: '0' });
    expect(s.totalsByKind).toEqual({ INVOICE: '20000', PAYMENT: '5000', PAYMENT_REVERSAL: '0', CREDIT_NOTE: '1000', INVOICE_VOID: '0' });
  });

  it('opens a mid-range statement with the balance of everything before it', async () => {
    const { w } = await statementWorld();
    // Before 10-10: +1,000,000 (09-01) - 400,000 (09-20) + 500,000 (10-05) = 1,100,000.
    const s = await statement(w, { from: '2026-10-10' });
    expect(s.opening).toBe('1100000');
    expect(brief(s.rows)).toEqual([
      ['2026-10-10', 'CREDIT_NOTE', 'CN-1', '250000', '850000'],
      ['2026-10-12', 'INVOICE', 'A-4', '300000', '1150000'],
      ['2026-10-15', 'PAYMENT', 'CHQ 2', '200000', '950000'],
      ['2026-10-20', 'PAYMENT_REVERSAL', 'CHQ 2', '200000', '1150000'],
      ['2026-10-27', 'INVOICE_VOID', 'A-4', '300000', '850000'],
    ]);
    expect(s.closing).toBe('850000');
    expect(s.totalsByKind).toEqual({ INVOICE: '300000', PAYMENT: '200000', PAYMENT_REVERSAL: '200000', CREDIT_NOTE: '250000', INVOICE_VOID: '300000' });
    expect(s.invariant).toEqual({ ok: true, difference: '0' });
    // USD from 10-18: the invoice (20,000) is before the range.
    const usd = await statement(w, { currency: 'USD', from: '2026-10-18' });
    expect(usd.opening).toBe('20000');
    expect(usd.closing).toBe('14000');
  });

  it('includes the day `to` itself and leaves out the day after', async () => {
    const { w } = await statementWorld();
    const s = await statement(w, { from: '2026-10-12', to: '2026-10-15' });
    expect(s.opening).toBe('850000');
    expect(brief(s.rows).map((r) => r[0])).toEqual(['2026-10-12', '2026-10-15']);
    expect(s.closing).toBe('950000');
  });

  it('computes the invariant only when `to` is today or later, and counts what is dated after `to`', async () => {
    const { w } = await statementWorld();
    expect((await statement(w, { to: '2026-10-26' })).invariant).toBeNull();
    expect((await statement(w, { to: '2026-12-31' })).invariant).toEqual({ ok: true, difference: '0' });
    // A payment dated tomorrow is not in a statement that ends today, yet the invoices already carry it: the invariant still holds.
    const open = await prisma().phSupplierInvoice.findFirstOrThrow({ where: { number: 'A-1' }, select: { id: true } });
    dataOf(await pay(w, { amountMinor: '50000', paidOn: '2026-10-28', allocations: [alloc(open.id, 50_000)] }));
    const s = await statement(w, {});
    expect(s.closing).toBe('850000');
    expect(s.invariant).toEqual({ ok: true, difference: '0' });
    expect((await statement(w, { to: '2026-10-28' })).closing).toBe('800000');
  });

  it('shows a non-zero difference when a counter is tampered with, so the invariant means something', async () => {
    const { w, ids } = await statementWorld();
    // eslint-disable-next-line no-restricted-properties -- the test breaks a counter on purpose; no tenant data is read
    await prisma().$executeRaw`UPDATE "PhSupplierInvoice" SET "paidMinor" = "paidMinor" + 1000 WHERE "id" = ${ids.inv1}`;
    const s = await statement(w, {});
    expect(s.closing).toBe('850000');
    // The invoice now says 1,000 more was paid: the open balances are 1,000 lower than the rows add up to.
    expect(s.invariant).toEqual({ ok: false, difference: '1000' });
  });

  it('shows an archived supplier, and refuses another business’s supplier and an unknown one', async () => {
    const { w } = await statementWorld();
    await prisma().phSupplier.update({ where: { id: w.supplierId }, data: { active: false } });
    const s = await statement(w, {});
    expect(s.supplier).toEqual({ id: w.supplierId, name: 'Al-Noor', archived: true });
    expect(s.closing).toBe('850000');
    const o = await world('B');
    expect(codeOf(await ask(w.owner, payables.statement, { ...at(w), supplierId: o.supplierId, currency: 'IQD', from: '2026-09-01', to: '2026-10-27' }))).toBe('NOT_FOUND');
    expect(codeOf(await ask(w.owner, payables.statement, { ...at(w), supplierId: 'nope', currency: 'IQD', from: '2026-09-01', to: '2026-10-27' }))).toBe('NOT_FOUND');
  });

  it('refuses a range over a year, an upside-down range, and a bad date; one year exactly is fine', async () => {
    const w = await world();
    const bad = async (body: Record<string, unknown>) => codeOf(await ask(w.owner, payables.statement, { ...at(w), supplierId: w.supplierId, currency: 'IQD', ...body }));
    expect(await bad({ from: '2025-10-25', to: '2026-10-27' })).toBe('INVALID');
    expect(await bad({ from: '2025-10-26', to: '2026-10-27' })).toBe('OK');
    // A calendar year that holds 29 February: 2027-03-01 to 2028-03-01 is 366 days.
    expect(await bad({ from: '2027-03-01', to: '2028-02-29' })).toBe('OK');
    expect(await bad({ from: '2027-03-01', to: '2028-03-01' })).toBe('OK');
    expect(await bad({ from: '2027-02-27', to: '2028-02-29' })).toBe('INVALID');
    expect(await bad({ from: '2026-10-28', to: '2026-10-27' })).toBe('INVALID');
    expect(await bad({ from: '2026-02-30', to: '2026-10-27' })).toBe('INVALID');
    expect(await bad({ from: '2026-09-01', to: '2026-10-27', currency: 'EUR' })).toBe('INVALID');
    expect(await bad({ from: '2026-09-01', to: '2026-10-27', format: 'xml' })).toBe('INVALID');
    expect(await bad({ from: '2025-10-27', to: '2026-10-27' })).toBe('OK');
    expect(await bad({ from: '2026-09-01', to: '2026-10-27', format: 'rows' })).toBe('OK');
  });

  it('answers with an empty statement for a supplier with no history', async () => {
    const w = await world();
    const s = await statement(w, {});
    expect(s).toMatchObject({ opening: '0', closing: '0', rows: [], invariant: { ok: true, difference: '0' } });
  });

  it('does a constant number of queries however many rows the statement has', async () => {
    const w = await world();
    const bulk = Array.from({ length: 220 }, (_, i) => ({
      restaurantId: w.a.id,
      supplierId: w.supplierId,
      number: `BULK-${i}`,
      currency: 'IQD' as const,
      amountMinor: 1_000n,
      noteDate: new Date(`2026-10-${String(1 + (i % 20)).padStart(2, '0')}T00:00:00.000Z`),
      clientKey: nextKey('bulk'),
      createdById: w.owner.userId,
    }));
    await prisma().phCreditNote.createMany({ data: bulk.slice(0, 3) });
    const counting = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl(TEST_DB) }), log: [{ emit: 'event', level: 'query' }] });
    let count = 0;
    (counting as unknown as { $on: (e: string, f: () => void) => void }).$on('query', () => {
      count += 1;
    });
    const actor = (await loadActor(prisma(), w.owner.userId)) as Actor;
    const measure = async () => {
      count = 0;
      const result = dataOf(await runQuery(counting, actor, payables.statement, { ...at(w), supplierId: w.supplierId, currency: 'IQD', from: '2026-10-01', to: '2026-10-27' }));
      return { rows: result.rows.length, queries: count };
    };
    try {
      const small = await measure();
      await prisma().phCreditNote.createMany({ data: bulk.slice(3) });
      const big = await measure();
      expect(small.rows).toBe(3);
      expect(big.rows).toBe(220);
      expect(big.queries).toBeGreaterThan(3);
      expect(big.queries).toBe(small.queries);
    } finally {
      await counting.$disconnect();
    }
  });
});

/** Open invoices at assorted due dates (today is 2026-10-27). */
async function payablesWorld() {
  const w = await world();
  const ids = {
    soon: await invoice(w, 100_000, { number: 'P-SOON', dueDate: '2026-10-30' }),
    yesterday: await invoice(w, 200_000, { number: 'P-YDAY', dueDate: '2026-10-26' }),
    d45: await invoice(w, 400_000, { number: 'P-45', dueDate: '2026-09-12' }),
    d90: await invoice(w, 800_000, { number: 'P-90', dueDate: '2026-07-29' }),
    far: await invoice(w, 1_600_000, { number: 'P-FAR', dueDate: '2026-11-20' }),
    paid: await invoice(w, 50_000, { number: 'P-PAID', dueDate: '2026-10-26' }),
    usd: await invoice(w, 5_000, { number: 'P-USD', supplierId: w.supplierB, currency: 'USD', dueDate: '2026-10-26' }),
  };
  dataOf(await pay(w, { amountMinor: '50000', paidOn: '2026-10-20', allocations: [alloc(ids.paid, 50_000)] }));
  dataOf(await pay(w, { amountMinor: '150000', paidOn: '2026-10-20', allocations: [alloc(ids.d45, 150_000)] }));
  return { w, ids };
}

const payablesOf = async (w: World, body: Record<string, unknown> = {}, who = w.owner) => dataOf(await ask(who, payables.list, { ...at(w), ...body }));
const bandsOf = (t: { bands: Record<string, { count: number; balanceMinor?: string }> }) => Object.fromEntries(Object.entries(t.bands).map(([k, v]) => [k, [v.count, v.balanceMinor]]));

describe('the payables list', () => {
  it('lists open invoices with balance, due band and days overdue, oldest due first, and leaves out the paid one', async () => {
    const { w, ids } = await payablesWorld();
    const r = await payablesOf(w);
    expect(r.items).toHaveLength(6);
    const by = Object.fromEntries(r.items.map((i: { number: string }) => [i.number, i]));
    expect(by['P-SOON']).toMatchObject({ id: ids.soon, balanceMinor: '100000', dueDate: '2026-10-30', dueBand: 'DUE_7', daysOverdue: 0, supplierName: 'Al-Noor', currency: 'IQD', status: 'OPEN' });
    expect(by['P-YDAY']).toMatchObject({ balanceMinor: '200000', dueBand: 'OVERDUE_1_30', daysOverdue: 1 });
    // 400,000 total with 150,000 paid.
    expect(by['P-45']).toMatchObject({ balanceMinor: '250000', totalMinor: '400000', paidMinor: '150000', dueBand: 'OVERDUE_31_60', daysOverdue: 45, status: 'PARTIAL' });
    expect(by['P-90']).toMatchObject({ balanceMinor: '800000', dueBand: 'OVERDUE_60_PLUS', daysOverdue: 90 });
    expect(by['P-FAR']).toMatchObject({ balanceMinor: '1600000', dueBand: 'NOT_DUE', daysOverdue: 0 });
    expect(by['P-USD']).toMatchObject({ balanceMinor: '5000', currency: 'USD', supplierName: 'Beta Pharma', dueBand: 'OVERDUE_1_30' });
    expect(by['P-PAID']).toBeUndefined();
    const order = r.items.map((i: { dueDate: string; id: string }) => `${i.dueDate}|${i.id}`);
    expect(order).toEqual([...order].sort());
    expect(r.nextCursor).toBeNull();
  });

  it('totals per currency and per band, never mixing IQD and USD', async () => {
    const { w } = await payablesWorld();
    const { totals } = await payablesOf(w);
    expect(totals.map((t: { currency: string }) => t.currency)).toEqual(['IQD', 'USD']);
    const [iqd, usd] = totals;
    // IQD: 100,000 + 200,000 + 250,000 + 800,000 + 1,600,000 = 2,950,000; overdue 200,000 + 250,000 + 800,000 = 1,250,000.
    expect(iqd).toMatchObject({ count: 5, balanceMinor: '2950000', overdueMinor: '1250000' });
    expect(bandsOf(iqd)).toEqual({ NOT_DUE: [1, '1600000'], DUE_7: [1, '100000'], OVERDUE_1_30: [1, '200000'], OVERDUE_31_60: [1, '250000'], OVERDUE_60_PLUS: [1, '800000'] });
    expect(usd).toMatchObject({ count: 1, balanceMinor: '5000', overdueMinor: '5000' });
    expect(bandsOf(usd)).toEqual({ NOT_DUE: [0, '0'], DUE_7: [0, '0'], OVERDUE_1_30: [1, '5000'], OVERDUE_31_60: [0, '0'], OVERDUE_60_PLUS: [0, '0'] });
  });

  it('pages stably by due date and id, with totals across all matching rows rather than the page', async () => {
    const { w } = await payablesWorld();
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const r: Awaited<ReturnType<typeof payablesOf>> = await payablesOf(w, { take: 4, ...(cursor ? { cursor } : {}) });
      expect(r.items.length).toBe(pages === 0 ? 4 : 2);
      expect(r.totals.find((t: { currency: string }) => t.currency === 'IQD')!.balanceMinor).toBe('2950000');
      seen.push(...r.items.map((i: { id: string }) => i.id));
      cursor = r.nextCursor;
      pages += 1;
    } while (cursor);
    expect(pages).toBe(2);
    expect(new Set(seen).size).toBe(6);
    const whole = await payablesOf(w);
    expect(seen).toEqual(whole.items.map((i: { id: string }) => i.id));
  });

  it('filters by supplier, currency, band and overdue, and the totals follow the filter', async () => {
    const { w, ids } = await payablesWorld();
    const usd = await payablesOf(w, { currency: 'USD' });
    expect(usd.items.map((i: { number: string }) => i.number)).toEqual(['P-USD']);
    expect(usd.totals).toHaveLength(1);
    const bySupplier = await payablesOf(w, { supplierId: w.supplierB });
    expect(bySupplier.items.map((i: { number: string }) => i.number)).toEqual(['P-USD']);
    const band = await payablesOf(w, { band: 'OVERDUE_31_60' });
    expect(band.items.map((i: { id: string }) => i.id)).toEqual([ids.d45]);
    expect(band.totals).toHaveLength(1);
    expect(band.totals[0]).toMatchObject({ currency: 'IQD', count: 1, balanceMinor: '250000', overdueMinor: '250000' });
    const overdue = await payablesOf(w, { overdueOnly: true });
    expect(overdue.items.map((i: { number: string }) => i.number).sort()).toEqual(['P-45', 'P-90', 'P-USD', 'P-YDAY']);
    expect(overdue.totals.find((t: { currency: string }) => t.currency === 'IQD')).toMatchObject({ count: 3, balanceMinor: '1250000' });
    const soon = await payablesOf(w, { band: 'DUE_7' });
    expect(soon.items.map((i: { id: string }) => i.id)).toEqual([ids.soon]);
    expect((await payablesOf(w, { band: 'OVERDUE_60_PLUS', overdueOnly: true })).items).toHaveLength(1);
    expect((await payablesOf(w, { band: 'NOT_DUE', overdueOnly: true })).items).toHaveLength(0);
  });

  it('keeps every open payable when the invoice the next page continues from is paid or fully credited in between', async () => {
    for (const how of ['paid', 'credited'] as const) {
      await resetWorld();
      const { w, ids } = await payablesWorld();
      const all = (await payablesOf(w)).items.map((i: { id: string }) => i.id);
      const first = await payablesOf(w, { take: 2 });
      expect(first.items.map((i: { id: string }) => i.id)).toEqual(all.slice(0, 2));
      expect(first.nextCursor).toBe(ids.d45);
      if (how === 'paid') dataOf(await pay(w, { amountMinor: '250000', paidOn: '2026-10-21', allocations: [alloc(ids.d45, 250_000)] }));
      else {
        const c = dataOf(await note(w, { number: `CN-${how}`, amountMinor: '250000', noteDate: '2026-10-25' }));
        dataOf(await act(w.owner, payActions.applyCreditNote, { restaurantId: w.a.id, clientKey: nextKey('cr'), creditNoteId: c.id, allocations: [alloc(ids.d45, 250_000)] }));
      }
      const second = await payablesOf(w, { take: 10, cursor: first.nextCursor });
      expect(second.items.map((i: { id: string }) => i.id), how).toEqual(all.slice(2));
      expect(second.totals.find((t: { currency: string }) => t.currency === 'IQD')!.count).toBe(4);
    }
  });

  it('refuses a cursor that names no invoice of the business', async () => {
    const { w } = await payablesWorld();
    expect(codeOf(await ask(w.owner, payables.list, { ...at(w), cursor: 'nope' }))).toBe('INVALID');
  });

  it('puts the edge days in the right band: today, +7, +8, -1, -30, -31, -60, -61', async () => {
    const w = await world();
    const due = { 'E-0': '2026-10-27', 'E+7': '2026-11-03', 'E+8': '2026-11-04', 'E-1': '2026-10-26', 'E-30': '2026-09-27', 'E-31': '2026-09-26', 'E-60': '2026-08-28', 'E-61': '2026-08-27' };
    for (const [number, dueDate] of Object.entries(due)) await invoice(w, 1_000, { number, dueDate });
    const numbers = async (band: string) => (await payablesOf(w, { band })).items.map((i: { number: string }) => i.number).sort();
    expect(await numbers('DUE_7')).toEqual(['E+7', 'E-0']);
    expect(await numbers('NOT_DUE')).toEqual(['E+8']);
    expect(await numbers('OVERDUE_1_30')).toEqual(['E-1', 'E-30']);
    expect(await numbers('OVERDUE_31_60')).toEqual(['E-31', 'E-60']);
    expect(await numbers('OVERDUE_60_PLUS')).toEqual(['E-61']);
    // The filter and the item's own band agree for every invoice.
    const every = (await payablesOf(w)).items;
    for (const band of ['DUE_7', 'NOT_DUE', 'OVERDUE_1_30', 'OVERDUE_31_60', 'OVERDUE_60_PLUS']) {
      expect(every.filter((i: { dueBand: string }) => i.dueBand === band).map((i: { number: string }) => i.number).sort()).toEqual(await numbers(band));
    }
  });

  it('moves a void invoice, a paid one and a fully credited one out of the list', async () => {
    const { w, ids } = await payablesWorld();
    const version = (await prisma().phSupplierInvoice.findUniqueOrThrow({ where: { id: ids.far }, select: { version: true } })).version;
    dataOf(await act(w.owner, invoiceActions.voidInvoice, { restaurantId: w.a.id, invoiceId: ids.far, expectedVersion: version, reason: 'Entered by mistake' }));
    const c = dataOf(await note(w, { number: 'CN-ALL', amountMinor: '100000', noteDate: '2026-10-25' }));
    dataOf(await act(w.owner, payActions.applyCreditNote, { restaurantId: w.a.id, clientKey: nextKey('cr'), creditNoteId: c.id, allocations: [alloc(ids.soon, 100_000)] }));
    const r = await payablesOf(w, { currency: 'IQD' });
    expect(r.items.map((i: { number: string }) => i.number)).toEqual(['P-90', 'P-45', 'P-YDAY']);
    expect(r.totals[0]).toMatchObject({ count: 3, balanceMinor: '1250000' });
  });

  it('shows the same business-wide figures to a branch-limited actor, and refuses CASHIER, PHARMACIST and support', async () => {
    const { w } = await payablesWorld();
    const limited = await person('limited', { staff: [w.a.id, 'ACCOUNTANT', [w.a.branchIds[0]!]] });
    const mine = await ask(limited, payables.list, { ...at(w), branchId: w.a.branchIds[0] });
    expect(dataOf(mine)).toEqual(await payablesOf(w));
    const balances = await ask(limited, payables.balances, { ...at(w), branchId: w.a.branchIds[0] });
    expect(dataOf(balances)).toEqual(dataOf(await ask(w.owner, payables.balances, at(w))));
    const stock = await person('stock', { staff: [w.a.id, 'STOCK', [w.a.branchId]] });
    expect(codeOf(await ask(stock, payables.list, at(w)))).toBe('OK');
    for (const role of ['PHARMACIST', 'CASHIER'] as const) {
      const who = await person(role.toLowerCase(), { staff: [w.a.id, role, [w.a.branchId]] });
      expect(codeOf(await ask(who, payables.list, at(w))), `${role} lists`).toBe('FORBIDDEN');
      expect(codeOf(await ask(who, payables.balances, at(w))), `${role} balances`).toBe('FORBIDDEN');
      expect(codeOf(await ask(who, payables.statement, { ...at(w), supplierId: w.supplierId, currency: 'IQD', from: '2026-09-01', to: '2026-10-27' })), `${role} statement`).toBe('FORBIDDEN');
    }
    const admin = await person('support', { superAdmin: true });
    await grant(admin, w.a.id, { scopes: ['catalog.read', 'stock.read'] });
    expect(codeOf(await ask(admin, payables.list, at(w)))).toBe('FORBIDDEN');
    expect(codeOf(await ask(admin, payables.balances, at(w)))).toBe('FORBIDDEN');
    expect(codeOf(await ask(admin, payables.statement, { ...at(w), supplierId: w.supplierId, currency: 'IQD', from: '2026-09-01', to: '2026-10-27' }))).toBe('FORBIDDEN');
  });

  it('does not show another business’s invoices, and refuses a foreign supplier filter as an empty answer', async () => {
    const { w } = await payablesWorld();
    const o = await world('B');
    await invoice(o, 9_000_000, { number: 'THEIRS', dueDate: '2026-10-01' });
    const r = await payablesOf(w);
    expect(r.items.map((i: { number: string }) => i.number)).not.toContain('THEIRS');
    expect(r.totals.find((t: { currency: string }) => t.currency === 'IQD')!.balanceMinor).toBe('2950000');
    const foreign = await payablesOf(w, { supplierId: o.supplierId });
    expect(foreign.items).toEqual([]);
    expect(foreign.totals).toEqual([]);
  });
});

/**
 * The balances world. Al-Noor IQD: 600,000 (due 10-01) and 400,000 (due 11-04) open, 100,000 credit unapplied; Al-Noor USD: 20,000 due 10-30.
 * Beta Pharma (archived) USD: 5,000 due 10-26 open, 10,000 credit unapplied. Gamma IQD: 50,000 credit only. A paid invoice changes nothing.
 */
async function balancesWorld() {
  const w = await world();
  const gamma = await w.mkSupplier('Gamma Trade');
  await invoice(w, 600_000, { number: 'B-1', dueDate: '2026-10-01' });
  await invoice(w, 400_000, { number: 'B-2', dueDate: '2026-11-04' });
  const paid = await invoice(w, 70_000, { number: 'B-PAID', dueDate: '2026-10-01' });
  dataOf(await pay(w, { amountMinor: '70000', paidOn: '2026-10-20', allocations: [alloc(paid, 70_000)] }));
  await invoice(w, 20_000, { number: 'B-USD', currency: 'USD', dueDate: '2026-10-30' });
  await invoice(w, 5_000, { number: 'B-BETA', supplierId: w.supplierB, currency: 'USD', dueDate: '2026-10-26' });
  dataOf(await note(w, { number: 'CN-A', amountMinor: '100000', noteDate: '2026-10-20' }));
  dataOf(await note(w, { number: 'CN-B', supplierId: w.supplierB, currency: 'USD', amountMinor: '10000', noteDate: '2026-10-20' }));
  dataOf(await note(w, { number: 'CN-G', supplierId: gamma.id, amountMinor: '50000', noteDate: '2026-10-20' }));
  await prisma().phSupplier.update({ where: { id: w.supplierB }, data: { active: false } });
  return { w, gamma: gamma.id };
}

const balancesOf = async (w: World, body: Record<string, unknown> = {}, who = w.owner) => dataOf(await ask(who, payables.balances, { ...at(w), ...body }));
const rowsOf = (r: { items: { supplierName: string; currency: string; openMinor?: string; unappliedCreditMinor?: string; netOwedMinor?: string; overdueMinor?: string }[] }) =>
  r.items.map((i) => [i.supplierName, i.currency, i.openMinor, i.unappliedCreditMinor, i.netOwedMinor, i.overdueMinor]);

describe('the supplier balances', () => {
  it('gives one row per supplier and currency with open balance, unapplied credit, net owed, overdue and oldest due date', async () => {
    const { w } = await balancesWorld();
    const r = await balancesOf(w);
    expect(rowsOf(r)).toEqual([
      ['Al-Noor', 'IQD', '1000000', '100000', '900000', '600000'],
      ['Al-Noor', 'USD', '20000', '0', '20000', '0'],
      ['Beta Pharma', 'USD', '5000', '10000', '-5000', '5000'],
      ['Gamma Trade', 'IQD', '0', '50000', '-50000', '0'],
    ]);
    expect(r.items.map((i: { oldestDueDate: string | null }) => i.oldestDueDate)).toEqual(['2026-10-01', '2026-10-30', '2026-10-26', null]);
    expect(r.items.map((i: { openInvoices: number }) => i.openInvoices)).toEqual([2, 1, 1, 0]);
    expect(r.items.map((i: { archived: boolean }) => i.archived)).toEqual([false, false, true, false]);
    expect(r.hasMore).toBe(false);
  });

  it('keeps only suppliers that are owed with onlyOwed, and filters by currency', async () => {
    const { w } = await balancesWorld();
    expect(rowsOf(await balancesOf(w, { onlyOwed: true })).map((r) => [r[0], r[1]])).toEqual([['Al-Noor', 'IQD'], ['Al-Noor', 'USD']]);
    expect(rowsOf(await balancesOf(w, { currency: 'USD' })).map((r) => [r[0], r[1]])).toEqual([['Al-Noor', 'USD'], ['Beta Pharma', 'USD']]);
    expect(rowsOf(await balancesOf(w, { currency: 'IQD', onlyOwed: true })).map((r) => r[0])).toEqual(['Al-Noor']);
  });

  it('agrees with the statement closing of each supplier and currency', async () => {
    const { w } = await balancesWorld();
    const row = (await balancesOf(w)).items.find((i: { supplierName: string; currency: string }) => i.supplierName === 'Al-Noor' && i.currency === 'IQD');
    const s = await statement(w, { from: '2026-07-01', to: '2026-12-31' });
    expect(s.closing).toBe(row!.netOwedMinor);
  });

  it('caps the list at 200 rows and says there are more', async () => {
    const { w } = await balancesWorld();
    const many = Array.from({ length: 205 }, (_, i) => ({ restaurantId: w.a.id, name: `Zed ${String(i).padStart(3, '0')}`, nameKey: `zed ${i}`, defaultCurrency: 'IQD' as const, clientKey: nextKey('z'), createdById: w.owner.userId }));
    await prisma().phSupplier.createMany({ data: many });
    const zs = await prisma().phSupplier.findMany({ where: { name: { startsWith: 'Zed' } }, select: { id: true } });
    await prisma().phCreditNote.createMany({
      data: zs.map((z, i) => ({ restaurantId: w.a.id, supplierId: z.id, number: `ZN-${i}`, currency: 'IQD' as const, amountMinor: 10n, noteDate: new Date('2026-10-20T00:00:00.000Z'), clientKey: nextKey('zn'), createdById: w.owner.userId })),
    });
    const r = await balancesOf(w);
    expect(r.items).toHaveLength(200);
    expect(r.hasMore).toBe(true);
    expect((await balancesOf(w, { onlyOwed: true })).hasMore).toBe(false);
  });

  it('does not show another business’s suppliers', async () => {
    const { w } = await balancesWorld();
    const o = await world('B');
    await invoice(o, 9_000_000, { number: 'THEIRS', dueDate: '2026-10-01' });
    expect((await balancesOf(w)).items).toHaveLength(4);
    expect((await balancesOf(o)).items).toHaveLength(1);
  });
});

describe('money and plain rows', () => {
  it('leaves the money keys out for a role without cost.view and keeps the counts', async () => {
    const { w } = await payablesWorld();
    const clerk = await person('pharmacist', { staff: [w.a.id, 'PHARMACIST', [w.a.branchId]] });
    const ph = (await asPh(clerk.userId, w.a.id, w.a.branchId))!;
    expect(ph.role).toBe('PHARMACIST');
    const scoped = scopedClient(prisma(), { restaurantId: w.a.id, branchIds: ph.branchIds });
    const list = await listPayables(scoped, ph, {});
    const balances = await listBalances(scoped, ph, {});
    const stmt = await supplierStatement(scoped, ph, { supplierId: w.supplierId, currency: 'IQD', from: '2026-07-01', to: '2026-10-27' });
    const text = JSON.stringify([list, balances, stmt]);
    expect(list.items).toHaveLength(6);
    expect(list.totals.find((t) => t.currency === 'IQD')).toMatchObject({ count: 5 });
    expect(balances.items.length).toBeGreaterThan(0);
    expect(stmt.rows).toHaveLength(8);
    for (const key of ['Minor', '100000', '2950000', '1600000', 'closing', 'opening', 'invariant']) expect(text, key).not.toContain(key);
  });

  it('accepts format rows on all three and returns plain strings and arrays only', async () => {
    const { w } = await statementWorld();
    const a = await ask(w.owner, payables.list, { ...at(w), format: 'rows' });
    const b = await ask(w.owner, payables.balances, { ...at(w), format: 'rows' });
    const c = await ask(w.owner, payables.statement, { ...at(w), supplierId: w.supplierId, currency: 'IQD', from: '2026-09-01', to: '2026-10-27', format: 'rows' });
    for (const r of [a, b, c] as { ok: boolean }[]) {
      expect(r.ok).toBe(true);
      expect(() => JSON.stringify(r)).not.toThrow();
    }
    expect(codeOf(await ask(w.owner, payables.list, { ...at(w), format: 'csv' }))).toBe('INVALID');
  });
});
