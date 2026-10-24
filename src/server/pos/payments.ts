import type { AnyDb } from '@/server/data/tenant-db';
import { canTransition } from '@/server/domain/pos/order-state';
import { lineTotal } from '@/server/domain/pos/totals';
import { StudioError } from '@/server/studio/framework/result';
import { refuse } from './errors';
import { effectiveRates, loadOrderForChange, optionsSnapshotSchema, orderTotals, pricedLine, readRates } from './orders';
import { lockOpenShiftOf } from './shifts';
import { parseTotalsSnapshot, type TotalsSnapshot } from './totals-snapshot';

export interface PayInput {
  orderId: string;
  expectedVersion: number;
  /** The total on the screen the cashier looked at: if the order changed since, it no longer matches and nothing is taken. */
  expectedTotal: number;
  amountReceived: number;
  reference?: string;
  userId: string;
}

/**
 * Takes the cash for an order and marks it PAID in one transaction, freezing the totals on the payment. The person needs an
 * open shift (its row is locked first, so closing it cannot miss this payment). Cash only: a card or wallet is a later phase.
 */
export async function payOrderIn(db: AnyDb, restaurantId: string, input: PayInput) {
  const shiftId = await lockOpenShiftOf(db, restaurantId, input.userId);
  const order = await loadOrderForChange(db, restaurantId, input.orderId, input.expectedVersion);
  if (!canTransition(order.status, 'PAID')) throw refuse('CONFLICT', 'The order cannot be paid');
  const [lines, rates] = await Promise.all([
    db.posOrderLine.findMany({ where: { orderId: order.id, restaurantId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    readRates(db, restaurantId),
  ]);
  const live = lines.filter((line) => line.cancelledAt === null);
  if (live.length === 0) throw refuse('CONFLICT', 'Cannot pay an empty order');
  const { totals, invoiceDiscount } = orderTotals(order, lines, rates);
  if (totals.total !== input.expectedTotal) throw refuse('CONFLICT', 'The total changed. Check the bill and try again.');
  if (input.amountReceived < totals.total) {
    throw new StudioError('INVALID', 'The amount is less than the total', { amountReceived: 'The amount is less than the total' });
  }

  const snapshot: TotalsSnapshot = {
    subtotal: totals.subtotal,
    invoiceDiscount: totals.invoiceDiscount,
    service: totals.service,
    tax: totals.tax,
    deliveryFee: 0,
    total: totals.total,
    invoiceDiscountInput: invoiceDiscount ?? null,
    rates: effectiveRates(order.kind, rates),
    lines: live.map((line) => {
      const priced = pricedLine(line);
      return {
        id: line.id,
        name: line.nameSnapshot,
        quantity: line.quantity,
        unitPrice: line.unitPriceSnapshot,
        options: optionsSnapshotSchema.parse(line.optionsSnapshot),
        discount: priced.discount ?? null,
        lineTotal: lineTotal(priced),
      };
    }),
  };

  const { count } = await db.posOrder.updateMany({
    where: { id: order.id, restaurantId, version: input.expectedVersion },
    data: { status: 'PAID', version: { increment: 1 } },
  });
  if (count === 0) throw refuse('CONFLICT', 'The order was changed by someone else. Reload it and try again.');
  const payment = await db.posPayment.create({
    data: {
      restaurantId,
      orderId: order.id,
      method: 'CASH',
      amountReceived: input.amountReceived,
      reference: input.reference ?? null,
      totalsSnapshot: snapshot,
      userId: input.userId,
      shiftId,
    },
    select: { id: true },
  });
  return { paymentId: payment.id, orderId: order.id, number: order.number, change: input.amountReceived - totals.total, total: totals.total, from: order.status, shiftId };
}

export interface Receipt {
  paymentId: string;
  orderId: string;
  orderNumber: number;
  tableNumber: number | null;
  method: string;
  amountReceived: number;
  change: number;
  reference: string | null;
  paidAt: Date;
  cashierName: string | null;
  snapshot: TotalsSnapshot;
}

/** The receipt of a paid order, from the totals frozen when it was paid. */
export async function readReceipt(db: AnyDb, restaurantId: string, orderId: string): Promise<Receipt | null> {
  const payment = await db.posPayment.findFirst({
    where: { orderId, restaurantId },
    include: { order: { select: { number: true, table: { select: { number: true } } } }, user: { select: { name: true } } },
  });
  if (!payment) return null;
  const snapshot = parseTotalsSnapshot(payment.id, payment.totalsSnapshot);
  return {
    paymentId: payment.id,
    orderId,
    orderNumber: payment.order.number,
    tableNumber: payment.order.table?.number ?? null,
    method: payment.method,
    amountReceived: payment.amountReceived,
    change: payment.amountReceived - snapshot.total,
    reference: payment.reference,
    paidAt: payment.paidAt,
    cashierName: payment.user?.name ?? null,
    snapshot,
  };
}
