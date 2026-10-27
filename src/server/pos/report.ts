import { z } from 'zod';
import type { PosPaymentMethod, PosShift } from '@/generated/prisma/client';
import { baghdadDay, isCalendarDay } from '@/lib/baghdad';
import type { AnyDb } from '@/server/data/tenant-db';
import { expectedCash } from '@/server/domain/pos/cash-drawer';
import { lineDiscount, lineTotal, type PricedLine } from '@/server/domain/pos/totals';
import { StudioError } from '@/server/studio/framework/result';
import { cashIn, legsOf, refundLegs } from './payment-legs';
import { parseTotalsSnapshot, type TotalsSnapshot } from './totals-snapshot';

/** The audit actions that cancel something; the report counts them per shift (a cancel has no shift column). */
const ORDER_CANCEL = 'pos.order.cancel';
const LINE_CANCEL = 'pos.order.line.cancel';

export type MethodSales = Record<PosPaymentMethod, { count: number; total: number }>;

export interface ShiftReport {
  /** X is the live report of an open shift (it changes nothing); Z is a closed shift's report, numbered in `shift.zNumber`. */
  kind: 'X' | 'Z';
  shift: PosShift;
  cashierName: string;
  /** The name of whoever closed it when that is not the shift's own person; null otherwise, and while open. */
  closedByName: string | null;
  salesByMethod: MethodSales;
  /** Sum of the totals (totalsSnapshot.total) of the shift's payments: the methods add up to it. */
  grossSales: number;
  /** Tips left on top of the bills, outside grossSales. */
  tipsTotal: number;
  /** The invoice discounts plus the line discounts of the orders paid in the shift, from their snapshots. */
  discountsTotal: number;
  /** The delivery fees inside grossSales, from the snapshots (a fee is charged on top of the food, not a sale of it). */
  deliveryFeesTotal: number;
  /** Reversals recorded in the shift, by method (count and IQD). A refund does not change grossSales. */
  refundsByMethod: MethodSales;
  refundsTotal: number;
  /** grossSales minus refundsTotal (negative when the shift refunded other shifts' sales). */
  netSales: number;
  /** Whole orders the shift's person cancelled between the opening and the close (or now, while open). */
  cancelledOrders: number;
  /** Lines the shift's person cancelled in the same window. */
  cancelledLines: number;
  /** The reasons of those cancellations (orders and lines), trimmed, most frequent first. A blank reason is ''. */
  cancelReasons: { reason: string; count: number }[];
  /** Cash taken out of the drawer during the shift, oldest first. */
  expenses: { reason: string; amount: number }[];
  /** Live for an open shift; the value frozen at close for a closed one. May be negative. */
  expectedCash: number;
  countedCash: number | null;
  /** countedCash minus expected cash, frozen at close; null while open. */
  difference: number | null;
}

export interface OutsideShifts {
  cancelledOrders: number;
  cancelledLines: number;
  reasons: { reason: string; count: number }[];
  /** Who cancelled, most cancellations first. */
  byActor: { name: string; orders: number; lines: number }[];
}

export interface DailyReport {
  /** The Baghdad day, 'YYYY-MM-DD'. */
  day: string;
  /** The shifts opened that day (Baghdad time), oldest first, each whole even if it closed after midnight. */
  shifts: ShiftReport[];
  /** The shifts added up; the cancellation counts are the whole day's: the shifts' plus `outsideShifts`. */
  totals: {
    byMethod: MethodSales;
    refundsByMethod: MethodSales;
    refundsTotal: number;
    grossSales: number;
    discountsTotal: number;
    deliveryFeesTotal: number;
    netSales: number;
    cancelledOrders: number;
    cancelledLines: number;
    expensesTotal: number;
    /** Sum of the differences of the closed shifts; open shifts have none yet. */
    differenceTotal: number;
  };
  /**
   * Cancellations made that day by someone with no shift open at that moment (a manager without a drawer, a cashier before
   * opening theirs). Cancelling needs no shift, so they are in no shift's report but are in the day's totals. Null when none.
   */
  outsideShifts: OutsideShifts | null;
}

export const dayField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a day as YYYY-MM-DD')
  .refine(isCalendarDay, 'Not a calendar day');

/** The reason stored in a cancel's audit changes. History is never rejected: anything else counts as no reason. */
const cancelChanges = z.object({ reason: z.object({ after: z.string() }) });

