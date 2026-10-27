import { z } from 'zod';
import type { ScopedDb } from '@/server/data/tenant-db';
import { canPh } from '@/server/domain/pharmacy/permissions';
import { expectedCash } from '@/server/domain/pharmacy/sale';
import { StudioError } from '@/server/studio/framework/result';
import type { PhActor } from './actor';

/**
 * Reading shifts (phase 3). Who sees which: a holder of `report.view` sees every shift of the branches they work in; a
 * holder of only `shift.use` sees their own; any other role none. A support actor reads none. Nothing here carries a cost
 * or a profit (those arrive with `profit.view`).
 *
 * Cash is read from the signed cash movements of the shift (money in positive, money out negative): the opening float
 * is the shift's own column, so a FLOAT_OPEN movement is the record of it and is not added a second time.
 */

const WHOLE = 'Enter a whole number';
const SOLD = ['COMPLETED', 'RETURNED_PARTIAL', 'RETURNED_FULL'] as const;

export const shiftReportInput = z.object({ shiftId: z.string().min(1).max(64) });

export const SHIFT_STATUSES = ['OPEN', 'CLOSED'] as const;
export const shiftListInput = z.object({
  status: z.enum(SHIFT_STATUSES, 'Choose a status').optional(),
  from: z.coerce.date({ error: 'Enter a valid date' }).optional(),
  to: z.coerce.date({ error: 'Enter a valid date' }).optional(),
  cursor: z.string().min(1).max(64).nullish(),
  pageSize: z.number(WHOLE).int(WHOLE).min(1, 'Use 1 or more').max(100, 'Enter a smaller number').default(50),
});

export interface ShiftView {
  id: string;
  branchId: string;
  userId: string;
  status: 'OPEN' | 'CLOSED';
  currency: 'IQD' | 'USD';
  openedAt: string;
  closedAt: string | null;
  openingFloatMinor: string;
  expectedMinor: string | null;
  countedMinor: string | null;
  varianceMinor: string | null;
  closeReason: string;
  approvedById: string | null;
}

export interface ShiftRow {
  id: string;
  branchId: string;
  userId: string;
  status: 'OPEN' | 'CLOSED';
  currency: 'IQD' | 'USD';
  openedAt: Date;
  closedAt: Date | null;
  openingFloatMinor: bigint;
  expectedMinor: bigint | null;
  countedMinor: bigint | null;
  varianceMinor: bigint | null;
  closeReason: string;
  approvedById: string | null;
}

export const SHIFT_SELECT = {
  id: true,
  branchId: true,
  userId: true,
  status: true,
  currency: true,
  openedAt: true,
  closedAt: true,
  openingFloatMinor: true,
  expectedMinor: true,
  countedMinor: true,
  varianceMinor: true,
  closeReason: true,
  approvedById: true,
} as const;

const str = (v: bigint | null) => (v === null ? null : String(v));

export const shiftView = (row: ShiftRow): ShiftView => ({
  id: row.id,
  branchId: row.branchId,
  userId: row.userId,
  status: row.status,
  currency: row.currency,
  openedAt: row.openedAt.toISOString(),
  closedAt: row.closedAt ? row.closedAt.toISOString() : null,
  openingFloatMinor: String(row.openingFloatMinor),
  expectedMinor: str(row.expectedMinor),
  countedMinor: str(row.countedMinor),
  varianceMinor: str(row.varianceMinor),
  closeReason: row.closeReason,
  approvedById: row.approvedById,
});

/** The cash side of a shift, from its movements. Every figure is a not-negative amount except `expected`, which may be. */
export interface CashTotals {
  expected: bigint;
  tendered: bigint;
  change: bigint;
  refunds: bigint;
  paidIn: bigint;
  paidOut: bigint;
}

/** Reads the shift's cash movements and applies `expectedCash`: CHANGE_OUT, REFUND_CASH and PAID_OUT are stored negative. */
export async function cashTotals(scoped: ScopedDb, shiftId: string, openingFloat: bigint): Promise<CashTotals> {
  const rows = await scoped.phCashMovement.groupBy({ by: ['type'], where: { shiftId }, _sum: { amountMinor: true } });
  const signed = (type: string) => rows.find((r) => r.type === type)?._sum.amountMinor ?? 0n;
  const tendered = signed('SALE_CASH');
  const change = -signed('CHANGE_OUT');
  const refunds = -signed('REFUND_CASH');
  const paidIn = signed('PAID_IN');
  const paidOut = -signed('PAID_OUT');
  const expected = expectedCash({ openingFloat, cashSales: tendered, cashChange: change, cashRefunds: refunds, paidIn, paidOut });
  return { expected, tendered, change, refunds, paidIn, paidOut };
}

export interface MethodTotal {
  method: 'CASH' | 'CARD_MANUAL' | 'TRANSFER_MANUAL';
  count: number;
  amountMinor: string;
}

export interface ShiftTotals {
  openingFloatMinor: string;
  expectedMinor: string;
  cash: { tenderedMinor: string; changeMinor: string; refundsMinor: string; paidInMinor: string; paidOutMinor: string };
  salesCount: number;
  salesTotalMinor: string;
  discountMinor: string;
  roundingMinor: string;
  heldCount: number;
  fullyReturnedCount: number;
  /** What was tendered with each method (cash before change), over the sales of the shift. */
  payments: MethodTotal[];
  returns: { count: number; refundMinor: string; byMethod: MethodTotal[] };
}

const METHODS = ['CARD_MANUAL', 'CASH', 'TRANSFER_MANUAL'] as const;

