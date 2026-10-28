import { describe, expect, it } from 'vitest';
import { planAllocation, PurchasingError } from '@/server/domain/pharmacy/purchasing';
import {
  allocationPreview,
  addReturnLine,
  applyInputOf,
  emptyReturnDraft,
  returnInputOf,
  returnSignature,
  type ReturnLineDraft,
  creditInputOf,
  dueFrom,
  invoiceLinesStart,
  canPaySelected,
  creditSignature,
  emptyCreditDraft,
  emptyInvoiceDraft,
  emptyPaymentDraft,
  groupByCurrency,
  invoiceInputOf,
  invoiceSignature,
  invoiceTotalsOf,
  paymentInputOf,
  paymentSignature,
  parseSignedMoney,
  reasonAttempt,
  selectionTotals,
  statementCsv,
  type InvoiceDraft,
  type OpenInvoice,
} from '@/app/pharmacy/_ui/purchasing-money-logic';

const inv = (id: string, due: string, balance: bigint, extra: Partial<OpenInvoice> = {}): OpenInvoice => ({
  id,
  number: id.toUpperCase(),
  supplierId: 's1',
  currency: 'IQD',
  dueDate: due,
  balanceMinor: balance,
  ...extra,
});

describe('parseSignedMoney', () => {
  it('reads freight as positive and a discount as negative, in the currency digits', () => {
    expect(parseSignedMoney('', 'IQD')).toBe(0n);
    expect(parseSignedMoney('1500', 'IQD')).toBe(1500n);
    expect(parseSignedMoney('-1,500', 'IQD')).toBe(-1500n);
    expect(parseSignedMoney('+12.5', 'USD')).toBe(1250n);
    expect(parseSignedMoney('-0.05', 'USD')).toBe(-5n);
  });
  it('refuses decimals for IQD, three decimals for USD and words', () => {
    expect(parseSignedMoney('1.5', 'IQD')).toBeNull();
    expect(parseSignedMoney('1.505', 'USD')).toBeNull();
    expect(parseSignedMoney('abc', 'IQD')).toBeNull();
    expect(parseSignedMoney('--5', 'IQD')).toBeNull();
  });
});

describe('invoice totals', () => {
  it('multiplies quantity by the invoiced cost per line, in BigInt, and adds the signed adjustment', () => {
    const t = invoiceTotalsOf(
      [
        { qty: '10', cost: '1500' },
        { qty: '3', cost: '250' },
      ],
      '-500',
      'IQD',
    );
    expect(t).toEqual({ linesMinor: 15750n, adjustmentMinor: -500n, totalMinor: 15250n });
  });
  it('keeps USD cents exact and never goes through a float', () => {
    const t = invoiceTotalsOf([{ qty: '3', cost: '0.10' }], '0.01', 'USD');
    expect(t).toEqual({ linesMinor: 30n, adjustmentMinor: 1n, totalMinor: 31n });
    const big = invoiceTotalsOf([{ qty: '9999999', cost: '9999999999' }], '', 'IQD');
    expect(big?.totalMinor).toBe(9999999n * 9999999999n);
  });
  it('is null while a line or the adjustment is not a valid amount, and refuses a negative total', () => {
    expect(invoiceTotalsOf([{ qty: '1', cost: 'x' }], '', 'IQD')).toBeNull();
    expect(invoiceTotalsOf([{ qty: '1', cost: '100' }], 'x', 'IQD')).toBeNull();
    expect(invoiceTotalsOf([{ qty: '1', cost: '100' }], '-500', 'IQD')?.totalMinor).toBe(-400n);
  });
});

const lines = [
  { receiptLineId: 'r1', receiptId: 'rc1', receiptNumber: 'R-1', productName: 'Amoxil', unitLabel: 'box', lot: 'L1', expiry: '2028-01-01', invoiceableQty: 10, currency: 'IQD' as const, unitCostMinor: '1500' },
  { receiptLineId: 'r2', receiptId: 'rc1', receiptNumber: 'R-1', productName: 'Panadol', unitLabel: 'box', lot: 'L2', expiry: '2028-01-01', invoiceableQty: 4, currency: 'IQD' as const, unitCostMinor: '250' },
];

