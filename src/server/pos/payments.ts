import type { AnyDb } from '@/server/data/tenant-db';
import { canTransition } from '@/server/domain/pos/order-state';
import { lineTotal } from '@/server/domain/pos/totals';
import { StudioError } from '@/server/studio/framework/result';
import { refuse } from './errors';
import { effectiveRates, loadOrderForChange, optionsSnapshotSchema, orderTotals, pricedLine, readRates } from './orders';
import type { PosPaymentMethodKey } from '@/server/domain/pos/payment-methods';
import { checkLegs, type LegInput, type TipInput } from './payment-legs';
import { consumeForPayment } from './recipes';
import { lockOpenShiftOf } from './shifts';
import { parseTotalsSnapshot, type TotalsSnapshot } from './totals-snapshot';

export interface PayInput {
  orderId: string;
  expectedVersion: number;
  /** The total on the screen the cashier looked at: if the order changed since, it no longer matches and nothing is taken. */
  expectedTotal: number;
  /** One method for the whole bill (the till's original way); `legs` is used instead when it is given. */
  amountReceived?: number;
  method?: PosPaymentMethodKey;
  reference?: string;
  /** The bill paid with several methods; their amounts add up to the total. */
  legs?: LegInput[];
  /** A tip on top of the bill; it is not part of the total. */
  tip?: TipInput;
  userId: string;
}

/** The original single-method call as one leg: cash is handed over `amountReceived`, a terminal method takes the exact total. */
function singleLeg(input: PayInput, total: number): LegInput {
  const method = input.method ?? 'CASH';
  const received = input.amountReceived ?? total;
  if (method !== 'CASH' && received !== total) {
    throw new StudioError('INVALID', 'Card and wallet payments take the exact total', { amountReceived: 'Card and wallet payments take the exact total' });
  }
  return method === 'CASH' ? { method, amount: total, tendered: received } : { method, amount: total, reference: input.reference };
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
  const settings = await db.posSettings.findFirst({ where: { restaurantId }, select: { enabledPaymentMethods: true } });
  const enabled = (settings?.enabledPaymentMethods ?? []) as PosPaymentMethodKey[];
  const legs = input.legs ?? [singleLeg(input, totals.total)];
  const checked = checkLegs(totals.total, legs, input.tip ?? null, enabled);

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
        promoPerUnit: line.promoDiscountPerUnit,
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
      method: [...checked.legs].sort((x, y) => y.amount - x.amount)[0]!.method,
      amountReceived: checked.amountReceived,
      reference: checked.legs.length === 1 ? checked.legs[0]!.reference : null,
      totalsSnapshot: snapshot,
      tipAmount: checked.tip?.amount ?? 0,
      tipMethod: checked.tip?.method ?? null,
      userId: input.userId,
      shiftId,
    },
    select: { id: true },
  });
  await db.posPaymentLeg.createMany({
    data: checked.legs.map((leg) => ({ restaurantId, paymentId: payment.id, method: leg.method, amount: leg.amount, tendered: leg.tendered, reference: leg.reference })),
  });
  // Stock: a product with a recipe takes its ingredients out in this same transaction (never refused for lack of stock).
  const consumed = await consumeForPayment(db, restaurantId, input.userId, { paymentId: payment.id, lines: live.map((line) => ({ orderLineId: line.id, productId: line.productId, quantity: line.quantity })) });
  return { paymentId: payment.id, method: [...checked.legs].sort((x, y) => y.amount - x.amount)[0]!.method, orderId: order.id, number: order.number, change: checked.change, tip: checked.tip?.amount ?? 0, total: totals.total, from: order.status, shiftId, consumed };
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
