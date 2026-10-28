import { describe, expect, it } from 'vitest';
import {
  PurchasingError,
  buildStatement,
  canTransition,
  checkReceipt,
  costVariance,
  dayDiff,
  daysOverdue,
  dueBand,
  dueDate,
  invoiceFingerprint,
  invoiceInput,
  invoiceStatus,
  invoiceTotal,
  invoiceableQty,
  lineTotal,
  normalizeInvoiceNumber,
  planAllocation,
  poStatusAfterReceipt,
  quantityTriple,
  statementInvariant,
  voidedKeys,
} from '@/server/domain/pharmacy/purchasing';

function code(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    if (e instanceof PurchasingError) return e.code;
    throw e;
  }
}

describe('PO status machine', () => {
  const line = (o: number, b: number, r: number, rb: number) => ({
    qtyOrdered: o,
    bonusOrdered: b,
    receivedQty: r,
    receivedBonus: rb,
  });
  it('nothing received is ORDERED', () => {
    expect(poStatusAfterReceipt([line(10, 2, 0, 0), line(5, 0, 0, 0)])).toBe('ORDERED');
  });
  it('everything received including bonus is RECEIVED', () => {
    expect(poStatusAfterReceipt([line(10, 2, 10, 2), line(5, 0, 5, 0)])).toBe('RECEIVED');
  });
  it('anything in between is PARTIAL (bonus outstanding counts)', () => {
    expect(poStatusAfterReceipt([line(10, 2, 10, 1)])).toBe('PARTIAL');
    expect(poStatusAfterReceipt([line(10, 0, 3, 0), line(5, 0, 0, 0)])).toBe('PARTIAL');
  });
  it('an order with no lines is ORDERED', () => {
    expect(poStatusAfterReceipt([])).toBe('ORDERED');
  });
  it('allowed edges only', () => {
    expect(canTransition('DRAFT', 'ORDERED')).toBe(true);
    expect(canTransition('DRAFT', 'CANCELLED')).toBe(true);
    expect(canTransition('ORDERED', 'CANCELLED', { anyReceived: false })).toBe(true);
    expect(canTransition('ORDERED', 'CANCELLED', { anyReceived: true })).toBe(false);
    expect(canTransition('ORDERED', 'CANCELLED')).toBe(true);
    expect(canTransition('ORDERED', 'PARTIAL')).toBe(true);
    expect(canTransition('ORDERED', 'RECEIVED')).toBe(true);
    expect(canTransition('PARTIAL', 'RECEIVED')).toBe(true);
    expect(canTransition('ORDERED', 'CLOSED')).toBe(true);
    expect(canTransition('PARTIAL', 'CLOSED')).toBe(true);
    expect(canTransition('RECEIVED', 'CLOSED')).toBe(true);
  });
  it('everything else is refused', () => {
    expect(canTransition('DRAFT', 'CLOSED')).toBe(false);
    expect(canTransition('DRAFT', 'RECEIVED')).toBe(false);
    expect(canTransition('PARTIAL', 'CANCELLED')).toBe(false);
    expect(canTransition('RECEIVED', 'PARTIAL')).toBe(false);
    expect(canTransition('CLOSED', 'ORDERED')).toBe(false);
    expect(canTransition('CANCELLED', 'ORDERED')).toBe(false);
    expect(canTransition('CLOSED', 'CLOSED')).toBe(false);
  });
});

describe('checkReceipt', () => {
  const ol = { qtyOrdered: 10, bonusOrdered: 2, receivedQty: 4, receivedBonus: 1 };
  it('returns the new counters', () => {
    expect(checkReceipt(ol, 3, 1)).toEqual({ receivedQty: 7, receivedBonus: 2 });
  });
  it('the exact remainder is allowed', () => {
    expect(checkReceipt(ol, 6, 1)).toEqual({ receivedQty: 10, receivedBonus: 2 });
  });
  it('over quantity is OVER_RECEIPT', () => {
    expect(code(() => checkReceipt(ol, 7, 0))).toBe('OVER_RECEIPT');
  });
  it('over bonus is OVER_RECEIPT', () => {
    expect(code(() => checkReceipt(ol, 0, 2))).toBe('OVER_RECEIPT');
  });
  it('negative or fractional quantities are INVALID_QUANTITY', () => {
    expect(code(() => checkReceipt(ol, -1, 0))).toBe('INVALID_QUANTITY');
    expect(code(() => checkReceipt(ol, 1.5, 0))).toBe('INVALID_QUANTITY');
  });
});

