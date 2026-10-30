import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as creditActions from '@/server/pharmacy/actions/credit-notes';
import * as poActions from '@/server/pharmacy/actions/purchase-orders';
import * as receiptActions from '@/server/pharmacy/actions/receipts';
import * as stockActions from '@/server/pharmacy/actions/stock';
import * as invoiceActions from '@/server/pharmacy/actions/supplier-invoices';
import * as payActions from '@/server/pharmacy/actions/supplier-payments';
import * as returnActions from '@/server/pharmacy/actions/supplier-returns';
import * as supplierActions from '@/server/pharmacy/actions/suppliers';
import * as payables from '@/server/pharmacy/queries/payables';
import * as poQueries from '@/server/pharmacy/queries/purchase-orders';
import * as returnQueries from '@/server/pharmacy/queries/supplier-returns';
import { NOW, person, pharmacy, prisma, resetWorld, useTestDatabase, type Person } from './fixture';
import { act, ask, balanceOf, codeOf, dataOf, makeProduct, phCodeOf } from './stock-helpers';

/**
 * Acceptance of phase 4 (spec section 12, row 4), through the same actions and queries the screens call, in IQD with hand
 * figures: an order of 100 + 10 bonus at 1,000 per strip is received in two parts and invoiced in two parts, so the three
 * quantities (ordered, received, invoiced) differ at every step; a payment, a credit note for stock sent back, and a reversal
 * follow; the supplier statement then equals the rows and running balances worked out here by hand, and its closing balance
 * is the open invoices less the unused credit, recomputed from the raw rows with SQL of this file. Also: over-receipt and
 * over-invoicing refused, parallel receipts of the last units (one wins), a resend (one row), a duplicate invoice (named),
 * void then entered again, and a USD invoice kept out of the IQD statement. The detailed rules live in the per-task files.
 *
 * Every step happens on its own day (the clock is set), so each statement row has a day of its own and the order is not a guess.
 */

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

let seq = 0;
const key = (label: string) => `${label}-${(seq += 1)}-${'x'.repeat(8)}`;
const onDay = (day: string) => vi.setSystemTime(new Date(`${day}T09:00:00.000Z`));

interface World {
  restaurantId: string;
  branchId: string;
  owner: Person;
  supplierId: string;
  p: { id: string; tablet: string; strip: string };
}

/** One pharmacy, one branch, one supplier on 30 days' terms, one product (a strip is 10 tablets). */
async function world(): Promise<World> {
  const a = await pharmacy('A', { branches: 1 });
  const owner = await person('owner', { membership: [a.id, 'OWNER'] });
  const supplier = dataOf(
    await act(owner, supplierActions.create, { restaurantId: a.id, clientKey: key('sup'), name: 'Al-Noor Pharma', defaultCurrency: 'IQD', termsDays: 30 }),
  );
  const p = await makeProduct(a.id, 'Panadol');
  return { restaurantId: a.id, branchId: a.branchId, owner, supplierId: supplier.id, p };
}

const at = (w: World) => ({ restaurantId: w.restaurantId, branchId: w.branchId });

async function placeOrder(w: World, qtyOrdered: number, bonusOrdered: number) {
  const made = dataOf(
    await act(w.owner, poActions.create, {
      ...at(w),
      clientKey: key('po'),
      supplierId: w.supplierId,
      currency: 'IQD',
      lines: [{ productId: w.p.id, unitId: w.p.strip, qtyOrdered, bonusOrdered, unitCostMinor: '1000' }],
    }),
  );
  dataOf(await act(w.owner, poActions.order, { ...at(w), purchaseOrderId: made.id, expectedVersion: 1 }));
  const line = await prisma().phPurchaseOrderLine.findFirstOrThrow({ where: { purchaseOrderId: made.id }, select: { id: true } });
  return { id: made.id, lineId: line.id };
}

/** The triple the order screen shows for its only line, and the order status. */
async function triple(w: World, orderId: string) {
  const o = dataOf(await ask(w.owner, poQueries.get, { ...at(w), purchaseOrderId: orderId }));
  const l = o.lines[0]!;
  return { ordered: [l.qtyOrdered, l.bonusOrdered], received: [l.receivedQty, l.receivedBonus], invoiced: l.invoicedQty, status: o.status };
}

