import { describe, expect, it } from 'vitest';
import {
  closePlan,
  formatUtc,
  paidOutHint,
  parseReturnQty,
  refundMethodChoices,
  returnRequest,
  returnSignature,
  saleFilterParams,
  shiftCashRows,
  type ReturnRow,
} from '@/app/pharmacy/_ui/shifts-logic';
import { keyFor } from '@/app/pharmacy/_ui/sell-logic';

describe('closePlan (variance preview)', () => {
  it('matches, over and short, from the server expected cash', () => {
    expect(closePlan(10_000n, 10_000n, false)).toMatchObject({ varianceMinor: 0n, kind: 'match', needsReason: false });
    expect(closePlan(10_000n, 10_250n, false)).toMatchObject({ varianceMinor: 250n, kind: 'over', needsReason: true });
    expect(closePlan(10_000n, 9_000n, false)).toMatchObject({ varianceMinor: -1_000n, kind: 'short', needsReason: true });
  });
  it('closing someone else shift always needs a reason', () => {
    expect(closePlan(5n, 5n, true)?.needsReason).toBe(true);
  });
  it('is exact beyond 2^53', () => {
    const big = 9_007_199_254_740_993n;
    expect(closePlan(big, big + 1n, false)?.varianceMinor).toBe(1n);
  });
  it('null when counted is not a number', () => {
    expect(closePlan(10n, null, false)).toBeNull();
  });
});

describe('paidOutHint', () => {
  it('warns when the amount is above the expected cash', () => {
    expect(paidOutHint(500n, 400n)).toEqual({ over: true, availableMinor: 400n });
    expect(paidOutHint(400n, 400n).over).toBe(false);
    expect(paidOutHint(null, 400n).over).toBe(false);
  });
});

describe('shiftCashRows', () => {
  it('lists the cash identity in order with signs', () => {
    const rows = shiftCashRows({ openingFloatMinor: '1000', cash: { tenderedMinor: '5000', changeMinor: '200', refundsMinor: '300', paidInMinor: '50', paidOutMinor: '100' }, expectedMinor: '5450' });
    expect(rows.map((r) => [r.key, r.sign, r.minor])).toEqual([
      ['float', '+', 1000n],
      ['sales', '+', 5000n],
      ['change', '-', 200n],
      ['refunds', '-', 300n],
      ['paidIn', '+', 50n],
      ['paidOut', '-', 100n],
    ]);
    // the identity holds
    const sum = rows.reduce((a, r) => a + (r.sign === '+' ? r.minor : -r.minor), 0n);
    expect(sum).toBe(5450n);
  });
});

describe('parseReturnQty', () => {
  it('reads Arabic and Latin digits, empty is 0, clamps nothing but rejects junk', () => {
    expect(parseReturnQty('٣', 10)).toEqual({ qty: 3, error: null });
    expect(parseReturnQty('', 10)).toEqual({ qty: 0, error: null });
    expect(parseReturnQty('11', 10)).toEqual({ qty: 11, error: 'over' });
    expect(parseReturnQty('1.5', 10).error).toBe('invalid');
    expect(parseReturnQty('-1', 10).error).toBe('invalid');
    expect(parseReturnQty('abc', 10).error).toBe('invalid');
  });
});

describe('returnRequest', () => {
  const rows: ReturnRow[] = [
    { saleLineId: 'a', remaining: 5, text: '2' },
    { saleLineId: 'b', remaining: 3, text: '' },
    { saleLineId: 'c', remaining: 4, text: '٤' },
  ];
  it('sends only lines with a quantity, in base units', () => {
    expect(returnRequest(rows)).toEqual({ lines: [{ saleLineId: 'a', baseQty: 2 }, { saleLineId: 'c', baseQty: 4 }], ok: true });
  });
  it('not ok when nothing chosen or a line is over', () => {
    expect(returnRequest([{ saleLineId: 'a', remaining: 1, text: '' }]).ok).toBe(false);
    expect(returnRequest([{ saleLineId: 'a', remaining: 1, text: '2' }]).ok).toBe(false);
  });
});

describe('returnSignature and keys', () => {
  it('same request same key, changed request new key', () => {
    const lines = [{ saleLineId: 'a', baseQty: 2 }];
    const s1 = returnSignature('s', lines, 'broken', 'CASH');
    const k1 = keyFor(null, s1, 'ret', (p) => `${p}-1`);
    expect(keyFor(k1, returnSignature('s', lines, 'broken', 'CASH'), 'ret', (p) => `${p}-2`).key).toBe('ret-1');
    expect(keyFor(k1, returnSignature('s', lines, 'broken!', 'CASH'), 'ret', (p) => `${p}-2`).key).toBe('ret-2');
    expect(keyFor(k1, returnSignature('s', [{ saleLineId: 'a', baseQty: 3 }], 'broken', 'CASH'), 'ret', (p) => `${p}-3`).key).toBe('ret-3');
  });
});

describe('refundMethodChoices', () => {
  it('is only what the sale was paid with, default first', () => {
    expect(refundMethodChoices(['CARD_MANUAL', 'CASH'], 'CARD_MANUAL')).toEqual(['CARD_MANUAL', 'CASH']);
    expect(refundMethodChoices([], 'CASH')).toEqual(['CASH', 'CARD_MANUAL', 'TRANSFER_MANUAL']);
  });
});

describe('saleFilterParams', () => {
  it('keeps only valid filters', () => {
    expect(saleFilterParams({ status: 'COMPLETED', from: '2026-10-01', to: 'x', number: ' S2026 ' })).toEqual({ status: 'COMPLETED', from: '2026-10-01', number: 'S2026' });
    expect(saleFilterParams({ status: 'NOPE' })).toEqual({});
  });
});

describe('formatUtc', () => {
  it('prints Latin digits in UTC', () => {
    expect(formatUtc('2026-10-28T14:03:59.000Z')).toBe('2026-10-28 14:03 UTC');
    expect(formatUtc('nope')).toBe('');
  });
});