const draft = (patch: Partial<InvoiceDraft> = {}): InvoiceDraft => ({
  ...emptyInvoiceDraft('k1', 'IQD'),
  supplierId: 's1',
  number: 'INV-77',
  invoiceDate: '2026-10-01',
  dueDate: '2026-10-31',
  lines: { r1: { checked: true, qty: '10', cost: '1500' }, r2: { checked: false, qty: '4', cost: '250' } },
  ...patch,
});

describe('invoiceInputOf', () => {
  it('sends only the ticked lines, costs as minor strings, and the adjustment signed', () => {
    const built = invoiceInputOf(draft({ adjustment: '-500', adjustmentReason: 'early discount' }), lines);
    expect(built.problems).toEqual({});
    expect(built.input).toEqual({
      supplierId: 's1',
      number: 'INV-77',
      invoiceDate: '2026-10-01',
      dueDate: '2026-10-31',
      currency: 'IQD',
      adjustmentMinor: '-500',
      adjustmentReason: 'early discount',
      lines: [{ receiptLineId: 'r1', qtyInvoiced: 10, unitCostMinor: '1500' }],
    });
  });
  it('refuses more than was received on a line before the server does', () => {
    const built = invoiceInputOf(draft({ lines: { r1: { checked: true, qty: '11', cost: '1500' }, r2: { checked: false, qty: '4', cost: '250' } } }), lines);
    expect(built.input).toBeUndefined();
    expect(built.problems['lines.r1.qty']).toBe('exceeds');
  });
  it('needs a number, a date, one ticked line and a reason for an adjustment', () => {
    const none = invoiceInputOf(draft({ number: ' ', lines: { r1: { checked: false, qty: '1', cost: '1' } } }), lines);
    expect(none.problems.number).toBe('number');
    expect(none.problems.lines).toBe('lines');
    const noReason = invoiceInputOf(draft({ adjustment: '100', adjustmentReason: '' }), lines);
    expect(noReason.problems.adjustmentReason).toBe('reason');
    const bad = invoiceInputOf(draft({ invoiceDate: '' }), lines);
    expect(bad.problems.invoiceDate).toBe('date');
    expect(invoiceInputOf(draft({ dueDate: '2026-09-01' }), lines).problems.dueDate).toBe('due');
  });
  it('refuses lines of a currency other than the invoice currency', () => {
    const usd = [{ ...lines[0]!, currency: 'USD' as const }, lines[1]!];
    expect(invoiceInputOf(draft(), usd).problems.currency).toBe('currency');
  });
});

describe('invoice attempt key', () => {
  it('has the same signature while the request is the same and another when a ticked line changes', () => {
    const a = invoiceSignature(draft());
    expect(invoiceSignature(draft({ clientKey: 'other', keySig: 'x' }))).toBe(a);
    expect(invoiceSignature(draft({ lines: { ...draft().lines, r1: { checked: true, qty: '9', cost: '1500' } } }))).not.toBe(a);
    expect(invoiceSignature(draft({ number: 'INV-78' }))).not.toBe(a);
  });
  it('ignores an unticked line (it is not sent)', () => {
    const a = invoiceSignature(draft());
    expect(invoiceSignature(draft({ lines: { ...draft().lines, r2: { checked: false, qty: '1', cost: '1' } } }))).toBe(a);
  });
});