describe('quantityTriple', () => {
  const ol = { id: 'L1', qtyOrdered: 10, bonusOrdered: 2 };
  it('the three figures differ and toInvoice is received minus invoiced', () => {
    const t = quantityTriple(
      ol,
      [
        { orderLineId: 'L1', qty: 4, bonusQty: 1, status: 'CONFIRMED' },
        { orderLineId: 'L1', qty: 3, bonusQty: 0, status: 'CONFIRMED' },
        { orderLineId: 'L1', qty: 99, bonusQty: 9, status: 'DRAFT' },
        { orderLineId: 'OTHER', qty: 50, bonusQty: 0, status: 'CONFIRMED' },
      ],
      [
        { orderLineId: 'L1', qtyInvoiced: 5 },
        { orderLineId: 'OTHER', qtyInvoiced: 40 },
      ],
    );
    expect(t).toEqual({ ordered: 12, received: 8, invoiced: 5, toReceive: 4, toInvoice: 3 });
  });
  it('nothing yet', () => {
    expect(quantityTriple(ol, [], [])).toEqual({ ordered: 12, received: 0, invoiced: 0, toReceive: 12, toInvoice: 0 });
  });
  it('invoiced above received throws', () => {
    expect(
      code(() =>
        quantityTriple(ol, [{ orderLineId: 'L1', qty: 2, bonusQty: 0, status: 'CONFIRMED' }], [
          { orderLineId: 'L1', qtyInvoiced: 3 },
        ]),
      ),
    ).toBe('INVOICED_EXCEEDS_RECEIVED');
  });
  it('toReceive never goes negative', () => {
    const t = quantityTriple(
      { id: 'L1', qtyOrdered: 1, bonusOrdered: 0 },
      [{ orderLineId: 'L1', qty: 2, bonusQty: 0, status: 'CONFIRMED' }],
      [],
    );
    expect(t.toReceive).toBe(0);
  });
});

describe('invoice totals', () => {
  it('lineTotal multiplies exactly, with zero allowed', () => {
    expect(lineTotal(12, 1500n)).toBe(18000n);
    expect(lineTotal(0, 1500n)).toBe(0n);
    expect(lineTotal(3, 0n)).toBe(0n);
  });
  it('lineTotal refuses a negative or fractional qty and a negative cost', () => {
    expect(code(() => lineTotal(-1, 1n))).toBe('INVALID_QUANTITY');
    expect(code(() => lineTotal(1.2, 1n))).toBe('INVALID_QUANTITY');
    expect(code(() => lineTotal(1, -1n))).toBe('INVALID_AMOUNT');
  });
  it('invoiceTotal sums lines plus a signed adjustment', () => {
    expect(invoiceTotal([100n, 250n], 0n)).toBe(350n);
    expect(invoiceTotal([100n, 250n], 50n)).toBe(400n);
    expect(invoiceTotal([100n, 250n], -50n)).toBe(300n);
    expect(invoiceTotal([100n], -100n)).toBe(0n);
  });
  it('a negative result is NEGATIVE_TOTAL', () => {
    expect(code(() => invoiceTotal([100n], -101n))).toBe('NEGATIVE_TOTAL');
    expect(code(() => invoiceTotal([], -1n))).toBe('NEGATIVE_TOTAL');
  });
  it('a non-zero adjustment needs a reason', () => {
    expect(code(() => invoiceInput({ adjustmentMinor: 5n }))).toBe('ADJUSTMENT_NEEDS_REASON');
    expect(code(() => invoiceInput({ adjustmentMinor: -5n, adjustmentReason: '   ' }))).toBe('ADJUSTMENT_NEEDS_REASON');
    expect(invoiceInput({ adjustmentMinor: -5n, adjustmentReason: ' freight ' })).toEqual({
      adjustmentMinor: -5n,
      adjustmentReason: 'freight',
    });
    expect(invoiceInput({ adjustmentMinor: 0n })).toEqual({ adjustmentMinor: 0n, adjustmentReason: null });
  });
  it('invoiceableQty is qty + bonus - invoiced, never negative', () => {
    expect(invoiceableQty({ qty: 10, bonusQty: 2, invoicedQty: 5 })).toBe(7);
    expect(invoiceableQty({ qty: 10, bonusQty: 2, invoicedQty: 12 })).toBe(0);
    expect(code(() => invoiceableQty({ qty: 10, bonusQty: 2, invoicedQty: 13 }))).toBe('INVOICED_EXCEEDS_RECEIVED');
  });
  it('large amounts stay exact', () => {
    const big = 2n ** 62n;
    expect(invoiceTotal([big, big], 0n)).toBe(2n ** 63n);
    expect(lineTotal(2, big)).toBe(2n ** 63n);
  });
});

