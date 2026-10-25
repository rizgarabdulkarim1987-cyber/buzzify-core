import type { AnyDb } from '@/server/data/tenant-db';
import { listLowStock } from '@/server/pos/inventory';
import { readDailyReport, type DailyReport, type ShiftReport } from '@/server/pos/report';

/**
 * Operations worth a second look. A fixed rules engine over the day's report, with no model in it: the same day always gives
 * the same list, every figure is a real total, and the wording the screens use says "worth reviewing", never that anyone
 * did something wrong. Each alert is data (kind, whose shift, an amount and a count); the screens turn it into a sentence.
 */

export const ALERT_THRESHOLDS = {
  /** A counted drawer off by at least this much (IQD), either way. */
  cashDifferenceMin: 5000,
  /** Discounts at least this share (percent) of what the shift would have sold, and at least `discountMin` IQD. */
  discountSharePercent: 15,
  discountMin: 10_000,
  /** Cancelled orders plus lines in one shift. */
  cancelsPerShift: 5,
  /** Cancellations in one shift with no reason written. */
  blankReasonsMin: 2,
  /** Refunds in one shift: this many, or this total (IQD). */
  refundCountMin: 2,
  refundTotalMin: 25_000,
} as const;

export type AlertThresholds = { readonly [K in keyof typeof ALERT_THRESHOLDS]: number };

export type AlertKind = 'cashDifference' | 'highDiscounts' | 'manyCancels' | 'blankCancelReasons' | 'refunds' | 'outsideShiftCancels';

export interface UnusualOperation {
  kind: AlertKind;
  /** The cashier of the shift; null for cancellations made outside any shift. */
  cashierName: string | null;
  /** IQD where the kind is about money (signed for a cash difference), otherwise 0. */
  amount: number;
  /** How many cancellations or refunds; 0 where the kind is about money only. */
  count: number;
}

const refundCount = (shift: ShiftReport) => Object.values(shift.refundsByMethod).reduce((sum, m) => sum + m.count, 0);

function ofShift(shift: ShiftReport, t: AlertThresholds): UnusualOperation[] {
  const found: UnusualOperation[] = [];
  const name = shift.cashierName;
  if (shift.difference !== null && Math.abs(shift.difference) >= t.cashDifferenceMin) found.push({ kind: 'cashDifference', cashierName: name, amount: shift.difference, count: 0 });
  const wouldHaveSold = shift.grossSales + shift.discountsTotal;
  if (shift.discountsTotal >= t.discountMin && wouldHaveSold > 0 && shift.discountsTotal * 100 >= wouldHaveSold * t.discountSharePercent) {
    found.push({ kind: 'highDiscounts', cashierName: name, amount: shift.discountsTotal, count: 0 });
  }
  const cancels = shift.cancelledOrders + shift.cancelledLines;
  if (cancels >= t.cancelsPerShift) found.push({ kind: 'manyCancels', cashierName: name, amount: 0, count: cancels });
  const blank = shift.cancelReasons.filter((r) => r.reason === '').reduce((sum, r) => sum + r.count, 0);
  if (blank >= t.blankReasonsMin) found.push({ kind: 'blankCancelReasons', cashierName: name, amount: 0, count: blank });
  const refunds = refundCount(shift);
  if (refunds >= t.refundCountMin || shift.refundsTotal >= t.refundTotalMin) found.push({ kind: 'refunds', cashierName: name, amount: shift.refundsTotal, count: refunds });
  return found;
}

export function findUnusualOperations(report: DailyReport, thresholds: AlertThresholds = ALERT_THRESHOLDS): UnusualOperation[] {
  const found = report.shifts.flatMap((shift) => ofShift(shift, thresholds));
  const outside = report.outsideShifts;
  if (outside && outside.cancelledOrders + outside.cancelledLines >= thresholds.cancelsPerShift) {
    found.push({ kind: 'outsideShiftCancels', cashierName: null, amount: 0, count: outside.cancelledOrders + outside.cancelledLines });
  }
  return found;
}

export interface AlertsView {
  day: string;
  operations: UnusualOperation[];
  lowStock: { name: string; unit: string; onHand: number; reorderLevel: number; state: string }[];
}

export async function readAlerts(db: AnyDb, restaurantId: string, input: { day: string; now?: Date }): Promise<AlertsView> {
  const report = await readDailyReport(db, restaurantId, input);
  const low = await listLowStock(db, restaurantId, false);
  return {
    day: report.day,
    operations: findUnusualOperations(report),
    lowStock: low.map((item) => ({ name: item.name, unit: item.unit, onHand: item.onHand, reorderLevel: item.reorderLevel, state: item.state })),
  };
}
