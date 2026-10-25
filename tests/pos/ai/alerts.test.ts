import { describe, expect, it } from 'vitest';
import { findUnusualOperations } from '@/server/ai/alerts';
import type { DailyReport, ShiftReport } from '@/server/pos/report';

const none = { count: 0, total: 0 };
const methods = { CASH: none, ZAINCASH: none, FIB: none, QICARD: none };

function shift(over: Partial<ShiftReport> = {}): ShiftReport {
  return {
    cashierName: 'Sara',
    grossSales: 100_000,
    discountsTotal: 0,
    refundsByMethod: methods,
    refundsTotal: 0,
    cancelledOrders: 0,
    cancelledLines: 0,
    cancelReasons: [],
    difference: 0,
    ...over,
  } as unknown as ShiftReport;
}

const day = (shifts: ShiftReport[], outsideShifts: DailyReport['outsideShifts'] = null) => ({ day: '2026-10-25', shifts, totals: {}, outsideShifts }) as unknown as DailyReport;

describe('findUnusualOperations', () => {
  it('finds nothing on a quiet day', () => {
    expect(findUnusualOperations(day([shift()]))).toEqual([]);
  });

  it('flags a drawer off by the threshold, either way, with the signed amount', () => {
    expect(findUnusualOperations(day([shift({ difference: -5000 })]))).toEqual([{ kind: 'cashDifference', cashierName: 'Sara', amount: -5000, count: 0 }]);
    expect(findUnusualOperations(day([shift({ difference: 4999 })]))).toEqual([]);
    expect(findUnusualOperations(day([shift({ difference: null })]))).toEqual([]);
  });

  it('flags discounts only when both the share and the amount are reached', () => {
    expect(findUnusualOperations(day([shift({ grossSales: 85_000, discountsTotal: 15_000 })]))[0]).toMatchObject({ kind: 'highDiscounts', amount: 15_000 });
    expect(findUnusualOperations(day([shift({ grossSales: 85_000, discountsTotal: 9_000 })]))).toEqual([]);
    expect(findUnusualOperations(day([shift({ grossSales: 500_000, discountsTotal: 20_000 })]))).toEqual([]);
    expect(findUnusualOperations(day([shift({ grossSales: 0, discountsTotal: 0 })]))).toEqual([]);
  });

  it('flags many cancellations and blank reasons separately', () => {
    const found = findUnusualOperations(day([shift({ cancelledOrders: 3, cancelledLines: 2, cancelReasons: [{ reason: '', count: 2 }, { reason: 'wrong table', count: 3 }] })]));
    expect(found.map((f) => f.kind)).toEqual(['manyCancels', 'blankCancelReasons']);
    expect(found[0]).toMatchObject({ count: 5 });
    expect(found[1]).toMatchObject({ count: 2 });
  });

  it('flags refunds by count or by total', () => {
    const two = { ...methods, CASH: { count: 2, total: 2000 } };
    expect(findUnusualOperations(day([shift({ refundsByMethod: two, refundsTotal: 2000 })]))[0]).toMatchObject({ kind: 'refunds', count: 2, amount: 2000 });
    const big = { ...methods, FIB: { count: 1, total: 30_000 } };
    expect(findUnusualOperations(day([shift({ refundsByMethod: big, refundsTotal: 30_000 })]))[0]).toMatchObject({ kind: 'refunds', count: 1 });
    const one = { ...methods, FIB: { count: 1, total: 1000 } };
    expect(findUnusualOperations(day([shift({ refundsByMethod: one, refundsTotal: 1000 })]))).toEqual([]);
  });

  it('flags cancellations made outside any shift without naming anyone', () => {
    const outside = { cancelledOrders: 4, cancelledLines: 1, reasons: [], byActor: [{ name: 'Omar', orders: 4, lines: 1 }] };
    const found = findUnusualOperations(day([], outside));
    expect(found).toEqual([{ kind: 'outsideShiftCancels', cashierName: null, amount: 0, count: 5 }]);
    expect(JSON.stringify(found)).not.toContain('Omar');
  });
});
