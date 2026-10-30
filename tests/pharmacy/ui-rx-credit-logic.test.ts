import { describe, expect, it } from 'vitest';
import { checkIssuedOn, checkPatientIdNote } from '@/server/domain/pharmacy/prescriptions';
import { ageingBuckets, creditCheck } from '@/server/domain/pharmacy/credit';
import {
  controlledLimits,
  emptyRxDraft,
  fileProblem,
  issueBounds,
  limitIdNote,
  prescriptionGate,
  rxLevelOfLines,
  rxWire,
  validateRx,
  type RxDraft,
} from '@/app/pharmacy/_ui/prescription-logic';
import {
  ageingRowOf,
  creditPaymentsOf,
  creditPreview,
  creditView,
  creditablePerson,
  statementRowOf,
  signedMinorText,
  type CustomerLite,
} from '@/app/pharmacy/_ui/credit-logic';
import { saleAttemptFor, saleSignature, emptyCart, type PayDraft } from '@/app/pharmacy/_ui/sell-logic';

const TODAY = '2026-10-28';
const full = (over: Partial<RxDraft> = {}): RxDraft => ({ ...emptyRxDraft(), number: 'RX-1', prescriberName: 'Dr Kareem', patientName: 'Sara', patientIdNote: 'ID card: 1234', issuedOn: '2026-10-20', ...over });

describe('prescription form', () => {
  it('needs the number, the prescriber and a date; the patient only for a controlled drug', () => {
    expect(validateRx(emptyRxDraft(), 'RX', TODAY)).toMatchObject({ number: 'required', prescriberName: 'required', issuedOn: 'required' });
    expect(validateRx(emptyRxDraft(), 'RX', TODAY).patientName).toBeUndefined();
    expect(validateRx(full({ patientName: '' }), 'RESTRICTED', TODAY)).toEqual({ patientName: 'required' });
    expect(validateRx(full({ patientName: '' }), 'RX', TODAY)).toEqual({});
  });

  it('judges the issue date in Baghdad days with the server rule: 30 days for controlled, 180 for RX, never the future', () => {
    // The table is the server's own function: the form can never accept what the sale refuses.
    for (const level of ['RX', 'RESTRICTED'] as const) {
      for (const day of ['2026-10-29', '2026-10-28', '2026-09-28', '2026-09-27', '2026-04-30', '2026-05-01', '2026-02-01']) {
        const server = checkIssuedOn(day, TODAY, level);
        const form = validateRx(full({ issuedOn: day }), level, TODAY).issuedOn;
        expect(form === undefined, `${level} ${day}`).toBe(server.ok);
      }
    }
    expect(validateRx(full({ issuedOn: '2026-10-29' }), 'RX', TODAY).issuedOn).toBe('future');
    expect(validateRx(full({ issuedOn: '2026-09-27' }), 'RESTRICTED', TODAY).issuedOn).toBe('expired');
    expect(validateRx(full({ issuedOn: '2026-13-40' }), 'RX', TODAY).issuedOn).toBe('malformed');
  });

  it('shows the bounds: oldest valid day and today', () => {
    expect(issueBounds('RESTRICTED', TODAY)).toEqual({ min: '2026-09-28', max: '2026-10-28' });
    expect(issueBounds('RX', TODAY)).toEqual({ min: '2026-05-01', max: '2026-10-28' });
  });

  it('keeps only the document type and at most the last 4 characters of the number', () => {
    expect(limitIdNote('ID card: 123456789')).toBe('ID card: 1234');
    expect(limitIdNote('Passport - AB12')).toBe('Passport - AB12');
    expect(limitIdNote('ID card')).toBe('ID card');
    expect(limitIdNote('ID card:')).toBe('ID card:');
    for (const note of ['ID card: 1234', 'Passport - AB12', 'ID card']) expect(checkPatientIdNote(limitIdNote(note)).ok).toBe(true);
    expect(validateRx(full({ patientIdNote: 'ID card: 12345' }), 'RX', TODAY).patientIdNote).toBe('idTooLong');
    expect(validateRx(full({ patientIdNote: '12345 678' }), 'RX', TODAY).patientIdNote).toBe('idTooLong');
    expect(validateRx(full({ patientIdNote: '!!' }), 'RX', TODAY).patientIdNote).toBe('idShape');
    expect(validateRx(full({ patientIdNote: '' }), 'RESTRICTED', TODAY)).toEqual({});
  });

  it('refuses a file by type and size in words, before any upload', () => {
    expect(fileProblem({ type: 'image/jpeg', size: 1000 })).toBeNull();
    expect(fileProblem({ type: 'application/pdf', size: 5 * 1024 * 1024 })).toBeNull();
    expect(fileProblem({ type: 'application/pdf', size: 5 * 1024 * 1024 + 1 })).toBe('tooLarge');
    expect(fileProblem({ type: 'image/gif', size: 10 })).toBe('type');
    expect(fileProblem({ type: 'text/html', size: 10 })).toBe('type');
    expect(fileProblem({ type: 'image/png', size: 0 })).toBe('empty');
  });

  it('builds the wire request with trimmed text and no empty optional fields', () => {
    const wire = rxWire(full({ number: ' RX-1 ', prescriberLicense: '', patientName: ' Sara ' }), 'rx-key-12345678');
    expect(wire).toEqual({ clientKey: 'rx-key-12345678', number: 'RX-1', prescriberName: 'Dr Kareem', patientName: 'Sara', patientIdNote: 'ID card: 1234', issuedOn: '2026-10-20' });
  });
});