const receiptLine = (w: World, orderLineId: string | null, over: Record<string, unknown> = {}) => ({
  productId: w.p.id,
  unitId: w.p.strip,
  qty: 60,
  lot: key('lot'),
  expiry: '2028-03-15',
  unitCostMinor: '1000',
  currency: 'IQD',
  ...(orderLineId ? { purchaseOrderLineId: orderLineId } : {}),
  ...over,
});

async function draft(w: World, lines: unknown[], over: Record<string, unknown> = {}) {
  return dataOf(await act(w.owner, receiptActions.create, { ...at(w), clientKey: key('rcpt'), supplierId: w.supplierId, supplierName: '', reference: 'GRN', receivedOn: '2026-10-09', lines, ...over }));
}
const confirm = (w: World, receiptId: string) => act(w.owner, receiptActions.confirm, { ...at(w), receiptId });
const lineOf = async (receiptId: string) => (await prisma().phReceiptLine.findFirstOrThrow({ where: { receiptId }, select: { id: true } })).id;


const invoiceBody = (w: World, number: string, invoiceDate: string, lines: unknown[], over: Record<string, unknown> = {}) => ({
  restaurantId: w.restaurantId,
  clientKey: key('inv'),
  supplierId: w.supplierId,
  currency: 'IQD',
  number,
  invoiceDate,
  lines,
  ...over,
});
const invoice = (w: World, number: string, invoiceDate: string, lines: unknown[], over: Record<string, unknown> = {}) =>
  act(w.owner, invoiceActions.create, invoiceBody(w, number, invoiceDate, lines, over));
const billLine = (receiptLineId: string, qtyInvoiced: number, unitCostMinor: string) => ({ receiptLineId, qtyInvoiced, unitCostMinor });

const payBody = (w: World, over: Record<string, unknown>) => ({
  restaurantId: w.restaurantId,
  clientKey: key('pay'),
  supplierId: w.supplierId,
  currency: 'IQD',
  ...over,
});

/** Sums from the raw rows, written here and not taken from the services: what is billed, paid, credited, still open and unused. */
async function rawPosition(restaurantId: string, supplierId: string, currency: 'IQD' | 'USD') {
  // eslint-disable-next-line no-restricted-properties -- the test recomputes the figures from the stored rows with its own SQL
  const rows = await prisma().$queryRaw<{ billed: bigint; paid: bigint; reversed: bigint; credits: bigint; open: bigint; unused: bigint }[]>`
    SELECT
      (SELECT COALESCE(SUM("totalMinor"), 0) FROM "PhSupplierInvoice" WHERE "restaurantId" = ${restaurantId} AND "supplierId" = ${supplierId} AND "currency" = ${currency}::"Currency" AND "status" <> 'VOID')::bigint AS "billed",
      (SELECT COALESCE(SUM("amountMinor"), 0) FROM "PhSupplierPayment" WHERE "restaurantId" = ${restaurantId} AND "supplierId" = ${supplierId} AND "currency" = ${currency}::"Currency" AND NOT "isReversal")::bigint AS "paid",
      (SELECT COALESCE(SUM("amountMinor"), 0) FROM "PhSupplierPayment" WHERE "restaurantId" = ${restaurantId} AND "supplierId" = ${supplierId} AND "currency" = ${currency}::"Currency" AND "isReversal")::bigint AS "reversed",
      (SELECT COALESCE(SUM("amountMinor"), 0) FROM "PhCreditNote" WHERE "restaurantId" = ${restaurantId} AND "supplierId" = ${supplierId} AND "currency" = ${currency}::"Currency")::bigint AS "credits",
      (SELECT COALESCE(SUM("totalMinor" - "paidMinor" - "creditedMinor"), 0) FROM "PhSupplierInvoice" WHERE "restaurantId" = ${restaurantId} AND "supplierId" = ${supplierId} AND "currency" = ${currency}::"Currency" AND "status" IN ('OPEN', 'PARTIAL'))::bigint AS "open",
      (SELECT COALESCE(SUM("amountMinor" - "appliedMinor"), 0) FROM "PhCreditNote" WHERE "restaurantId" = ${restaurantId} AND "supplierId" = ${supplierId} AND "currency" = ${currency}::"Currency")::bigint AS "unused"`;
  return rows[0]!;
}