type ShiftWithName = PosShift & { user: { name: string } };
interface PaymentRow {
  id: string;
  shiftId: string | null;
  method: PosPaymentMethod;
  amountReceived: number;
  reference: string | null;
  tipAmount: number;
  tipMethod: PosPaymentMethod | null;
  totalsSnapshot: unknown;
  legs: { method: PosPaymentMethod; amount: number; tendered: number | null; reference: string | null }[];
}
interface ReversalRow {
  shiftId: string | null;
  method: PosPaymentMethod;
  amount: number;
  cashPart: number;
  payment: { legs: { method: PosPaymentMethod; amount: number }[] } | null;
}
interface ExpenseRow {
  shiftId: string;
  amount: number;
  reason: string;
}
interface CancelRow {
  actorId: string | null;
  action: string;
  changes: unknown;
  occurredAt: Date;
}

const noSales = (): MethodSales => ({ CASH: { count: 0, total: 0 }, ZAINCASH: { count: 0, total: 0 }, FIB: { count: 0, total: 0 }, QICARD: { count: 0, total: 0 } });

function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = map.get(k);
    if (list) list.push(row);
    else map.set(k, [row]);
  }
  return map;
}

/**
 * The invoice discount plus each line's discount amount, in IQD. The line amount is the money domain's own rule applied to the
 * snapshot's price, options, quantity and discount, checked against the lineTotal stored with it: a mismatch is corrupt data.
 */
function snapshotDiscounts(paymentId: string, snapshot: TotalsSnapshot): number {
  let sum = snapshot.invoiceDiscount;
  for (const line of snapshot.lines) {
    const priced: PricedLine = {
      unitPrice: line.unitPrice,
      optionsTotal: line.options.reduce((s, o) => s + o.priceDelta, 0),
      quantity: line.quantity,
      promoPerUnit: line.promoPerUnit,
      discount: line.discount ?? undefined,
    };
    if (lineTotal(priced) !== line.lineTotal) throw new Error(`The stored totals of payment ${paymentId} are corrupt: line ${line.id} does not add up`);
    sum += lineDiscount(priced);
  }
  return sum;
}

/** Adds the payments up by method, with the discounts they carry. */
export function sales(payments: readonly PaymentRow[]) {
  const byMethod = noSales();
  const cashTotals: number[] = [];
  let grossSales = 0;
  let discountsTotal = 0;
  let deliveryFeesTotal = 0;
  let tipsTotal = 0;
  for (const p of payments) {
    const snapshot = parseTotalsSnapshot(p.id, p.totalsSnapshot);
    for (const leg of legsOf(p, snapshot.total)) {
      byMethod[leg.method].count += 1;
      byMethod[leg.method].total += leg.amount;
    }
    grossSales += snapshot.total;
    discountsTotal += snapshotDiscounts(p.id, snapshot);
    deliveryFeesTotal += snapshot.deliveryFee;
    tipsTotal += p.tipAmount;
    const cash = cashIn(p, snapshot.total);
    if (cash > 0) cashTotals.push(cash);
  }
  return { byMethod, grossSales, discountsTotal, deliveryFeesTotal, cashTotals, tipsTotal };
}

/** A cancel belongs to a shift when its person made it between the opening and the close (or now, while open). */
const inShiftWindow = (c: CancelRow, shift: Pick<PosShift, 'userId' | 'openedAt' | 'closedAt'>, now: Date): boolean =>
  c.actorId === shift.userId && c.occurredAt >= shift.openedAt && c.occurredAt <= (shift.closedAt ?? now);

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The cancels' reasons from their audit changes, trimmed, most frequent first. */
function reasonCounts(cancels: readonly CancelRow[]): { reason: string; count: number }[] {
  const reasons = new Map<string, number>();
  for (const c of cancels) {
    const parsed = cancelChanges.safeParse(c.changes);
    const reason = parsed.success ? parsed.data.reason.after.trim() : '';
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }
  return [...reasons].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count || compareText(a.reason, b.reason));
}

/**
 * The day's cancels that fall in no shift's window, with who made them. `shifts` are all the shifts that overlap the day,
 * including one opened the day before, so a cancel already counted by some shift is never counted again here.
 */