describe('allocationPreview', () => {
  const open = [inv('b', '2026-10-20', 500n), inv('a', '2026-10-10', 300n), inv('c', '2026-10-20', 900n)];

  it('auto mode pays the oldest due first, then by id, and mirrors the domain planner', () => {
    const preview = allocationPreview(open, 1000n, 'auto', {});
    expect(preview.error).toBeNull();
    expect(preview.rows).toEqual([
      { invoiceId: 'a', amountMinor: 300n },
      { invoiceId: 'b', amountMinor: 500n },
      { invoiceId: 'c', amountMinor: 200n },
    ]);
    expect(preview.leftoverMinor).toBe(0n);
    const domain = planAllocation(1000n, open);
    expect(preview.rows).toEqual(domain);
  });
  it('auto mode with more than all balances shows the leftover and UNALLOCATED', () => {
    const preview = allocationPreview(open, 2000n, 'auto', {});
    expect(preview.error).toBe('UNALLOCATED');
    expect(preview.leftoverMinor).toBe(300n);
    expect(preview.rows.map((r) => r.amountMinor)).toEqual([300n, 500n, 900n]);
  });
  it('explicit mode sums the parts and shows what is left to place', () => {
    const preview = allocationPreview(open, 700n, 'explicit', { a: '300', c: '200' });
    expect(preview.rows).toEqual([
      { invoiceId: 'a', amountMinor: 300n },
      { invoiceId: 'c', amountMinor: 200n },
    ]);
    expect(preview.leftoverMinor).toBe(200n);
    expect(preview.error).toBe('UNALLOCATED');
    const ok = allocationPreview(open, 500n, 'explicit', { a: '300', c: '200' });
    expect(ok.error).toBeNull();
    expect(ok.leftoverMinor).toBe(0n);
  });
  it('explicit mode refuses a part above the balance and a total above the amount, as the domain does', () => {
    expect(allocationPreview(open, 900n, 'explicit', { a: '400' }).error).toBe('OVER_ALLOCATION');
    expect(allocationPreview(open, 100n, 'explicit', { a: '200' }).error).toBe('OVER_ALLOCATION');
    expect(() => planAllocation(900n, open, [{ invoiceId: 'a', amountMinor: 400n }])).toThrowError(PurchasingError);
  });
  it('reads USD parts in cents', () => {
    const usd = [inv('a', '2026-10-10', 1250n, { currency: 'USD' })];
    const preview = allocationPreview(usd, 1250n, 'explicit', { a: '12.50' });
    expect(preview.error).toBeNull();
    expect(preview.rows).toEqual([{ invoiceId: 'a', amountMinor: 1250n }]);
  });
  it('flags a part that is not an amount', () => {
    expect(allocationPreview(open, 100n, 'explicit', { a: 'x' }).error).toBe('INVALID');
  });
});

describe('payment input and key', () => {
  const open = [inv('a', '2026-10-10', 300n), inv('b', '2026-10-20', 500n)];
  const base = { ...emptyPaymentDraft('k1', '2026-10-28'), amount: '400', method: 'CASH' as const, reference: ' chq 12 ' };

  it('auto mode sends no allocations; explicit mode sends the named parts only', () => {
    const auto = paymentInputOf(base, 's1', 'IQD', open);
    expect(auto.problems).toEqual({});
    expect(auto.input).toEqual({ supplierId: 's1', currency: 'IQD', method: 'CASH', amountMinor: '400', paidOn: '2026-10-28', reference: 'chq 12' });
    const explicit = paymentInputOf({ ...base, mode: 'explicit', explicit: { a: '100', b: '300' } }, 's1', 'IQD', open);
    expect(explicit.input).toEqual({
      supplierId: 's1',
      currency: 'IQD',
      method: 'CASH',
      amountMinor: '400',
      paidOn: '2026-10-28',
      reference: 'chq 12',
      allocations: [
        { invoiceId: 'a', amountMinor: '100' },
        { invoiceId: 'b', amountMinor: '300' },
      ],
    });
  });
  it('needs an amount above zero, a date, and an amount that can be placed', () => {
    expect(paymentInputOf({ ...base, amount: '0' }, 's1', 'IQD', open).problems.amount).toBe('amount');
    expect(paymentInputOf({ ...base, paidOn: '' }, 's1', 'IQD', open).problems.paidOn).toBe('date');
    expect(paymentInputOf({ ...base, amount: '5000' }, 's1', 'IQD', open).problems.amount).toBe('UNALLOCATED');
    expect(paymentInputOf({ ...base, mode: 'explicit', explicit: { a: '999' } }, 's1', 'IQD', open).problems.allocations).toBe('OVER_ALLOCATION');
  });
  it('keeps one key while the payment is the same and takes a new signature when anything sent changes', () => {
    const a = paymentSignature(base, 's1', 'IQD');
    expect(paymentSignature({ ...base, clientKey: 'zz', keySig: 'q' }, 's1', 'IQD')).toBe(a);
    expect(paymentSignature({ ...base, amount: '401' }, 's1', 'IQD')).not.toBe(a);
    expect(paymentSignature({ ...base, method: 'CHEQUE_MANUAL' }, 's1', 'IQD')).not.toBe(a);
    expect(paymentSignature({ ...base, mode: 'explicit', explicit: { a: '1' } }, 's1', 'IQD')).not.toBe(a);
    expect(paymentSignature(base, 's2', 'IQD')).not.toBe(a);
    // explicit parts typed in another order are the same request
    const x = paymentSignature({ ...base, mode: 'explicit', explicit: { a: '1', b: '2' } }, 's1', 'IQD');
    const y = paymentSignature({ ...base, mode: 'explicit', explicit: { b: '2', a: '1' } }, 's1', 'IQD');
    expect(x).toBe(y);
  });
});