function byMethod(rows: { method: MethodTotal['method']; amount: bigint }[]): MethodTotal[] {
  return METHODS.flatMap((method) => {
    const mine = rows.filter((r) => r.method === method);
    return mine.length === 0 ? [] : [{ method, count: mine.length, amountMinor: String(mine.reduce((a, r) => a + r.amount, 0n)) }];
  });
}

/** The live figures of a shift: cash, sales by method, returns. Cost and profit are not part of it. */
export async function shiftTotals(scoped: ScopedDb, shift: { id: string; openingFloatMinor: bigint }): Promise<ShiftTotals> {
  const cash = await cashTotals(scoped, shift.id, shift.openingFloatMinor);
  const [sales, payments, returns] = await Promise.all([
    scoped.phSale.groupBy({ by: ['status'], where: { shiftId: shift.id }, _count: { _all: true }, _sum: { totalMinor: true, discountMinor: true, roundingMinor: true } }),
    scoped.phPayment.findMany({ where: { sale: { shiftId: shift.id, status: { in: [...SOLD] } } }, select: { method: true, amountMinor: true } }),
    scoped.phReturn.findMany({ where: { shiftId: shift.id }, select: { refundMethod: true, refundMinor: true } }),
  ]);
  const sold = sales.filter((s) => (SOLD as readonly string[]).includes(s.status));
  const sumOf = (pick: 'totalMinor' | 'discountMinor' | 'roundingMinor') => sold.reduce((a, s) => a + (s._sum[pick] ?? 0n), 0n);
  return {
    openingFloatMinor: String(shift.openingFloatMinor),
    expectedMinor: String(cash.expected),
    cash: { tenderedMinor: String(cash.tendered), changeMinor: String(cash.change), refundsMinor: String(cash.refunds), paidInMinor: String(cash.paidIn), paidOutMinor: String(cash.paidOut) },
    salesCount: sold.reduce((a, s) => a + s._count._all, 0),
    salesTotalMinor: String(sumOf('totalMinor')),
    discountMinor: String(sumOf('discountMinor')),
    roundingMinor: String(sumOf('roundingMinor')),
    heldCount: sales.filter((s) => s.status === 'HELD').reduce((a, s) => a + s._count._all, 0),
    fullyReturnedCount: sales.filter((s) => s.status === 'RETURNED_FULL').reduce((a, s) => a + s._count._all, 0),
    payments: byMethod(payments.map((p) => ({ method: p.method, amount: p.amountMinor }))),
    returns: {
      count: returns.length,
      refundMinor: String(returns.reduce((a, r) => a + r.refundMinor, 0n)),
      byMethod: byMethod(returns.map((r) => ({ method: r.refundMethod, amount: r.refundMinor }))),
    },
  };
}

/** `null` for every shift of the actor's branches (report.view), else the actor's own. Refuses any other role and support. */
function readScope(ph: PhActor): { own: boolean } {
  if (ph.role === null || ph.support !== null) throw new StudioError('FORBIDDEN');
  if (canPh(ph.role, 'report.view')) return { own: false };
  if (!canPh(ph.role, 'shift.use')) throw new StudioError('FORBIDDEN');
  return { own: true };
}

/** The person's open shift in the chosen branch with its live totals; null when there is none (or no branch chosen). */
export async function currentShift(scoped: ScopedDb, ph: PhActor, input: { branchId?: string }): Promise<{ shift: ShiftView; totals: ShiftTotals } | null> {
  if (ph.role === null || ph.support !== null) throw new StudioError('FORBIDDEN');
  if (!input.branchId) return null;
  const row = await scoped.phShift.findFirst({ where: { branchId: input.branchId, userId: ph.userId, status: 'OPEN' }, select: SHIFT_SELECT });
  if (!row) return null;
  const totals = await shiftTotals(scoped, row);
  return { shift: shiftView({ ...row, expectedMinor: cashExpected(totals) }), totals };
}

const cashExpected = (totals: ShiftTotals) => BigInt(totals.expectedMinor);

/** One shift with its totals. NOT_FOUND for a shift the actor may not read. */
export async function shiftReport(scoped: ScopedDb, ph: PhActor, input: { shiftId: string; branchId?: string }): Promise<{ shift: ShiftView; totals: ShiftTotals }> {
  const { own } = readScope(ph);
  const row = await scoped.phShift.findFirst({
    where: { id: input.shiftId, ...(input.branchId ? { branchId: input.branchId } : {}), ...(own ? { userId: ph.userId } : {}) },
    select: SHIFT_SELECT,
  });
  if (!row) throw new StudioError('NOT_FOUND', 'Shift not found');
  const totals = await shiftTotals(scoped, row);
  // An open shift shows its live expected cash; a closed one keeps what was stored at the close.
  return { shift: shiftView(row.status === 'OPEN' ? { ...row, expectedMinor: cashExpected(totals) } : row), totals };
}

/** Newest first, by cursor, within the readable shifts and the actor's branches. */
export async function listShifts(
  scoped: ScopedDb,
  ph: PhActor,
  input: z.infer<typeof shiftListInput> & { branchId?: string },
): Promise<{ items: ShiftView[]; nextCursor: string | null }> {
  const { own } = readScope(ph);
  const rows = await scoped.phShift.findMany({
    where: {
      ...(input.branchId ? { branchId: input.branchId } : {}),
      ...(own ? { userId: ph.userId } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.from || input.to ? { openedAt: { ...(input.from ? { gte: input.from } : {}), ...(input.to ? { lte: input.to } : {}) } } : {}),
    },
    select: SHIFT_SELECT,
    orderBy: [{ openedAt: 'desc' }, { id: 'desc' }],
    take: input.pageSize + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  });
  const more = rows.length > input.pageSize;
  const page = more ? rows.slice(0, input.pageSize) : rows;
  return { items: page.map(shiftView), nextCursor: more ? page[page.length - 1]!.id : null };
}
