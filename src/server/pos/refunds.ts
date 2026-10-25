import type { AnyDb } from '@/server/data/tenant-db';
import { StudioError } from '@/server/studio/framework/result';
import { isUniqueViolation, refuse } from './errors';
import { lockOpenShiftOf } from './shifts';
import { parseTotalsSnapshot } from './totals-snapshot';

export interface ReverseInput {
  orderId: string;
  expectedVersion: number;
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
  if (order.status !== 'PAID') throw refuse('CONFLICT', 'The order is not paid yet');
  const payment = await db.posPayment.findFirst({ where: { orderId: order.id, restaurantId } });
  if (!payment) throw refuse('CONFLICT', 'The order is not paid yet');
  if (await db.posPaymentReversal.findFirst({ where: { paymentId: payment.id, restaurantId }, select: { id: true } })) throw alreadyReversed();

  const shiftId = await lockOpenShiftOf(db, restaurantId, input.userId);
  const { count } = await db.posOrder.updateMany({
    where: { id: order.id, restaurantId, status: 'PAID', version: input.expectedVersion },
    data: { version: { increment: 1 } },
  });
  if (count === 0) throw refuse('CONFLICT', 'The order was changed by someone else. Reload it and try again.');

  const amount = parseTotalsSnapshot(payment.id, payment.totalsSnapshot).total;
  try {
    const reversal = await db.posPaymentReversal.create({
      data: {
        restaurantId,
        paymentId: payment.id,
        orderId: order.id,
        method: payment.method,
        amount,
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
