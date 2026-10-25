import { z } from 'zod';
import type { AnyDb } from '@/server/data/tenant-db';
import { cashDifference, expectedCash } from '@/server/domain/pos/cash-drawer';
import { LOCKED_STATUSES } from '@/server/domain/pos/order-state';
import type { PosRole } from '@/server/domain/pos/permissions';
import { StudioError } from '@/server/studio/framework/result';
import { refuse } from './errors';
import { readUnsettledDeliveries } from './off-premise';

/** A person who changes a shift: the cashier whose drawer it is, or a manager or owner on their behalf. */
export interface ShiftActor {
  userId: string;
  role: PosRole;
}

const mayTouch = (actor: ShiftActor, ownerId: string) => actor.userId === ownerId || actor.role === 'OWNER' || actor.role === 'MANAGER';

const cashTotal = z.object({ total: z.number().int() });

export async function openShiftIn(db: AnyDb, restaurantId: string, input: { userId: string; openingFloat: number }): Promise<{ shiftId: string }> {
  const existing = await db.posShift.findFirst({ where: { restaurantId, userId: input.userId, closedAt: null }, select: { id: true } });
  if (existing) throw refuse('CONFLICT', 'You already have an open shift');
  const shift = await db.posShift.create({ data: { restaurantId, userId: input.userId, openingFloat: input.openingFloat }, select: { id: true } });
  return { shiftId: shift.id };
}

/**
 * The person's open shift, row-locked (a no-op update) until the transaction ends, so a payment and the closing of the same
 * shift happen one after the other and the close counts every payment made before it.
 */
export async function lockOpenShiftOf(db: AnyDb, restaurantId: string, userId: string): Promise<string> {
  const shift = await db.posShift.findFirst({ where: { restaurantId, userId, closedAt: null }, select: { id: true } });
  if (!shift) throw refuse('CONFLICT', 'Open a shift before taking payments');
  const { count } = await db.posShift.updateMany({ where: { id: shift.id, restaurantId, closedAt: null }, data: { restaurantId } });
  if (count === 0) throw refuse('CONFLICT', 'Open a shift before taking payments');
  return shift.id;
}

async function ownShift(db: AnyDb, restaurantId: string, shiftId: string, actor: ShiftActor) {
  const shift = await db.posShift.findFirst({ where: { id: shiftId, restaurantId } });
  if (!shift) throw new StudioError('NOT_FOUND');
  if (!mayTouch(actor, shift.userId)) throw new StudioError('FORBIDDEN');
  return shift;
}

export async function addExpenseIn(db: AnyDb, restaurantId: string, input: { shiftId: string; amount: number; reason: string; actor: ShiftActor }) {
  const shift = await ownShift(db, restaurantId, input.shiftId, input.actor);
  if (shift.closedAt) throw refuse('CONFLICT', 'The shift is closed');
  const { count } = await db.posShift.updateMany({ where: { id: shift.id, restaurantId, closedAt: null }, data: { restaurantId } });
  if (count === 0) throw refuse('CONFLICT', 'The shift is closed');
  const expense = await db.posCashExpense.create({
    data: { restaurantId, shiftId: shift.id, userId: input.actor.userId, amount: input.amount, reason: input.reason },
    select: { id: true },
  });
  return { expenseId: expense.id, shiftId: shift.id };
}

/** What the drawer should hold now: the float, plus the totals of the shift's cash payments, minus its expenses. */
async function drawerOf(db: AnyDb, restaurantId: string, shift: { id: string; openingFloat: number }) {
  const [payments, expenses] = await Promise.all([
    db.posPayment.findMany({ where: { restaurantId, shiftId: shift.id, method: 'CASH' }, select: { totalsSnapshot: true } }),
    db.posCashExpense.findMany({ where: { restaurantId, shiftId: shift.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true, amount: true, reason: true, createdAt: true } }),
  ]);
  const cashSales = payments.map((p) => cashTotal.parse(p.totalsSnapshot).total);
  const total = expectedCash({ openingFloat: shift.openingFloat, cashSales, expenses: expenses.map((e) => e.amount), cashRefunds: [] });
  return { cashSales: cashSales.reduce((a, b) => a + b, 0), salesCount: cashSales.length, expenses, expensesTotal: expenses.reduce((a, e) => a + e.amount, 0), expectedCash: total };
}