describe('credit and reason attempts', () => {
  it('credit signature changes with the amount, the number and the linked return', () => {
    const d = { ...emptyCreditDraft('k', 'IQD', '2026-10-28'), supplierId: 's1', number: 'CN-1', amount: '500' };
    const a = creditSignature(d);
    expect(creditSignature({ ...d, clientKey: 'z' })).toBe(a);
    expect(creditSignature({ ...d, amount: '501' })).not.toBe(a);
    expect(creditSignature({ ...d, number: 'CN-2' })).not.toBe(a);
    expect(creditSignature({ ...d, supplierReturnId: 'ret1' })).not.toBe(a);
  });
  it('a reason action reuses its key while the reason is the same and replaces it after an edit', () => {
    const first = reasonAttempt({ clientKey: 'rv-1', keySig: undefined, reason: 'wrong supplier' }, () => 'rv-2');
    expect(first.clientKey).toBe('rv-2');
    const again = reasonAttempt({ clientKey: first.clientKey, keySig: first.keySig, reason: 'wrong supplier' }, () => 'rv-3');
    expect(again.clientKey).toBe('rv-2');
    const edited = reasonAttempt({ clientKey: first.clientKey, keySig: first.keySig, reason: 'wrong supplier!' }, () => 'rv-3');
    expect(edited.clientKey).toBe('rv-3');
  });
});

describe('payables grouping never mixes currencies', () => {
  const items = [
    inv('a', '2026-10-10', 300n, { currency: 'IQD' }),
    inv('b', '2026-10-20', 500n, { currency: 'USD' }),
    inv('c', '2026-10-21', 900n, { currency: 'IQD' }),
  ];
  it('groups by currency, one group each', () => {
    const groups = groupByCurrency(items);
    expect(groups.map((g) => g.currency).sort()).toEqual(['IQD', 'USD']);
    expect(groups.find((g) => g.currency === 'IQD')!.totalMinor).toBe(1200n);
    expect(groups.find((g) => g.currency === 'USD')!.totalMinor).toBe(500n);
  });
  it('totals the selection per currency', () => {
    const totals = selectionTotals(items, new Set(['a', 'c', 'b']));
    expect(totals.find((g) => g.currency === 'IQD')!.totalMinor).toBe(1200n);
    expect(totals).toHaveLength(2);
  });
  it('allows Pay selected only for one supplier and one currency', () => {
    expect(canPaySelected(items, new Set())).toEqual({ ok: false, reason: 'none' });
    expect(canPaySelected(items, new Set(['a', 'c']))).toEqual({ ok: true, supplierId: 's1', currency: 'IQD', ids: ['a', 'c'] });
    expect(canPaySelected(items, new Set(['a', 'b']))).toEqual({ ok: false, reason: 'currency' });
    const other = [...items, inv('d', '2026-10-22', 5n, { supplierId: 's2' })];
    expect(canPaySelected(other, new Set(['a', 'd']))).toEqual({ ok: false, reason: 'supplier' });
  });
});

