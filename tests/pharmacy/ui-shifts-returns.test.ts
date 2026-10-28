import { describe, expect, it } from 'vitest';
import {
  cashAttempt,
  closeOutcome,
  closePlan,
  formatUtc,
  paidOutHint,
  personLabel,
  parseReturnQty,
  previewCurrent,
  refundMethodChoices,
  returnRequest,
  returnSignature,
  saleFilterParams,
  shiftCashRows,
  type ReturnRow,
} from '@/app/pharmacy/_ui/shifts-logic';
import { keyFor } from '@/app/pharmacy/_ui/sell-logic';
import { NETWORK_FAILURE } from '@/studio/settle';

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

describe('cashAttempt (paid in / paid out key)', () => {
  it('the same type, amount and reason keep the key, even when asked again from a fresh dialog', () => {
    const first = cashAttempt(null, 'in', 5_000n, 'float top-up', (p) => `${p}-1`);
    // The dialog was closed and opened again, the person typed the same things: the attempt is the one that was kept.
    expect(cashAttempt(first, 'in', 5_000n, '  float top-up ', (p) => `${p}-2`).key).toBe('cash-1');
  });
  it('a changed amount, reason or type is a new request with a new key', () => {
    const first = cashAttempt(null, 'in', 5_000n, 'float', (p) => `${p}-1`);
    expect(cashAttempt(first, 'in', 5_001n, 'float', (p) => `${p}-2`).key).toBe('cash-2');
    expect(cashAttempt(first, 'in', 5_000n, 'float 2', (p) => `${p}-3`).key).toBe('cash-3');
    expect(cashAttempt(first, 'out', 5_000n, 'float', (p) => `${p}-4`).key).toBe('cash-4');
  });
  it('with nothing kept (after a success) it makes a new key', () => {
    expect(cashAttempt(null, 'out', 1n, 'abc', (p) => `${p}-9`).key).toBe('cash-9');
  });
});

describe('closeOutcome', () => {
  const unknown = { message: NETWORK_FAILURE };
  it('ALREADY_CLOSED after an unknown outcome means it probably closed by the earlier attempt', () => {
    expect(closeOutcome({ message: 'This shift is already closed', fields: { phCode: 'ALREADY_CLOSED' } }, true)).toBe('closed-probably');
  });
  it('ALREADY_CLOSED with no earlier unknown attempt is an ordinary refusal', () => {
    expect(closeOutcome({ message: 'This shift is already closed', fields: { phCode: 'ALREADY_CLOSED' } }, false)).toBe('refused');
  });
  it('NEEDS_APPROVAL, unknown outcomes and other refusals keep their own handling', () => {
    expect(closeOutcome({ message: 'x', fields: { phCode: 'NEEDS_APPROVAL' } }, true)).toBe('needs-approval');
    expect(closeOutcome(unknown, false)).toBe('unknown');
    expect(closeOutcome({ message: 'Check the amounts', fields: { phCode: 'CASH_NOT_CONSISTENT' } }, true)).toBe('refused');
  });
});

describe('previewCurrent', () => {
  it('is true only when the settled figure is for the quantities now chosen', () => {
    expect(previewCurrent('[{"a":1}]', '[{"a":1}]')).toBe(true);
    expect(previewCurrent('[{"a":1}]', '[{"a":2}]')).toBe(false);
    expect(previewCurrent(null, '[{"a":1}]')).toBe(false);
  });
});

describe('personLabel', () => {
  it('is the name when the server gave one, else the short id', () => {
    expect(personLabel({ u1: 'Sara Ali' }, 'u1')).toBe('Sara Ali');
    expect(personLabel({ u1: 'Sara Ali' }, 'cm9abcdefghijkl')).toBe('cm9abcde');
    expect(personLabel({ u1: '  ' }, 'u1')).toBe('u1');
    expect(personLabel({}, 'abc')).toBe('abc');
  });
});