describe('invoice keys', () => {
  it('normalises case, spacing, zero-width and digit scripts', () => {
    expect(normalizeInvoiceNumber('  inv   0012 ')).toBe('INV 0012');
    expect(normalizeInvoiceNumber('inv-١٢٣')).toBe('INV-123');
    expect(normalizeInvoiceNumber('inv-۱۲۳')).toBe('INV-123');
    expect(normalizeInvoiceNumber('IN​V‎-1‪')).toBe('INV-1');
    expect(normalizeInvoiceNumber('a\t\n b')).toBe('A B');
  });
  it('empty is EMPTY_NUMBER', () => {
    expect(code(() => normalizeInvoiceNumber('   '))).toBe('EMPTY_NUMBER');
    expect(code(() => normalizeInvoiceNumber('​'))).toBe('EMPTY_NUMBER');
  });
  const base = { supplierId: 's1', number: 'inv 123', date: '2026-10-28', currency: 'IQD', totalMinor: 500000n };
  it('fingerprint is a stable hex sha256', () => {
    const f = invoiceFingerprint(base);
    expect(f).toMatch(/^[0-9a-f]{64}$/);
    expect(invoiceFingerprint(base)).toBe(f);
  });
  it('same invoice in a different spacing, case, digit script or date type gives the same fingerprint', () => {
    const f = invoiceFingerprint({ ...base, number: 'INV 123' });
    expect(invoiceFingerprint(base)).toBe(f);
    expect(invoiceFingerprint({ ...base, number: ' Inv   123 ' })).toBe(f);
    expect(invoiceFingerprint({ ...base, number: 'inv ١٢٣' })).toBe(f);
    expect(invoiceFingerprint({ ...base, number: 'inv ۱۲۳' })).toBe(f);
    expect(invoiceFingerprint({ ...base, date: new Date('2026-10-28T23:59:00Z') })).toBe(f);
  });
  it('every component changes the fingerprint', () => {
    const f = invoiceFingerprint(base);
    expect(invoiceFingerprint({ ...base, supplierId: 's2' })).not.toBe(f);
    expect(invoiceFingerprint({ ...base, number: 'inv 124' })).not.toBe(f);
    expect(invoiceFingerprint({ ...base, date: '2026-10-29' })).not.toBe(f);
    expect(invoiceFingerprint({ ...base, currency: 'USD' })).not.toBe(f);
    expect(invoiceFingerprint({ ...base, totalMinor: 500001n })).not.toBe(f);
  });
  it('voidedKeys appends the void marker (R4-4a)', () => {
    expect(voidedKeys('INV 1', 'abc', 'id9')).toEqual({ number: 'INV 1#void-id9', fingerprint: 'abc#void-id9' });
  });
});