async function outsideShiftsOf(db: AnyDb, dayCancels: readonly CancelRow[], shifts: readonly PosShift[], now: Date): Promise<OutsideShifts | null> {
  const outside = dayCancels.filter((c) => !shifts.some((s) => inShiftWindow(c, s, now)));
  if (outside.length === 0) return null;
  const ids = [...new Set(outside.map((c) => c.actorId).filter((id): id is string => id !== null))];
  const users = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const names = new Map(users.map((u) => [u.id, u.name]));
  const byActor = [...groupBy(outside, (c) => c.actorId ?? '')]
    .map(([id, rows]) => ({ name: names.get(id) ?? '', orders: rows.filter((c) => c.action === ORDER_CANCEL).length, lines: rows.filter((c) => c.action === LINE_CANCEL).length }))
    .sort((a, b) => b.orders + b.lines - (a.orders + a.lines) || compareText(a.name, b.name));
  return {
    cancelledOrders: outside.filter((c) => c.action === ORDER_CANCEL).length,
    cancelledLines: outside.filter((c) => c.action === LINE_CANCEL).length,
    reasons: reasonCounts(outside),
    byActor,
  };
}

function shiftReport(row: ShiftWithName, payments: readonly PaymentRow[], reversals: readonly ReversalRow[], expenses: readonly ExpenseRow[], cancels: readonly CancelRow[], now: Date, closedByName: string | null): ShiftReport {
  const { user, ...shift } = row;
  const { byMethod, grossSales, discountsTotal, deliveryFeesTotal, cashTotals, tipsTotal } = sales(payments);
  const refundsByMethod = noSales();
  for (const r of reversals) {
    for (const given of refundLegs(r)) {
      refundsByMethod[given.method].count += 1;
      refundsByMethod[given.method].total += given.amount;
    }
  }
  const refundsTotal = reversals.reduce((s, r) => s + r.amount, 0);
  const own = cancels.filter((c) => inShiftWindow(c, shift, now));
  return {
    kind: shift.closedAt ? 'Z' : 'X',
    shift,
    cashierName: user.name,
    closedByName,
    salesByMethod: byMethod,
    grossSales,
    tipsTotal,
    discountsTotal,
    deliveryFeesTotal,
    refundsByMethod,
    refundsTotal,
    netSales: grossSales - refundsTotal,
    cancelledOrders: own.filter((c) => c.action === ORDER_CANCEL).length,
    cancelledLines: own.filter((c) => c.action === LINE_CANCEL).length,
    cancelReasons: reasonCounts(own),
    expenses: expenses.map((e) => ({ reason: e.reason, amount: e.amount })),
    expectedCash: shift.expectedCashAtClose ?? expectedCash({ openingFloat: shift.openingFloat, cashSales: cashTotals, expenses: expenses.map((e) => e.amount), cashRefunds: reversals.map((r) => r.cashPart).filter((amount) => amount > 0) }),
    countedCash: shift.countedCash,
    difference: shift.difference,
  };
}