describe('what a cart needs', () => {
  const line = (productId: string, rxLevel: 'OTC' | 'RX' | 'RESTRICTED', qty: number, baseQty = 1) => ({ productId, name: productId, rxLevel, qty, unitBaseQty: baseQty });
  it('takes the strictest level of the lines', () => {
    expect(rxLevelOfLines([line('a', 'OTC', 1)])).toBeNull();
    expect(rxLevelOfLines([line('a', 'OTC', 1), line('b', 'RX', 1)])).toBe('RX');
    expect(rxLevelOfLines([line('b', 'RX', 1), line('c', 'RESTRICTED', 1)])).toBe('RESTRICTED');
  });

  it('adds the lines of one controlled product in base units against the limit (0 = none)', () => {
    const lines = [line('c', 'RESTRICTED', 2, 10), line('c', 'RESTRICTED', 5, 1), line('d', 'RESTRICTED', 3, 1)];
    expect(controlledLimits(lines, 30)).toEqual([
      { productId: 'c', name: 'c', baseQty: 25, max: 30, over: false },
      { productId: 'd', name: 'd', baseQty: 3, max: 30, over: false },
    ]);
    expect(controlledLimits(lines, 20).find((l) => l.productId === 'c')?.over).toBe(true);
    expect(controlledLimits(lines, 0).every((l) => !l.over)).toBe(true);
    expect(controlledLimits([line('a', 'RX', 99)], 5)).toEqual([]);
  });

  it('says why a sale cannot go on, before it is sent', () => {
    const c = [line('c', 'RESTRICTED', 3)];
    expect(prescriptionGate(c, null, 30, true)).toBe('rxMissing');
    expect(prescriptionGate(c, 'rx1', 30, true)).toBeNull();
    expect(prescriptionGate([line('c', 'RESTRICTED', 31)], 'rx1', 30, true)).toBe('overLimit');
    expect(prescriptionGate(c, 'rx1', 30, false)).toBe('controlledOff');
    // A prescription drug may be sold without a paper on file: the server asks for none.
    expect(prescriptionGate([line('b', 'RX', 1)], null, 30, true)).toBeNull();
    expect(prescriptionGate([line('a', 'OTC', 1)], null, 30, true)).toBeNull();
  });
});

const cust = (over: Partial<CustomerLite> = {}): CustomerLite => ({ id: 'c1', currency: 'IQD', creditLimitMinor: '100000', balanceMinor: '40000', availableMinor: '60000', active: true, ...over });