describe('due dates', () => {
  it('adds calendar days in UTC', () => {
    expect(dueDate('2026-01-31', 30)).toBe('2026-03-02');
    expect(dueDate('2028-02-29', 365)).toBe('2029-02-28');
    expect(dueDate('2026-10-28', 0)).toBe('2026-10-28');
    expect(dueDate('2026-12-31', 1)).toBe('2027-01-01');
    expect(dueDate(new Date('2026-02-27T23:30:00Z'), 2)).toBe('2026-03-01');
    expect(dueDate('2028-02-28', 1)).toBe('2028-02-29');
  });
  it('refuses bad input', () => {
    expect(code(() => dueDate('2026-02-30', 1))).toBe('INVALID_DATE');
    expect(code(() => dueDate('nope', 1))).toBe('INVALID_DATE');
    expect(code(() => dueDate('2026-01-01', -1))).toBe('INVALID_DAYS');
    expect(code(() => dueDate('2026-01-01', 1.5))).toBe('INVALID_DAYS');
  });
  it('dayDiff and daysOverdue', () => {
    expect(dayDiff('2026-03-01', '2026-02-27')).toBe(2);
    expect(daysOverdue('2026-10-20', '2026-10-28')).toBe(8);
    expect(daysOverdue('2026-10-28', '2026-10-28')).toBe(0);
    expect(daysOverdue('2026-10-30', '2026-10-28')).toBe(0);
  });
  it('bands at their boundaries', () => {
    const today = '2026-10-28';
    expect(dueBand('2026-11-05', today)).toBe('NOT_DUE'); // 8 days ahead
    expect(dueBand('2026-11-04', today)).toBe('DUE_7'); // 7 days ahead
    expect(dueBand('2026-10-28', today)).toBe('DUE_7'); // today
    expect(dueBand('2026-10-27', today)).toBe('OVERDUE_1_30');
    expect(dueBand('2026-09-28', today)).toBe('OVERDUE_1_30'); // 30
    expect(dueBand('2026-09-27', today)).toBe('OVERDUE_31_60'); // 31
    expect(dueBand('2026-08-29', today)).toBe('OVERDUE_31_60'); // 60
    expect(dueBand('2026-08-28', today)).toBe('OVERDUE_60_PLUS'); // 61
  });
});

describe('planAllocation', () => {
  const inv = [
    { id: 'b', dueDate: '2026-11-10', balanceMinor: 300n },
    { id: 'a', dueDate: '2026-11-10', balanceMinor: 200n },
    { id: 'c', dueDate: '2026-10-01', balanceMinor: 500n },
  ];
  it('oldest due first, then id; full pay each', () => {
    expect(planAllocation(600n, inv)).toEqual([
      { invoiceId: 'c', amountMinor: 500n },
      { invoiceId: 'a', amountMinor: 100n },
    ]);
    expect(planAllocation(1000n, inv)).toEqual([
      { invoiceId: 'c', amountMinor: 500n },
      { invoiceId: 'a', amountMinor: 200n },
      { invoiceId: 'b', amountMinor: 300n },
    ]);
  });
  it('leftover is UNALLOCATED (no advances)', () => {
    expect(code(() => planAllocation(1001n, inv))).toBe('UNALLOCATED');
  });
  it('a zero or negative amount is INVALID_AMOUNT', () => {
    expect(code(() => planAllocation(0n, inv))).toBe('INVALID_AMOUNT');
    expect(code(() => planAllocation(-1n, inv))).toBe('INVALID_AMOUNT');
  });
  it('skips paid-up invoices', () => {
    expect(planAllocation(5n, [{ id: 'z', dueDate: '2026-01-01', balanceMinor: 0n }, ...inv])).toEqual([
      { invoiceId: 'c', amountMinor: 5n },
    ]);
  });
  it('explicit allocations are validated', () => {
    expect(
      planAllocation(250n, inv, [
        { invoiceId: 'a', amountMinor: 50n },
        { invoiceId: 'b', amountMinor: 200n },
      ]),
    ).toEqual([
      { invoiceId: 'a', amountMinor: 50n },
      { invoiceId: 'b', amountMinor: 200n },
    ]);
    expect(code(() => planAllocation(250n, inv, [{ invoiceId: 'a', amountMinor: 50n }]))).toBe('UNALLOCATED');
    expect(code(() => planAllocation(10n, inv, [{ invoiceId: 'a', amountMinor: 50n }]))).toBe('OVER_ALLOCATION');
    expect(code(() => planAllocation(201n, inv, [{ invoiceId: 'a', amountMinor: 201n }]))).toBe('OVER_ALLOCATION');
    expect(
      code(() =>
        planAllocation(10n, inv, [
          { invoiceId: 'a', amountMinor: 0n },
          { invoiceId: 'b', amountMinor: 10n },
        ]),
      ),
    ).toBe('INVALID_AMOUNT');
    expect(code(() => planAllocation(10n, inv, [{ invoiceId: 'nope', amountMinor: 10n }]))).toBe('UNKNOWN_INVOICE');
  });
  it('duplicate explicit ids are summed first', () => {
    expect(
      planAllocation(150n, inv, [
        { invoiceId: 'a', amountMinor: 100n },
        { invoiceId: 'a', amountMinor: 50n },
      ]),
    ).toEqual([{ invoiceId: 'a', amountMinor: 150n }]);
    expect(
      code(() =>
        planAllocation(250n, inv, [
          { invoiceId: 'a', amountMinor: 100n },
          { invoiceId: 'a', amountMinor: 150n },
        ]),
      ),
    ).toBe('OVER_ALLOCATION');
  });
  it('is exact at 2^62', () => {
    const big = 2n ** 62n;
    expect(
      planAllocation(big + 1n, [
        { id: 'x', dueDate: '2026-01-01', balanceMinor: big },
        { id: 'y', dueDate: '2026-01-02', balanceMinor: 5n },
      ]),
    ).toEqual([
      { invoiceId: 'x', amountMinor: big },
      { invoiceId: 'y', amountMinor: 1n },
    ]);
  });
  it('1000 seeded random plans: sums match and no allocation exceeds its balance', () => {
    let s = 123456789;
    const rnd = (n: number) => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s % n;
    };
    for (let i = 0; i < 1000; i++) {
      const n = 1 + rnd(8);
      const invoices = Array.from({ length: n }, (_, k) => ({
        id: `i${k}`,
        dueDate: dueDate('2026-01-01', rnd(200)),
        balanceMinor: BigInt(rnd(1000)) * 2n ** BigInt(rnd(40)),
      }));
      const total = invoices.reduce((a, x) => a + x.balanceMinor, 0n);
      if (total === 0n) continue;
      const amount = (total * BigInt(1 + rnd(1000))) / 1000n || 1n;
      const plan = planAllocation(amount, invoices);
      expect(plan.reduce((a, p) => a + p.amountMinor, 0n)).toBe(amount);
      for (const p of plan) {
        expect(p.amountMinor > 0n).toBe(true);
        expect(p.amountMinor <= invoices.find((x) => x.id === p.invoiceId)!.balanceMinor).toBe(true);
      }
      // oldest-due-first: every planned invoice before the last is paid in full
      for (const p of plan.slice(0, -1)) {
        expect(p.amountMinor).toBe(invoices.find((x) => x.id === p.invoiceId)!.balanceMinor);
      }
    }
  });
});