/** The reports of the given shifts in a fixed number of queries: payments, expenses, cancellations and closers' names. */
async function shiftReports(db: AnyDb, restaurantId: string, shifts: readonly ShiftWithName[], now: Date): Promise<ShiftReport[]> {
  if (shifts.length === 0) return [];
  const shiftIds = shifts.map((s) => s.id);
  const from = new Date(Math.min(...shifts.map((s) => s.openedAt.getTime())));
  const to = new Date(Math.max(...shifts.map((s) => (s.closedAt ?? now).getTime())));
  const closers = [...new Set(shifts.flatMap((s) => (s.closedByUserId && s.closedByUserId !== s.userId ? [s.closedByUserId] : [])))];
  const [payments, reversals, expenses, cancels, closerRows] = await Promise.all([
    db.posPayment.findMany({ where: { restaurantId, shiftId: { in: shiftIds } }, orderBy: [{ paidAt: 'asc' }, { id: 'asc' }], select: { id: true, shiftId: true, method: true, amountReceived: true, reference: true, tipAmount: true, tipMethod: true, totalsSnapshot: true, legs: { select: { method: true, amount: true, tendered: true, reference: true } } } }),
    db.posPaymentReversal.findMany({ where: { restaurantId, shiftId: { in: shiftIds } }, select: { shiftId: true, method: true, amount: true, cashPart: true, payment: { select: { legs: { select: { method: true, amount: true } } } } } }),
    db.posCashExpense.findMany({ where: { restaurantId, shiftId: { in: shiftIds } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { shiftId: true, amount: true, reason: true } }),
    db.auditLog.findMany({
      where: { restaurantId, action: { in: [ORDER_CANCEL, LINE_CANCEL] }, actorId: { in: [...new Set(shifts.map((s) => s.userId))] }, occurredAt: { gte: from, lte: to } },
      select: { actorId: true, action: true, changes: true, occurredAt: true },
    }),
    closers.length > 0 ? db.user.findMany({ where: { id: { in: closers } }, select: { id: true, name: true } }) : Promise.resolve([]),
  ]);
  const closerNames = new Map(closerRows.map((u) => [u.id, u.name]));
  const paymentsByShift = groupBy(payments, (p) => p.shiftId ?? '');
  const reversalsByShift = groupBy(reversals, (r) => r.shiftId ?? '');
  const expensesByShift = groupBy(expenses, (e) => e.shiftId);
  const cancelsByUser = groupBy(cancels, (c) => c.actorId ?? '');
  return shifts.map((s) =>
    shiftReport(s, paymentsByShift.get(s.id) ?? [], reversalsByShift.get(s.id) ?? [], expensesByShift.get(s.id) ?? [], cancelsByUser.get(s.userId) ?? [], now, s.closedByUserId && s.closedByUserId !== s.userId ? (closerNames.get(s.closedByUserId) ?? null) : null),
  );
}

/** One shift's sales by method, discounts, cancellations, expenses and cash count. */
export async function readShiftReport(db: AnyDb, restaurantId: string, shiftId: string, now = new Date()): Promise<ShiftReport> {
  const shift = await db.posShift.findFirst({ where: { id: shiftId, restaurantId }, include: { user: { select: { name: true } } } });
  if (!shift) throw new StudioError('NOT_FOUND');
  const [report] = await shiftReports(db, restaurantId, [shift], now);
  return report!;
}

/** The Baghdad day's report: every shift opened that day (whole, even past midnight) and their totals. A quiet day is all zeros. */
export async function readDailyReport(db: AnyDb, restaurantId: string, input: { day: string; now?: Date }): Promise<DailyReport> {
  const now = input.now ?? new Date();
  const { start, end } = baghdadDay(input.day);
  // Every shift whose window touches the day: the day's own (reported) and any still running into it from before (only used
  // to tell which of the day's cancels already belong to a shift).
  const overlapping = await db.posShift.findMany({
    where: { restaurantId, openedAt: { lt: end }, OR: [{ closedAt: null }, { closedAt: { gte: start } }] },
    orderBy: [{ openedAt: 'asc' }, { id: 'asc' }],
    include: { user: { select: { name: true } } },
  });
  const shifts = overlapping.filter((s) => s.openedAt >= start);
  const dayCancels = await db.auditLog.findMany({
    where: { restaurantId, action: { in: [ORDER_CANCEL, LINE_CANCEL] }, occurredAt: { gte: start, lt: end } },
    select: { actorId: true, action: true, changes: true, occurredAt: true },
  });
  const reports = await shiftReports(db, restaurantId, shifts, now);
  const outside = await outsideShiftsOf(db, dayCancels, overlapping, now);

  const byMethod = noSales();
  const refundsByMethod = noSales();
  const totals = { refundsTotal: 0, grossSales: 0, discountsTotal: 0, deliveryFeesTotal: 0, netSales: 0, cancelledOrders: 0, cancelledLines: 0, expensesTotal: 0, differenceTotal: 0 };
  for (const r of reports) {
    for (const method of Object.keys(byMethod) as PosPaymentMethod[]) {
      byMethod[method].count += r.salesByMethod[method].count;
      byMethod[method].total += r.salesByMethod[method].total;
      refundsByMethod[method].count += r.refundsByMethod[method].count;
      refundsByMethod[method].total += r.refundsByMethod[method].total;
    }
    totals.refundsTotal += r.refundsTotal;
    totals.grossSales += r.grossSales;
    totals.discountsTotal += r.discountsTotal;
    totals.deliveryFeesTotal += r.deliveryFeesTotal;
    totals.netSales += r.netSales;
    totals.cancelledOrders += r.cancelledOrders;
    totals.cancelledLines += r.cancelledLines;
    totals.expensesTotal += r.expenses.reduce((s, e) => s + e.amount, 0);
    totals.differenceTotal += r.difference ?? 0;
  }
  totals.cancelledOrders += outside?.cancelledOrders ?? 0;
  totals.cancelledLines += outside?.cancelledLines ?? 0;
  return { day: input.day, shifts: reports, totals: { byMethod, refundsByMethod, ...totals }, outsideShifts: outside };
}