describe('phase 4 acceptance: order, receive, invoice, pay, credit, return, statement', () => {
  it('works the whole purchasing path with hand figures, and the statement equals them', async () => {
    const w = await world();

    // --- Parallel receipts of the last units: an order of 10, two deliveries of 10 at once, one wins --------------------------
    onDay('2026-10-08');
    const small = await placeOrder(w, 10, 0);
    const [d1, d2] = [
      await draft(w, [receiptLine(w, small.lineId, { qty: 10, lot: 'LOT-RACE-1' })], { purchaseOrderId: small.id }),
      await draft(w, [receiptLine(w, small.lineId, { qty: 10, lot: 'LOT-RACE-2' })], { purchaseOrderId: small.id }),
    ];
    const raced = await Promise.all([confirm(w, d1.id), confirm(w, d2.id)]);
    expect(raced.filter((r) => r.ok)).toHaveLength(1);
    expect(raced.map(codeOf).sort()).toEqual(['CONFLICT', 'OK']);
    expect(await triple(w, small.id)).toEqual({ ordered: [10, 0], received: [10, 0], invoiced: 0, status: 'RECEIVED' });
    expect(await prisma().phReceipt.count({ where: { status: 'CONFIRMED' } })).toBe(1);

    // --- The main order: 100 + 10 bonus at 1,000 per strip, received in two parts -------------------------------------------
    const order = await placeOrder(w, 100, 10);
    onDay('2026-10-09');
    expect(await triple(w, order.id)).toEqual({ ordered: [100, 10], received: [0, 0], invoiced: 0, status: 'ORDERED' });
    const r1 = await draft(w, [receiptLine(w, order.lineId, { qty: 60, lot: 'LOT-1' })], { purchaseOrderId: order.id });
    dataOf(await confirm(w, r1.id));
    // After receipt 1: ordered 100, received 60, invoiced 0.
    expect(await triple(w, order.id)).toEqual({ ordered: [100, 10], received: [60, 0], invoiced: 0, status: 'PARTIAL' });
    const r1Line = await lineOf(r1.id);
    // One strip more than the 40 still to come is refused, and the counters stay where they were.
    const tooMuch = await draft(w, [receiptLine(w, order.lineId, { qty: 41, lot: 'LOT-OVER' })], { purchaseOrderId: order.id });
    expect(phCodeOf(await confirm(w, tooMuch.id))).toBe('OVER_RECEIPT');
    expect(await triple(w, order.id)).toEqual({ ordered: [100, 10], received: [60, 0], invoiced: 0, status: 'PARTIAL' });

    // --- Invoice 1 for the 60 received: 60 x 1,000 = 60,000, dated 10 October, due 30 days later ---------------------------
    onDay('2026-10-10');
    const body1 = invoiceBody(w, 'INV-A-1001', '2026-10-10', [billLine(r1Line, 60, '1000')]);
    const inv1 = dataOf(await act(w.owner, invoiceActions.create, body1));
    expect(inv1).toMatchObject({ totalMinor: '60000', status: 'OPEN', dueDate: '2026-11-09', replayed: false });
    // Ordered 100, received 60, invoiced 60.
    expect(await triple(w, order.id)).toEqual({ ordered: [100, 10], received: [60, 0], invoiced: 60, status: 'PARTIAL' });
    // A resend with the same key is the same invoice, not a second one.
    expect(dataOf(await act(w.owner, invoiceActions.create, body1))).toMatchObject({ id: inv1.id, replayed: true });
    expect(await prisma().phSupplierInvoice.count()).toBe(1);
    // One strip more than was received cannot be invoiced.
    expect(phCodeOf(await invoice(w, 'INV-A-1099', '2026-10-10', [billLine(r1Line, 1, '1000')]))).toBe('INVOICE_EXCEEDS_RECEIVED');
    // The same invoice entered again under another key (spaced, lower case) is refused, and names the one that exists.
    const twin = await invoice(w, ' inv-a-1001 ', '2026-10-10', [billLine(r1Line, 60, '1000')]);
    expect(phCodeOf(twin)).toBe('DUPLICATE_INVOICE');
    expect(twin.ok ? null : twin.error.fields?.existingInvoiceId).toBe(inv1.id);
    expect(await prisma().phSupplierInvoice.count()).toBe(1);

    // --- The rest arrives: 40 + 10 bonus. Ordered 100 (+10) = received 100 (+10), invoiced still 60 --------------------------
    onDay('2026-10-11');
    const r2 = await draft(w, [receiptLine(w, order.lineId, { qty: 40, bonusQty: 10, lot: 'LOT-2' })], { receivedOn: '2026-10-11', purchaseOrderId: order.id });
    dataOf(await confirm(w, r2.id));
    expect(await triple(w, order.id)).toEqual({ ordered: [100, 10], received: [100, 10], invoiced: 60, status: 'RECEIVED' });
    const r2Line = await lineOf(r2.id);

    // --- Invoice 2: the 40 + 10 bonus for 40,000 in all (a receipt line is billed once, so the supplier's price is spread: 50 x 800) ---
    onDay('2026-10-12');
    const inv2 = dataOf(await invoice(w, 'INV-A-1002', '2026-10-12', [billLine(r2Line, 50, '800')]));
    expect(inv2).toMatchObject({ totalMinor: '40000', status: 'OPEN', dueDate: '2026-11-11' });
    expect(await triple(w, order.id)).toEqual({ ordered: [100, 10], received: [100, 10], invoiced: 110, status: 'RECEIVED' });
    expect(phCodeOf(await invoice(w, 'INV-A-1098', '2026-10-12', [billLine(r2Line, 1, '800')]))).toBe('INVOICE_EXCEEDS_RECEIVED');

    // --- Payment 1: 70,000 in cash on 14 October, oldest due first: invoice 1 in full and 10,000 of invoice 2 -----------------
    onDay('2026-10-14');
    const payment1 = payBody(w, { method: 'CASH', amountMinor: '70000', paidOn: '2026-10-14', reference: 'RCPT-14' });
    const pay1 = dataOf(await act(w.owner, payActions.create, payment1));
    expect(pay1.allocations).toEqual([{ invoiceId: inv1.id, amountMinor: '60000' }, { invoiceId: inv2.id, amountMinor: '10000' }]);
    // The same request sent again is the same payment: one row, the stored allocations.
    expect(dataOf(await act(w.owner, payActions.create, payment1))).toMatchObject({ id: pay1.id, replayed: true, allocations: pay1.allocations });
    expect(await prisma().phSupplierPayment.count()).toBe(1);
    expect(await prisma().phSupplierInvoice.findUniqueOrThrow({ where: { id: inv1.id } })).toMatchObject({ status: 'PAID', paidMinor: 60000n });
    expect(await prisma().phSupplierInvoice.findUniqueOrThrow({ where: { id: inv2.id } })).toMatchObject({ status: 'PARTIAL', paidMinor: 10000n });

    // --- 50 tablets (5 strips) are set aside in quarantine and go back to the supplier ---------------------------------------
    onDay('2026-10-15');
    const batch1 = await prisma().phBatch.findFirstOrThrow({ where: { lot: 'LOT-1' }, select: { id: true } });
    expect(await balanceOf(batch1.id, w.branchId)).toMatchObject({ available: 600, quarantine: 0 });
    dataOf(await act(w.owner, stockActions.adjust, { ...at(w), batchId: batch1.id, direction: 'move', bucketFrom: 'available', bucketTo: 'quarantine', baseQty: 50, reason: 'Damaged in transit', clientKey: key('adj') }));
    const sent = dataOf(
      await act(w.owner, returnActions.create, { ...at(w), clientKey: key('ret'), supplierId: w.supplierId, reason: 'Damaged in transit', lines: [{ batchId: batch1.id, bucket: 'QUARANTINE', qty: 50 }] }),
    );
    expect(await balanceOf(batch1.id, w.branchId)).toMatchObject({ available: 550, quarantine: 0 });
    // 5 strips x 1,000 = 5,000 (50 tablets x 1,000 per 10 tablets).
    expect(dataOf(await ask(w.owner, returnQueries.get, { ...at(w), returnId: sent.id })).returnValue).toEqual({ IQD: '5000' });

    // --- The credit note of 5,000 for it (16 October), applied to invoice 2 -------------------------------------------------
    onDay('2026-10-16');
    const note = dataOf(
      await act(w.owner, creditActions.record, { restaurantId: w.restaurantId, clientKey: key('cn'), supplierId: w.supplierId, number: 'CN-77', currency: 'IQD', amountMinor: '5000', noteDate: '2026-10-16', supplierReturnId: sent.id }),
    );
    const applied = dataOf(await act(w.owner, payActions.applyCreditNote, { restaurantId: w.restaurantId, clientKey: key('cr'), creditNoteId: note.id, allocations: [{ invoiceId: inv2.id, amountMinor: '5000' }] }));
    expect(applied).toMatchObject({ appliedNowMinor: '5000', appliedMinor: '5000', remainingMinor: '0' });
    // Invoice 2: 40,000 - 10,000 paid - 5,000 credit = 25,000 still owed.
    expect(await prisma().phSupplierInvoice.findUniqueOrThrow({ where: { id: inv2.id } })).toMatchObject({ status: 'PARTIAL', paidMinor: 10000n, creditedMinor: 5000n });

    // --- A USD invoice of the same supplier: 10 strips at 5.00 USD = 5,000 cents. It must stay out of the IQD statement --------
    onDay('2026-10-17');
    const usdReceipt = await draft(w, [receiptLine(w, null, { qty: 10, lot: 'LOT-USD', unitCostMinor: '500', currency: 'USD' })], { receivedOn: '2026-10-17' });
    dataOf(await confirm(w, usdReceipt.id));
    dataOf(await invoice(w, 'INV-A-USD-1', '2026-10-17', [billLine(await lineOf(usdReceipt.id), 10, '500')], { currency: 'USD' }));

    // --- Invoice 3 (10 strips, 10,000) is entered on 18 October, voided on the 19th, entered again on the 20th ------------------
    onDay('2026-10-18');
    const r3 = await draft(w, [receiptLine(w, null, { qty: 10, lot: 'LOT-3' })], { receivedOn: '2026-10-18' });
    dataOf(await confirm(w, r3.id));
    const r3Line = await lineOf(r3.id);
    const inv3 = dataOf(await invoice(w, 'INV-A-1003', '2026-10-18', [billLine(r3Line, 10, '1000')]));
    expect(inv3.totalMinor).toBe('10000');
    onDay('2026-10-19');
    dataOf(await act(w.owner, invoiceActions.voidInvoice, { restaurantId: w.restaurantId, invoiceId: inv3.id, expectedVersion: inv3.version, reason: 'Entered against the wrong delivery' }));
    onDay('2026-10-20');
    const inv3b = dataOf(await invoice(w, 'INV-A-1003', '2026-10-20', [billLine(r3Line, 10, '1000')]));
    expect(inv3b).toMatchObject({ totalMinor: '10000', status: 'OPEN', replayed: false });
    expect(inv3b.id).not.toBe(inv3.id);

    // --- Payment 2: 20,000 by transfer on 21 October (invoice 2 is the oldest due), reversed on 22 October ---------------------
    onDay('2026-10-21');
    const pay2 = dataOf(await act(w.owner, payActions.create, payBody(w, { method: 'TRANSFER_MANUAL', amountMinor: '20000', paidOn: '2026-10-21', reference: 'TRF-21' })));
    expect(pay2.allocations).toEqual([{ invoiceId: inv2.id, amountMinor: '20000' }]);
    onDay('2026-10-22');
    const undone = dataOf(await act(w.owner, payActions.reverse, { restaurantId: w.restaurantId, clientKey: key('rev'), paymentId: pay2.id, reason: 'Sent twice by mistake' }));
    expect(undone.allocations).toEqual([{ invoiceId: inv2.id, amountMinor: '20000' }]);

    // --- Where every invoice stands: invoice 1 paid, invoice 2 owes 25,000, the second entry of invoice 3 owes 10,000 -----------
    const stands = async (id: string) => {
      const r = await prisma().phSupplierInvoice.findUniqueOrThrow({ where: { id } });
      return [r.status, r.totalMinor - r.paidMinor - r.creditedMinor] as const;
    };
    expect(await stands(inv1.id)).toEqual(['PAID', 0n]);
    expect(await stands(inv2.id)).toEqual(['PARTIAL', 25000n]);
    expect((await stands(inv3.id))[0]).toBe('VOID');
    expect(await stands(inv3b.id)).toEqual(['OPEN', 10000n]);

    // --- The statement of the month, row by row against the hand-built ledger -----------------------------------------------------
    const statement = dataOf(await ask(w.owner, payables.statement, { restaurantId: w.restaurantId, supplierId: w.supplierId, currency: 'IQD', from: '2026-10-01', to: '2026-10-22' }));
    const expected = [
      ['2026-10-10', 'INVOICE', 'INV-A-1001', '60000', '60000'],
      ['2026-10-12', 'INVOICE', 'INV-A-1002', '40000', '100000'],
      ['2026-10-14', 'PAYMENT', 'RCPT-14', '70000', '30000'],
      ['2026-10-16', 'CREDIT_NOTE', 'CN-77', '5000', '25000'],
      ['2026-10-18', 'INVOICE', 'INV-A-1003', '10000', '35000'],
      ['2026-10-19', 'INVOICE_VOID', 'INV-A-1003', '10000', '25000'],
      ['2026-10-20', 'INVOICE', 'INV-A-1003', '10000', '35000'],
      ['2026-10-21', 'PAYMENT', 'TRF-21', '20000', '15000'],
      ['2026-10-22', 'PAYMENT_REVERSAL', 'TRF-21', '20000', '35000'],
    ];
    expect(statement.rows.map((r) => [r.date, r.kind, r.ref, r.amountMinor, r.balanceMinor])).toEqual(expected);
    expect(statement.opening).toBe('0');
    expect(statement.closing).toBe('35000');
    expect(statement.totalsByKind).toEqual({ INVOICE: '120000', INVOICE_VOID: '10000', PAYMENT: '90000', PAYMENT_REVERSAL: '20000', CREDIT_NOTE: '5000' });
    // 120,000 billed - 10,000 voided - 90,000 paid + 20,000 reversed - 5,000 credit = 35,000.
    expect(120000n - 10000n - 90000n + 20000n - 5000n).toBe(35000n);
    // Today is 22 October, so the statement also checks its closing figure against the invoices themselves.
    expect(statement.invariant).toEqual({ ok: true, difference: '0' });

    // --- The same, from the raw rows with this file's own SQL: closing = open invoices - credit nobody has used -------------------
    const raw = await rawPosition(w.restaurantId, w.supplierId, 'IQD');
    expect(raw).toEqual({ billed: 110000n, paid: 90000n, reversed: 20000n, credits: 5000n, open: 35000n, unused: 0n });
    expect(raw.billed - (raw.paid - raw.reversed) - raw.credits).toBe(35000n);
    expect(raw.open - raw.unused).toBe(35000n);
    expect(BigInt(statement.closing!)).toBe(raw.open - raw.unused);

    // --- A statement that starts mid-month opens with the balance the earlier rows left (60,000 + 40,000 - 70,000 = 30,000) ------
    const later = dataOf(await ask(w.owner, payables.statement, { restaurantId: w.restaurantId, supplierId: w.supplierId, currency: 'IQD', from: '2026-10-15', to: '2026-10-22' }));
    expect(later.opening).toBe('30000');
    expect(later.rows.map((r) => [r.date, r.kind, r.balanceMinor])).toEqual(expected.slice(3).map((r) => [r[0], r[1], r[4]]));
    expect(later.closing).toBe('35000');

    // --- The USD invoice is in the USD statement only --------------------------------------------------------------------------
    const usd = dataOf(await ask(w.owner, payables.statement, { restaurantId: w.restaurantId, supplierId: w.supplierId, currency: 'USD', from: '2026-10-01', to: '2026-10-22' }));
    expect(usd.rows.map((r) => [r.date, r.kind, r.ref, r.amountMinor, r.balanceMinor])).toEqual([['2026-10-17', 'INVOICE', 'INV-A-USD-1', '5000', '5000']]);
    expect(usd.closing).toBe('5000');
    expect(await rawPosition(w.restaurantId, w.supplierId, 'USD')).toEqual({ billed: 5000n, paid: 0n, reversed: 0n, credits: 0n, open: 5000n, unused: 0n });

    // --- The balances list agrees, one row per currency ------------------------------------------------------------------------
    const balances = dataOf(await ask(w.owner, payables.balances, { restaurantId: w.restaurantId }));
    expect(balances.items.map((b) => [b.currency, b.openMinor, b.unappliedCreditMinor, b.netOwedMinor]).sort()).toEqual([
      ['IQD', '35000', '0', '35000'],
      ['USD', '5000', '0', '5000'],
    ]);

    // --- Stock moved only by receipts and the one return: LOT-1 holds 600 - 50 = 550 tablets -------------------------------------
    expect(await balanceOf(batch1.id, w.branchId)).toMatchObject({ available: 550, quarantine: 0 });
  });
});