describe('invoiceStatus', () => {
  it('derives the status', () => {
    expect(invoiceStatus({ totalMinor: 100n, paidMinor: 0n, creditedMinor: 0n, voided: false })).toBe('OPEN');
    expect(invoiceStatus({ totalMinor: 100n, paidMinor: 40n, creditedMinor: 0n, voided: false })).toBe('PARTIAL');
    expect(invoiceStatus({ totalMinor: 100n, paidMinor: 0n, creditedMinor: 1n, voided: false })).toBe('PARTIAL');
    expect(invoiceStatus({ totalMinor: 100n, paidMinor: 60n, creditedMinor: 40n, voided: false })).toBe('PAID');
    expect(invoiceStatus({ totalMinor: 100n, paidMinor: 0n, creditedMinor: 0n, voided: true })).toBe('VOID');
  });
  it('a zero-total invoice is PAID', () => {
    expect(invoiceStatus({ totalMinor: 0n, paidMinor: 0n, creditedMinor: 0n, voided: false })).toBe('PAID');
  });
  it('over-settled throws', () => {
    expect(code(() => invoiceStatus({ totalMinor: 100n, paidMinor: 60n, creditedMinor: 41n, voided: false }))).toBe(
      'OVER_SETTLED',
    );
  });
});

describe('buildStatement', () => {
  it('hand-figured statement with running balances', () => {
    const d = (day: number) => new Date(Date.UTC(2026, 9, day));
    const s = buildStatement({
      openingMinor: 1_000_000n,
      rows: [
        // deliberately out of order; the two on day 5 keep their input order
        { at: d(20), kind: 'INVOICE_VOID', amountMinor: 400_000n, ref: 'INV-2' },
        { at: d(5), kind: 'INVOICE', amountMinor: 2_500_000n, ref: 'INV-1' },
        { at: d(5), kind: 'PAYMENT', amountMinor: 1_000_000n, ref: 'PAY-1' },
        { at: d(10), kind: 'CREDIT_NOTE', amountMinor: 250_000n, ref: 'CN-1' },
        { at: d(12), kind: 'PAYMENT_REVERSAL', amountMinor: 1_000_000n, ref: 'PAY-1' },
        { at: d(15), kind: 'INVOICE', amountMinor: 400_000n, ref: 'INV-2' },
      ],
    });
    expect(s.rows.map((r) => [r.ref, r.kind, r.balanceMinor])).toEqual([
      ['INV-1', 'INVOICE', 3_500_000n],
      ['PAY-1', 'PAYMENT', 2_500_000n],
      ['CN-1', 'CREDIT_NOTE', 2_250_000n],
      ['PAY-1', 'PAYMENT_REVERSAL', 3_250_000n],
      ['INV-2', 'INVOICE', 3_650_000n],
      ['INV-2', 'INVOICE_VOID', 3_250_000n],
    ]);
    // 1,000,000 + 2,500,000 - 1,000,000 - 250,000 + 1,000,000 + 400,000 - 400,000
    expect(s.closingMinor).toBe(3_250_000n);
    expect(s.openingMinor).toBe(1_000_000n);
    expect(s.totals).toEqual({
      INVOICE: 2_900_000n,
      PAYMENT: 1_000_000n,
      PAYMENT_REVERSAL: 1_000_000n,
      CREDIT_NOTE: 250_000n,
      INVOICE_VOID: 400_000n,
    });
  });
  it('empty statement closes at the opening', () => {
    const s = buildStatement({ openingMinor: 7n, rows: [] });
    expect(s.closingMinor).toBe(7n);
    expect(s.rows).toEqual([]);
    expect(s.totals.INVOICE).toBe(0n);
  });
  it('a negative amount is INVALID_AMOUNT', () => {
    expect(
      code(() =>
        buildStatement({ openingMinor: 0n, rows: [{ at: new Date(0), kind: 'INVOICE', amountMinor: -1n, ref: 'x' }] }),
      ),
    ).toBe('INVALID_AMOUNT');
  });
  it('exact at 2^62', () => {
    const big = 2n ** 62n;
    const s = buildStatement({
      openingMinor: big,
      rows: [
        { at: new Date(1), kind: 'INVOICE', amountMinor: big, ref: 'a' },
        { at: new Date(2), kind: 'PAYMENT', amountMinor: big, ref: 'b' },
      ],
    });
    expect(s.closingMinor).toBe(big);
  });
  it('the invariant: closing = open balances - unapplied credit', () => {
    const open = [{ balanceMinor: 700n }, { balanceMinor: 300n }];
    expect(statementInvariant(900n, open, 100n)).toEqual({ ok: true, difference: 0n });
    expect(statementInvariant(1000n, open, 0n)).toEqual({ ok: true, difference: 0n });
    expect(statementInvariant(950n, open, 100n)).toEqual({ ok: false, difference: 50n });
    expect(statementInvariant(900n, [{ balanceMinor: 1000n }], 0n, 100n)).toEqual({ ok: true, difference: 0n });
  });
});

describe('costVariance', () => {
  it('signed differences', () => {
    expect(costVariance({ orderedUnitCost: 100n, receivedUnitCost: 110n, invoicedUnitCost: 105n })).toEqual({
      orderVsReceived: 10n,
      receivedVsInvoiced: -5n,
      orderVsInvoiced: 5n,
    });
  });
  it('null when either side is missing', () => {
    expect(costVariance({ orderedUnitCost: 100n, receivedUnitCost: 90n })).toEqual({
      orderVsReceived: -10n,
      receivedVsInvoiced: null,
      orderVsInvoiced: null,
    });
    expect(costVariance({})).toEqual({ orderVsReceived: null, receivedVsInvoiced: null, orderVsInvoiced: null });
    expect(costVariance({ orderedUnitCost: 0n, invoicedUnitCost: 0n }).orderVsInvoiced).toBe(0n);
  });
});