describe('credit figures from exact strings', () => {
  it('shows balance, limit and remaining; remaining is never below 0', () => {
    expect(creditView(cust(), 25000n)).toMatchObject({ balance: 40000n, limit: 100000n, remaining: 60000n, after: 65000n, remainingAfter: 35000n, over: false });
    expect(creditView(cust({ balanceMinor: '120000', availableMinor: '0' }), 1n)).toMatchObject({ remaining: 0n, over: true, overBy: 20001n });
    expect(creditView(cust({ balanceMinor: '-5000', availableMinor: '105000' }), 0n).remaining).toBe(105000n);
  });

  it('agrees with the server rule on a table, including the exact limit', () => {
    for (const [balance, limit, charge] of [[0n, 100n, 100n], [0n, 100n, 101n], [50n, 100n, 50n], [50n, 100n, 51n], [150n, 100n, 1n], [-20n, 100n, 120n], [-20n, 100n, 121n], [0n, 0n, 1n]] as const) {
      const room = limit - balance > 0n ? limit - balance : 0n;
      const view = creditView(cust({ balanceMinor: String(balance), creditLimitMinor: String(limit), availableMinor: String(room) }), charge);
      const server = creditCheck({ customerCurrency: 'IQD', saleCurrency: 'IQD', active: true, balanceMinor: balance, limitMinor: limit, chargeMinor: charge });
      expect(view.over, `${balance}/${limit}/${charge}`).toBe(!server.ok);
    }
  });

  it('lists who can be charged: same currency, not archived', () => {
    expect(creditablePerson(cust(), 'IQD')).toBeNull();
    expect(creditablePerson(cust({ currency: 'USD' }), 'IQD')).toBe('currency');
    expect(creditablePerson(cust({ active: false }), 'IQD')).toBe('archived');
  });
});

describe('payment split with credit', () => {
  const pay = (over: Partial<PayDraft> = {}): PayDraft => ({ method: 'CASH', tendered: '', reference: '', credit: { customerId: 'c1', amount: '20000' }, ...over });

  it('puts credit on the account and the rest in the chosen method; change only from the rest', () => {
    const p = creditPreview(pay({ tendered: '100000' }), 70000n, 'IQD', cust());
    expect(p).toMatchObject({ creditMinor: 20000n, restMinor: 50000n, amountMinor: 100000n, changeMinor: 50000n, ok: true });
    // Cash tendered is judged against the rest (50 000), not the whole total.
    expect(creditPreview(pay({ tendered: '49000' }), 70000n, 'IQD', cust()).ok).toBe(false);
    expect(creditPreview(pay({ tendered: '' }), 70000n, 'IQD', cust())).toMatchObject({ amountMinor: 50000n, changeMinor: 0n, ok: true });
  });

  it('covers the whole total with credit when asked, and blocks over the limit and over the total', () => {
    expect(creditPreview(pay({ credit: { customerId: 'c1', amount: '50000' } }), 50000n, 'IQD', cust())).toMatchObject({ creditMinor: 50000n, restMinor: 0n, amountMinor: 0n, ok: true });
    expect(creditPreview(pay({ credit: { customerId: 'c1', amount: '60001' } }), 70000n, 'IQD', cust())).toMatchObject({ ok: false, problem: 'overLimit' });
    expect(creditPreview(pay({ credit: { customerId: 'c1', amount: '80000' } }), 70000n, 'IQD', cust({ creditLimitMinor: '999999', availableMinor: '959999' }))).toMatchObject({ ok: false, problem: 'overTotal' });
    expect(creditPreview(pay({ credit: { customerId: 'c1', amount: '' } }), 70000n, 'IQD', cust())).toMatchObject({ ok: false, problem: 'amount' });
    expect(creditPreview(pay({ credit: { customerId: 'c1', amount: '0' } }), 70000n, 'IQD', cust())).toMatchObject({ ok: false, problem: 'amount' });
    expect(creditPreview(pay(), 70000n, 'IQD', null)).toMatchObject({ ok: false, problem: 'customer' });
    expect(creditPreview(pay(), 70000n, 'IQD', cust({ currency: 'USD' }))).toMatchObject({ ok: false, problem: 'currency' });
  });

  it('works in USD minor units (two decimals)', () => {
    const c = cust({ currency: 'USD', creditLimitMinor: '5000', balanceMinor: '1000', availableMinor: '4000' });
    expect(creditPreview(pay({ credit: { customerId: 'c1', amount: '40.00' }, tendered: '10' }), 5000n, 'USD', c)).toMatchObject({ creditMinor: 4000n, restMinor: 1000n, amountMinor: 1000n, ok: true });
    expect(creditPreview(pay({ credit: { customerId: 'c1', amount: '40.01' } }), 5000n, 'USD', c)).toMatchObject({ ok: false, problem: 'overLimit' });
  });

  it('builds one CREDIT payment and one payment for the rest, each with its own key', () => {
    const keys = { paymentKey: 'pay-aaaaaaaa', creditKey: 'pay-bbbbbbbb' };
    expect(creditPaymentsOf(pay({ tendered: '100000', reference: 'r1' }), 20000n, 100000n, keys)).toEqual([
      { method: 'CASH', amountMinor: '100000', reference: 'r1', clientKey: 'pay-aaaaaaaa' },
      { method: 'CREDIT', amountMinor: '20000', reference: '', clientKey: 'pay-bbbbbbbb' },
    ]);
    expect(creditPaymentsOf(pay(), 70000n, 0n, keys)).toEqual([{ method: 'CREDIT', amountMinor: '70000', reference: '', clientKey: 'pay-bbbbbbbb' }]);
  });

  it('a retry sends the same keys; a changed credit, customer or prescription is a different sale', () => {
    const cart = emptyCart();
    const d = pay({ tendered: '50000' });
    const s1 = saleSignature(cart, 'IQD', d, 50000n, null, 'rx1');
    // An empty cart cannot be built: the signature is then null, so build a one-line cart through the sale tests' helper path instead.
    expect(s1).not.toBeNull();
    const a1 = saleAttemptFor(null, s1!, d, 50000n, null, (p) => `${p}-k1`, 'rx1');
    expect(a1.creditKey).toBe('pay-k1');
    expect(saleAttemptFor(a1, s1!, d, 50000n, null, (p) => `${p}-k2`, 'rx1')).toBe(a1);
    const s2 = saleSignature(cart, 'IQD', pay({ credit: { customerId: 'c1', amount: '30000' } }), 50000n, null, 'rx1');
    const s3 = saleSignature(cart, 'IQD', d, 50000n, null, 'rx2');
    const s4 = saleSignature(cart, 'IQD', pay({ credit: { customerId: 'c2', amount: '20000' } }), 50000n, null, 'rx1');
    expect(new Set([s1, s2, s3, s4]).size).toBe(4);
    const plain = saleSignature(cart, 'IQD', { method: 'CASH', tendered: '', reference: '' }, 50000n, null);
    expect(plain).not.toContain('credit');
  });
});

