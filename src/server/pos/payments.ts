import type { AnyDb } from '@/server/data/tenant-db';
import { canTransition } from '@/server/domain/pos/order-state';
import { lineTotal } from '@/server/domain/pos/totals';
import { StudioError } from '@/server/studio/framework/result';
import { refuse } from './errors';
import { effectiveRates, loadOrderForChange, optionsSnapshotSchema, orderTotals, pricedLine, readRates } from './orders';
import type { PosPaymentMethodKey } from '@/server/domain/pos/payment-methods';
import { lockOpenShiftOf } from './shifts';
import { parseTotalsSnapshot, type TotalsSnapshot } from './totals-snapshot';

export interface PayInput {
  orderId: string;
  expectedVersion: number;
  /** The total on the screen the cashier looked at: if the order changed since, it no longer matches and nothing is taken. */
  expectedTotal: number;
  amountReceived: number;
  method: PosPaymentMethodKey;
  reference?: string;
  userId: string;
}

/**
 * Takes the cash for an order and marks it PAID in one transaction, freezing the totals on the payment. The person needs an
 * open shift (its row is locked first, so closing it cannot miss this payment). Cash may give change; a terminal method (ZainCash,
 * FIB, QiCard) takes the exact total, must be switched on, and only records the method and the reference: nothing is verified.
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
  if (input.method !== 'CASH') {
    const settings = await db.posSettings.findFirst({ where: { restaurantId }, select: { enabledPaymentMethods: true } });
    if (!(settings?.enabledPaymentMethods ?? []).includes(input.method)) throw refuse('CONFLICT', 'This payment method is switched off');
    if (input.amountReceived !== totals.total) {
      throw new StudioError('INVALID', 'Card and wallet payments take the exact total', { amountReceived: 'Card and wallet payments take the exact total' });
    }
  } else if (input.amountReceived < totals.total) {
    throw new StudioError('INVALID', 'The amount is less than the total', { amountReceived: 'The amount is less than the total' });
  }

  const snapshot: TotalsSnapshot = {
    subtotal: totals.subtotal,
    invoiceDiscount: totals.invoiceDiscount,
    service: totals.service,
    tax: totals.tax,
    deliveryFee: totals.deliveryFee,
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
      method: input.method,
      amountReceived: input.amountReceived,
      reference: input.reference ?? null,
      totalsSnapshot: snapshot,
      userId: input.userId,
      shiftId,
    },
    select: { id: true },
  });
  return { paymentId: payment.id, method: input.method, orderId: order.id, number: order.number, change: input.amountReceived - totals.total, total: totals.total, from: order.status, shiftId };
}

export interface Receipt {
  paymentId: string;
  orderId: string;
  orderNumber: number;
  tableNumber: number | null;
  kind: 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY';
  /** The day's queue number of a takeaway or delivery; null for a table. */
  queueNumber: number | null;
  customer: { name: string; phone: string; address: string; addressNote: string; zoneName: string; driverName: string } | null;
  method: string;
  amountReceived: number;
  change: number;
  reference: string | null;
  paidAt: Date;
  cashierName: string | null;
  snapshot: TotalsSnapshot;
  /** The order's version now, which a reversal must quote. */
  orderVersion: number;
  /** Set once the payment was reversed: who, when, why, and the terminal reference of the refund. */
  reversal: { at: Date; byName: string; reason: string; reference: string | null; amount: number; method: string } | null;
}

/** The receipt of a paid order, from the totals frozen when it was paid. */
export async function readReceipt(db: AnyDb, restaurantId: string, orderId: string): Promise<Receipt | null> {
  const payment = await db.posPayment.findFirst({
    where: { orderId, restaurantId },
    include: { reversal: { include: { user: { select: { name: true } } } }, order: { select: { version: true, number: true, kind: true, queueNumber: true, customerName: true, customerPhone: true, address: true, addressNote: true, deliveryZoneName: true, driverNameSnapshot: true, table: { select: { number: true } } } }, user: { select: { name: true } } },
  });
  if (!payment) return null;
  const snapshot = parseTotalsSnapshot(payment.id, payment.totalsSnapshot);
  return {
    paymentId: payment.id,
    orderId,
    orderNumber: payment.order.number,
    tableNumber: payment.order.table?.number ?? null,
    kind: payment.order.kind,
    queueNumber: payment.order.queueNumber,
    customer:
      payment.order.kind === 'DINE_IN'
        ? null
        : {
            name: payment.order.customerName,
            phone: payment.order.customerPhone,
            address: payment.order.address,
            addressNote: payment.order.addressNote,
            zoneName: payment.order.deliveryZoneName,
            driverName: payment.order.driverNameSnapshot,
          },
    method: payment.method,
    amountReceived: payment.amountReceived,
    change: payment.amountReceived - snapshot.total,
    reference: payment.reference,
    paidAt: payment.paidAt,
    cashierName: payment.user?.name ?? null,
    snapshot,
    orderVersion: payment.order.version,
    reversal: payment.reversal
      ? { at: payment.reversal.createdAt, byName: payment.reversal.user?.name ?? '', reason: payment.reversal.reason, reference: payment.reversal.reference, amount: payment.reversal.amount, method: payment.reversal.method }
      : null,
  };
}