/** Counts the drawer and closes the shift, freezing what it should have held and the difference. */
export async function closeShiftIn(db: AnyDb, restaurantId: string, input: { shiftId: string; countedCash: number; note: string; actor: ShiftActor }) {
  const shift = await ownShift(db, restaurantId, input.shiftId, input.actor);
  if (shift.closedAt) throw refuse('CONFLICT', 'The shift is closed');
  // Lock the row first so no payment slips in between the sum and the close.
  const { count } = await db.posShift.updateMany({ where: { id: shift.id, restaurantId, closedAt: null }, data: { restaurantId } });
  if (count === 0) throw refuse('CONFLICT', 'The shift is closed');
  const drawer = await drawerOf(db, restaurantId, shift);
  const difference = cashDifference(input.countedCash, drawer.expectedCash);
  await db.posShift.updateMany({
    where: { id: shift.id, restaurantId, closedAt: null },
    data: { closedAt: new Date(), closedByUserId: input.actor.userId, countedCash: input.countedCash, expectedCashAtClose: drawer.expectedCash, difference, note: input.note },
  });
  return { shiftId: shift.id, expected: drawer.expectedCash, counted: input.countedCash, difference, byOther: shift.userId !== input.actor.userId };
}

export interface ShiftSummary {
  shift: {
    id: string;
    userId: string;
    openedAt: Date;
    openingFloat: number;
    closedAt: Date | null;
    countedCash: number | null;
    expectedCashAtClose: number | null;
    difference: number | null;
    note: string;
  };
  cashierName: string;
  closedByName: string | null;
  cashSales: number;
  salesCount: number;
  expenses: { id: string; amount: number; reason: string; createdAt: Date }[];
  expensesTotal: number;
  /** For an open shift what the drawer should hold now; for a closed one what was frozen at close. */
  expectedCash: number;
  openOrdersCount: number;
  /** Delivered orders still unpaid, restaurant-wide: the drivers hold that cash. Counted for the close-shift screen, never blocking it. */
  unsettledDeliveries: { count: number; amount: number };
}

export async function readShiftSummary(db: AnyDb, restaurantId: string, shiftId: string): Promise<ShiftSummary | null> {
  const shift = await db.posShift.findFirst({ where: { id: shiftId, restaurantId }, include: { user: { select: { name: true } } } });
  if (!shift) return null;
  const [drawer, closer, openOrdersCount, unsettledDeliveries] = await Promise.all([
    drawerOf(db, restaurantId, shift),
    shift.closedByUserId ? db.user.findFirst({ where: { id: shift.closedByUserId }, select: { name: true } }) : Promise.resolve(null),
    db.posOrder.count({ where: { restaurantId, status: { notIn: [...LOCKED_STATUSES] }, NOT: { kind: 'DELIVERY', fulfillment: 'DELIVERED' } } }),
    shift.closedAt ? Promise.resolve({ count: 0, amount: 0 }) : readUnsettledDeliveries(db, restaurantId),
  ]);
  return {
    shift: {
      id: shift.id,
      userId: shift.userId,
      openedAt: shift.openedAt,
      openingFloat: shift.openingFloat,
      closedAt: shift.closedAt,
      countedCash: shift.countedCash,
      expectedCashAtClose: shift.expectedCashAtClose,
      difference: shift.difference,
      note: shift.note,
    },
    cashierName: shift.user.name,
    closedByName: closer?.name ?? null,
    cashSales: drawer.cashSales,
    salesCount: drawer.salesCount,
    expenses: drawer.expenses,
    expensesTotal: drawer.expensesTotal,
    expectedCash: shift.closedAt ? (shift.expectedCashAtClose ?? drawer.expectedCash) : drawer.expectedCash,
    openOrdersCount,
    unsettledDeliveries,
  };
}

/** The person's open shift in this restaurant, if any. */
export async function openShiftIdOf(db: AnyDb, restaurantId: string, userId: string): Promise<string | null> {
  const shift = await db.posShift.findFirst({ where: { restaurantId, userId, closedAt: null }, select: { id: true } });
  return shift?.id ?? null;
}

export async function listOpenShifts(db: AnyDb, restaurantId: string) {
  const rows = await db.posShift.findMany({
    where: { restaurantId, closedAt: null },
    orderBy: [{ openedAt: 'asc' }, { id: 'asc' }],
    include: { user: { select: { name: true } } },
  });
  return rows.map((r) => ({ id: r.id, userId: r.userId, cashierName: r.user.name, openedAt: r.openedAt, openingFloat: r.openingFloat }));
}