describe('statement and ageing rows', () => {
  it('writes signed amounts from exact strings, never floats', () => {
    expect(signedMinorText('25000', 'IQD')).toBe('+25,000');
    expect(signedMinorText('-1050', 'USD')).toBe('−10.50');
    expect(signedMinorText('0', 'IQD')).toBe('0');
    expect(signedMinorText('9007199254740993', 'IQD')).toBe('+9,007,199,254,740,993');
  });

  it('labels each kind and splits a row into debit and credit columns', () => {
    const base = { id: 'r', day: '2026-10-01', at: '', saleId: null, saleNumber: null, paymentId: null, method: null, corrected: false, balanceMinor: '40000' };
    expect(statementRowOf({ ...base, kind: 'CHARGE', amountMinor: '40000', saleNumber: '20261001-0001', saleId: 's' }, 'IQD')).toMatchObject({ debit: '40,000', credit: '', balance: '40,000', correctable: false });
    expect(statementRowOf({ ...base, kind: 'PAYMENT', amountMinor: '-15000', paymentId: 'p', method: 'CASH', balanceMinor: '25000' }, 'IQD')).toMatchObject({ debit: '', credit: '15,000', balance: '25,000', correctable: true });
    expect(statementRowOf({ ...base, kind: 'PAYMENT', amountMinor: '-15000', paymentId: 'p', method: 'CASH', corrected: true }, 'IQD').correctable).toBe(false);
    expect(statementRowOf({ ...base, kind: 'REVERSAL', amountMinor: '15000', paymentId: 'q' }, 'IQD')).toMatchObject({ debit: '15,000', correctable: false });
    expect(statementRowOf({ ...base, kind: 'REFUND', amountMinor: '-500', saleId: 's' }, 'IQD')).toMatchObject({ credit: '500' });
  });

  it('formats an ageing item by bucket and agrees with the domain buckets', () => {
    const aged = ageingBuckets([{ day: '2026-10-20', amountMinor: 30000n }, { day: '2026-07-01', amountMinor: 20000n }, { day: '2026-08-01', amountMinor: -5000n }], '2026-10-28');
    const row = ageingRowOf({ customerId: 'c', name: 'N', currency: 'IQD', owedMinor: String(aged.owedMinor), buckets: Object.fromEntries(Object.entries(aged.buckets).map(([k, v]) => [k, String(v)])) as never });
    expect(row.owed).toBe('45,000');
    expect(row.cells.map((c) => c.text)).toEqual(['30,000', '0', '0', '15,000']);
    expect(row.cells.map((c) => c.bucket)).toEqual(['0-30', '31-60', '61-90', '90+']);
  });
});
