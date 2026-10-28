import type { AnyDb } from '@/server/data/tenant-db';
import { StudioError } from '@/server/studio/framework/result';
import { isUniqueViolation, refuse } from './errors';
import { legsOf } from './payment-legs';
import { lockOpenShiftOf } from './shifts';
import { parseTotalsSnapshot } from './totals-snapshot';

export interface ReverseInput {
  orderId: string;
  expectedVersion: number;
  /** Which payment (part) of the order to reverse; needed when the bill was split, optional for an order paid at once. */
  paymentId?: string;
  reason: string;
  reference?: string;
  userId: string;
}

const alreadyReversed = (): StudioError => refuse('CONFLICT', 'This payment was already reversed');

/**
 * Reverses a whole payment as a counter-entry: one `PosPaymentReversal` per payment, for the payment's own method and its
 * snapshot total (never retyped). The payment row and the order's status are untouched; the order's version moves by one
 * (compare-and-set on `expectedVersion`, so two people reversing at once cannot both win). The reverser needs an open shift
 * of their own, locked first; a cash reversal comes out of that drawer, a terminal one moves no cash.
 */
export async function reversePaymentIn(db: AnyDb, restaurantId: string, input: ReverseInput) {
  const order = await db.posOrder.findFirst({ where: { id: input.orderId, restaurantId }, select: { id: true, status: true } });
  if (!order) throw new StudioError('NOT_FOUND');
  // Without a named payment the whole paid order is meant, which only has one payment; a part can be reversed at any time.
  if (input.paymentId === undefined && order.status !== 'PAID') throw refuse('CONFLICT', 'The order is not paid yet');
  const payments = await db.posPayment.findMany({ where: { orderId: order.id, restaurantId, ...(input.paymentId === undefined ? {} : { id: input.paymentId }) }, include: { legs: true }, orderBy: { part: 'asc' } });
  if (payments.length > 1) throw refuse('CONFLICT', 'Choose which payment to reverse');
  const payment = payments[0];
  if (!payment) throw refuse('CONFLICT', 'The order is not paid yet');
  if (await db.posPaymentReversal.findFirst({ where: { paymentId: payment.id, restaurantId }, select: { id: true } })) throw alreadyReversed();

  const shiftId = await lockOpenShiftOf(db, restaurantId, input.userId);
  const { count } = await db.posOrder.updateMany({
    where: { id: order.id, restaurantId, ...(input.paymentId === undefined ? { status: 'PAID' as const } : {}), version: input.expectedVersion },
    data: { version: { increment: 1 } },
  });
  if (count === 0) throw refuse('CONFLICT', 'The order was changed by someone else. Reload it and try again.');

  const amount = parseTotalsSnapshot(payment.id, payment.totalsSnapshot).total;
  // Only the cash that stayed in the drawer goes back out of it: the cash legs (and a cash tip is the guest's to keep).
  const cashPart = legsOf(payment, amount)
    .filter((leg) => leg.method === 'CASH')
    .reduce((sum, leg) => sum + leg.amount, 0);
  try {
    const reversal = await db.posPaymentReversal.create({
      data: {
        restaurantId,
        paymentId: payment.id,
        orderId: order.id,
        method: payment.method,
        amount,
        cashPart,
        reference: payment.method === 'CASH' ? null : (input.reference ?? null),
        reason: input.reason,
        userId: input.userId,
        shiftId,
      },
      select: { id: true },
    });
    return { reversalId: reversal.id, paymentId: payment.id, orderId: order.id, method: payment.method, amount, version: input.expectedVersion + 1 };
  } catch (error) {
    if (isUniqueViolation(error)) throw alreadyReversed();
    throw error;
  }
}