describe('statementCsv', () => {
  const labels = { date: 'Date', ref: 'Reference', kind: 'Kind', amount: 'Amount', balance: 'Balance' };
  const rows = [
    { date: '2026-10-01', ref: 'INV-1', kind: 'Invoice', amountMinor: '1500000', balanceMinor: '1500000' },
    { date: '2026-10-05', ref: 'دفعة "نقد", 12', kind: 'Payment', amountMinor: '-500000', balanceMinor: '1000000' },
  ];
  it('starts with a UTF-8 BOM, quotes commas and quotes, and keeps Arabic text', () => {
    const csv = statementCsv(rows, 'IQD', labels, { opening: '0', closing: '1000000' });
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('"دفعة ""نقد"", 12"');
    expect(csv.split('\r\n')[0]).toBe('﻿Date,Reference,Kind,Amount,Balance');
  });
  it('writes IQD with no decimals and USD with two, signed, without grouping', () => {
    expect(statementCsv(rows, 'IQD', labels, {})).toContain('-500000,1000000');
    const usd = statementCsv([{ date: '2026-10-01', ref: 'A', kind: 'Invoice', amountMinor: '-1250', balanceMinor: '5' }], 'USD', labels, {});
    expect(usd).toContain('-12.50,0.05');
  });
  it('defuses a spreadsheet formula in a text cell', () => {
    const csv = statementCsv([{ date: '2026-10-01', ref: '=HYPERLINK("x")', kind: 'Invoice', amountMinor: '1', balanceMinor: '1' }], 'IQD', labels, {});
    expect(csv).toContain("\"'=HYPERLINK(\"\"x\"\")\"");
  });
  it('includes the opening and closing balance rows when given', () => {
    const csv = statementCsv(rows, 'IQD', labels, { opening: '0', closing: '1000000', openingLabel: 'Opening', closingLabel: 'Closing' });
    const lines = csv.split('\r\n');
    expect(lines[1]).toBe(',Opening,,,0');
    expect(lines[lines.length - 1]).toBe(',Closing,,,1000000');
  });
});

describe('credit input, applying credit, due date and line start', () => {
  const open = [inv('a', '2026-10-10', 300n), inv('b', '2026-10-20', 500n)];
  it('builds a credit note input and refuses a missing number or amount', () => {
    const d = { ...emptyCreditDraft('k', 'USD', '2026-10-28'), supplierId: 's1', number: ' CN-1 ', amount: '12.50', supplierReturnId: 'r1' };
    expect(creditInputOf(d).input).toEqual({ supplierId: 's1', number: 'CN-1', currency: 'USD', amountMinor: '1250', noteDate: '2026-10-28', supplierReturnId: 'r1', note: '' });
    const bad = creditInputOf({ ...d, number: '', amount: '0' });
    expect(bad.problems).toEqual({ number: 'number', amount: 'amount' });
  });
  it('auto apply spends the smaller of the credit and the balances, and sends no allocations', () => {
    const r = applyInputOf({ clientKey: 'k', mode: 'auto', explicit: {} }, 'cn1', 600n, open);
    expect(r.input).toEqual({ creditNoteId: 'cn1' });
    expect(r.preview.rows).toEqual([
      { invoiceId: 'a', amountMinor: 300n },
      { invoiceId: 'b', amountMinor: 300n },
    ]);
    expect(applyInputOf({ clientKey: 'k', mode: 'auto', explicit: {} }, 'cn1', 0n, open).error).toBe('AMOUNT');
  });
  it('explicit apply refuses more than the credit that is left and more than a balance', () => {
    expect(applyInputOf({ clientKey: 'k', mode: 'explicit', explicit: { a: '300', b: '400' } }, 'cn1', 600n, open).error).toBe('OVER_ALLOCATION');
    expect(applyInputOf({ clientKey: 'k', mode: 'explicit', explicit: { a: '301' } }, 'cn1', 600n, open).error).toBe('OVER_ALLOCATION');
    const ok = applyInputOf({ clientKey: 'k', mode: 'explicit', explicit: { a: '100' } }, 'cn1', 600n, open);
    expect(ok.input).toEqual({ creditNoteId: 'cn1', allocations: [{ invoiceId: 'a', amountMinor: '100' }] });
  });
  it('the due date defaults to the invoice date plus the supplier terms', () => {
    expect(dueFrom('2026-10-01', 30)).toBe('2026-10-31');
    expect(dueFrom('2026-12-20', 30)).toBe('2027-01-19');
    expect(dueFrom('', 30)).toBe('');
    expect(dueFrom('2026-10-01', -1)).toBe('');
  });
  it('lines start unticked with the quantity left and the receipt cost as typed text', () => {
    const start = invoiceLinesStart(lines, 'IQD');
    expect(start.r1).toEqual({ checked: false, qty: '10', cost: '1500' });
    const usd = invoiceLinesStart([{ ...lines[0]!, currency: 'USD' as const, unitCostMinor: '1250' }], 'USD');
    expect(usd.r1!.cost).toBe('12.50');
  });
});

describe('supplier return draft', () => {
  const l = (patch: Partial<ReturnLineDraft> = {}): ReturnLineDraft => ({ batchId: 'b1', bucket: 'AVAILABLE', qty: '3', max: 10, productName: 'Amoxil', lot: 'L1', expiry: '2028-01-01', ...patch });
  const base = { ...emptyReturnDraft('k'), supplierId: 's1', reason: 'damaged boxes', lines: [l()] };

  it('sends the supplier, reason, note and lines by batch and bucket in whole base units', () => {
    const built = returnInputOf({ ...base, note: ' x ' });
    expect(built.problems).toEqual({});
    expect(built.input).toEqual({ supplierId: 's1', reason: 'damaged boxes', note: 'x', lines: [{ batchId: 'b1', bucket: 'AVAILABLE', qty: 3 }] });
  });
  it('refuses a quantity above what the screen saw, a duplicate batch and bucket, a short reason and no lines', () => {
    expect(returnInputOf({ ...base, lines: [l({ qty: '11' })] }).problems['lines.0.qty']).toBe('exceeds');
    expect(returnInputOf({ ...base, lines: [l({ qty: '0' })] }).problems['lines.0.qty']).toBe('qty');
    expect(returnInputOf({ ...base, lines: [l(), l()] }).problems['lines.1.batchId']).toBe('duplicate');
    expect(returnInputOf({ ...base, reason: 'ab' }).problems.reason).toBe('reason');
    expect(returnInputOf({ ...base, lines: [] }).problems.lines).toBe('lines');
    expect(returnInputOf({ ...base, supplierId: '' }).problems.supplierId).toBe('supplier');
  });
  it('the same batch in the other bucket is another line', () => {
    expect(returnInputOf({ ...base, lines: [l(), l({ bucket: 'QUARANTINE' })] }).problems).toEqual({});
  });
  it('adding a line twice keeps one, and the signature ignores the key and the screen-only fields', () => {
    expect(addReturnLine([l()], l({ qty: '9' }))).toHaveLength(1);
    expect(addReturnLine([l()], l({ bucket: 'QUARANTINE' }))).toHaveLength(2);
    const a = returnSignature(base);
    expect(returnSignature({ ...base, clientKey: 'z', keySig: 'q', lines: [l({ max: 99, productName: 'Other' })] })).toBe(a);
    expect(returnSignature({ ...base, lines: [l({ qty: '4' })] })).not.toBe(a);
    expect(returnSignature({ ...base, reason: 'expired' })).not.toBe(a);
  });
});
