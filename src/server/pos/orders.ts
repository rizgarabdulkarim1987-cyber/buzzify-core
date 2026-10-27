import { z } from 'zod';
import type { PosOrder, PosOrderLine, Prisma } from '@/generated/prisma/client';
import type { AnyDb } from '@/server/data/tenant-db';
import { POS_PAYMENT_METHODS, type PosPaymentMethodKey } from '@/server/domain/pos/payment-methods';
import { canTransition, isLocked, LOCKED_STATUSES, type OrderStatus } from '@/server/domain/pos/order-state';
import { computeTotals, lineTotal, type Discount, type PricedLine, type Rates, type Totals } from '@/server/domain/pos/totals';
import { StudioError } from '@/server/studio/framework/result';
import type { DiscountWhy } from './approval';
import { isUniqueViolation, refuse } from './errors';
import { kitchenDone } from './kitchen-state';

/** A chosen variant or option, copied onto the line when it was added. */
export const optionsSnapshotSchema = z.array(z.object({ id: z.string(), name: z.string(), priceDelta: z.number().int() }));
export type OptionSnapshot = z.infer<typeof optionsSnapshotSchema>[number];

export function toDiscount(kind: Discount['kind'] | null, value: number | null): Discount | undefined {
  return kind !== null && value !== null ? { kind, value } : undefined;
}

/** A line as the money rules price it. */
export function pricedLine(line: PosOrderLine): PricedLine {
  return {
    unitPrice: line.unitPriceSnapshot,
    optionsTotal: optionsSnapshotSchema.parse(line.optionsSnapshot).reduce((sum, option) => sum + option.priceDelta, 0),
    quantity: line.quantity,
    promoPerUnit: line.promoDiscountPerUnit,
    discount: toDiscount(line.discountKind, line.discountValue),
    cancelled: line.cancelledAt !== null,
  };
}

/** The service charge is for dine-in only; tax applies to every kind. */
export function effectiveRates(kind: PosOrder['kind'], rates: Rates): Rates {
  return { serviceRatePercent: kind === 'DINE_IN' ? rates.serviceRatePercent : 0, taxRatePercent: rates.taxRatePercent };
}

/** The totals of an order from its lines (cancelled ones included; the money rules leave them out). */
export function orderTotals(
  order: Pick<PosOrder, 'invoiceDiscountKind' | 'invoiceDiscountValue' | 'kind' | 'deliveryFee'>,
  lines: readonly PosOrderLine[],
  rates: Rates,
) {
  const invoiceDiscount = toDiscount(order.invoiceDiscountKind, order.invoiceDiscountValue);
  return { totals: computeTotals(lines.map(pricedLine), invoiceDiscount, effectiveRates(order.kind, rates), order.kind === 'DELIVERY' ? order.deliveryFee : 0), invoiceDiscount };
}

export interface TillRates extends Rates {
  tableRingMinutes: number;
  kitchenPrintEnabled: boolean;
  kitchenScreenEnabled: boolean;
}

/** The restaurant's rates and kitchen switches; the plain defaults when it has never saved settings. */
export async function readRates(db: AnyDb, restaurantId: string): Promise<TillRates> {
  const settings = await db.posSettings.findFirst({
    where: { restaurantId },
    select: { serviceRatePercent: true, taxRatePercent: true, tableRingMinutes: true, kitchenPrintEnabled: true, kitchenScreenEnabled: true },
  });
  return settings ?? { serviceRatePercent: 0, taxRatePercent: 0, tableRingMinutes: 60, kitchenPrintEnabled: false, kitchenScreenEnabled: false };
}

// The order's version guard ---------------------------------------------------------------------------------------------

const stale = (): StudioError => refuse('CONFLICT', 'The order was changed by someone else. Reload it and try again.');
const lockedError = (): StudioError => refuse('CONFLICT', 'The order is paid, cancelled or rejected and can no longer change');

/** A takeaway or delivery that has gone to the customer keeps its lines and money: only paying and cancelling remain. */
export function assertNotHandedOver(order: Pick<PosOrder, 'fulfillment'>): void {
  if (order.fulfillment === 'DELIVERED' || order.fulfillment === 'PICKED_UP') throw refuse('CONFLICT', 'The order was handed over and can no longer change');
}

/** The order, checked for the change: it exists in the restaurant, is not locked and is at the expected version. */
export async function loadOrderForChange(db: AnyDb, restaurantId: string, orderId: string, expected: number): Promise<PosOrder> {
  const order = await db.posOrder.findFirst({ where: { id: orderId, restaurantId } });
  if (!order) throw new StudioError('NOT_FOUND');
  if (isLocked(order.status)) throw lockedError();
  if (order.version !== expected) throw stale();
  return order;
}

/**
 * Bumps the order's version only if it is still at `expected` and not locked, which also row-locks it until the
 * transaction ends: a concurrent writer of the same version waits here, then matches nothing and is refused as stale.
 * Never use it to set PAID outside `payOrderIn`, which writes the payment in the same transaction. Returns the new version.
 */
export async function bumpOrder(
  db: AnyDb,
  restaurantId: string,
  orderId: string,
  expected: number,
  data: Prisma.PosOrderUncheckedUpdateManyInput = {},
): Promise<number> {
  const { count } = await db.posOrder.updateMany({
    where: { id: orderId, restaurantId, version: expected, status: { notIn: [...LOCKED_STATUSES] } },
    data: { ...data, version: { increment: 1 } },
  });
  if (count === 0) {
    const current = await db.posOrder.findFirst({ where: { id: orderId, restaurantId }, select: { status: true } });
    if (!current) throw new StudioError('NOT_FOUND');
    throw isLocked(current.status) ? lockedError() : stale();
  }
  return expected + 1;
}

/** The status after the order's lines change: a bill request (or a ready order, for new lines) goes back to OPEN. */
export function reopened(status: OrderStatus, from: readonly OrderStatus[]): OrderStatus {
  return from.includes(status) && canTransition(status, 'OPEN') ? 'OPEN' : status;
}

/**
 * After a line change that leaves the order OPEN: when the kitchen has finished it the order is READY instead, so the
 * table does not stay amber. Runs after `bumpOrder` and writes at the version just set. Returns the status it ends with.
 */
export async function settleStatus(db: AnyDb, restaurantId: string, orderId: string, status: OrderStatus, version: number): Promise<OrderStatus> {
  if (status !== 'OPEN' || !(await kitchenDone(db, restaurantId, orderId))) return status;
  await db.posOrder.updateMany({ where: { id: orderId, restaurantId, version }, data: { status: 'READY' } });
  return 'READY';
}

// Opening, billing, cancelling and moving ---------------------------------------------------------------------------------

async function assertTableFree(db: AnyDb, restaurantId: string, tableId: string): Promise<void> {
  const open = await db.posOrder.findFirst({ where: { restaurantId, tableId, status: { notIn: [...LOCKED_STATUSES] } }, select: { id: true } });
  if (open) throw refuse('CONFLICT', 'The table already has an open order');
}

/** Opens a dine-in order on a free table. A lost race for the number or the table is a unique violation: retry the call. */
export async function openOrderIn(db: AnyDb, restaurantId: string, tableId: string): Promise<{ orderId: string; number: number; version: number }> {
  const table = await db.posTable.findFirst({ where: { id: tableId, restaurantId }, select: { id: true } });
  if (!table) throw new StudioError('NOT_FOUND');
  await assertTableFree(db, restaurantId, table.id);
  const last = await db.posOrder.aggregate({ where: { restaurantId }, _max: { number: true } });
  const order = await db.posOrder.create({
    data: { restaurantId, tableId: table.id, kind: 'DINE_IN', status: 'OPEN', seatedAt: new Date(), number: (last._max.number ?? 0) + 1 },
  });
  return { orderId: order.id, number: order.number, version: order.version };
}

export async function setInvoiceDiscountIn(
  db: AnyDb,
  restaurantId: string,
  input: { orderId: string; expectedVersion: number; discount: Discount | null; why?: DiscountWhy },
) {
  const order = await loadOrderForChange(db, restaurantId, input.orderId, input.expectedVersion);
  assertNotHandedOver(order);
  // The reason lives with the discount: clearing the discount clears it too.
  const why = input.discount ? input.why : undefined;
  const version = await bumpOrder(db, restaurantId, order.id, input.expectedVersion, {
    invoiceDiscountKind: input.discount?.kind ?? null,
    invoiceDiscountValue: input.discount?.value ?? null,
    invoiceDiscountReason: why?.reason ?? null,
    invoiceDiscountNote: why?.note ?? null,
    invoiceDiscountApprovedByStaffId: why?.approvedByStaffId ?? null,
  });
  return { orderId: order.id, version, before: toDiscount(order.invoiceDiscountKind, order.invoiceDiscountValue) ?? null, after: input.discount };
}

export async function requestBillIn(db: AnyDb, restaurantId: string, input: { orderId: string; expectedVersion: number }) {
  const order = await loadOrderForChange(db, restaurantId, input.orderId, input.expectedVersion);
  if (!canTransition(order.status, 'BILL_REQUESTED')) throw refuse('CONFLICT', 'The bill cannot be requested for this order');
  const version = await bumpOrder(db, restaurantId, order.id, input.expectedVersion, { status: 'BILL_REQUESTED' });
  return { orderId: order.id, version, from: order.status };
}

/**
 * Cancels the whole order, which frees its table. While it still has lines that are not cancelled a reason is required;
 * an order with nothing on it can be cancelled without one.
 */
export async function cancelOrderIn(db: AnyDb, restaurantId: string, input: { orderId: string; expectedVersion: number; reason: string }) {
  const order = await loadOrderForChange(db, restaurantId, input.orderId, input.expectedVersion);
  if (!canTransition(order.status, 'CANCELLED')) throw refuse('CONFLICT', 'The order cannot be cancelled');
  const liveLines = await db.posOrderLine.count({ where: { orderId: order.id, restaurantId, cancelledAt: null } });
  if (liveLines > 0 && input.reason === '') {
    throw new StudioError('INVALID', 'Enter a reason', { reason: 'Enter a reason' });
  }
  const version = await bumpOrder(db, restaurantId, order.id, input.expectedVersion, { status: 'CANCELLED' });
  return { orderId: order.id, version, number: order.number, from: order.status, reason: input.reason, liveLines };
}

export async function moveToTableIn(db: AnyDb, restaurantId: string, input: { orderId: string; expectedVersion: number; tableId: string }) {
  const order = await loadOrderForChange(db, restaurantId, input.orderId, input.expectedVersion);
  if (order.kind !== 'DINE_IN') throw refuse('CONFLICT', 'Only a dine-in order sits at a table');
  const table = await db.posTable.findFirst({ where: { id: input.tableId, restaurantId }, select: { id: true } });
  if (!table) throw new StudioError('NOT_FOUND');
  await assertTableFree(db, restaurantId, table.id);
  let version: number;
  try {
    version = await bumpOrder(db, restaurantId, order.id, input.expectedVersion, { tableId: table.id });
  } catch (error) {
    // A concurrent move or open took the table between the check above and this update: the one-live-order-per-table index.
    if (isUniqueViolation(error)) throw refuse('CONFLICT', 'The table already has an open order');
    throw error;
  }
  return { orderId: order.id, version, from: order.tableId, to: table.id };
}

// Reading an order --------------------------------------------------------------------------------------------------------

export interface OrderLineView {
  id: string;
  productId: string | null;
  name: string;
  quantity: number;
  unitPrice: number;
  options: OptionSnapshot[];
  note: string;
  /** What the menu's offer took off one unit when the line was added, in whole IQD (0: none). */
  offerPerUnit: number;
  discount: Discount | null;
  /** What the line adds to the subtotal (a cancelled line keeps this amount but is not in the total). */
  lineTotal: number;
  cancelled: boolean;
  cancelReason: string | null;
  sent: boolean;
  batch: number | null;
  ready: boolean;
  sectionName: string;
}

export interface OrderView {
  id: string;
  number: number;
  status: OrderStatus;
  version: number;
  tableId: string | null;
  tableNumber: number | null;
  areaName: string | null;
  kind: 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY';
  /** Only for a takeaway or delivery. */
  offPremise: {
    queueNumber: number;
    fulfillment: 'NEW' | 'PREPARING' | 'READY' | 'OUT' | 'DELIVERED' | 'PICKED_UP';
    customerName: string;
    customerPhone: string;
    address: string;
    addressNote: string;
    zoneId: string | null;
    zoneName: string;
    driverId: string | null;
    driverName: string;
  } | null;
  seatedAt: Date;
  invoiceDiscount: Discount | null;
  lines: OrderLineView[];
  totals: Totals;
  rates: Rates;
  kitchen: { print: boolean; screen: boolean };
  paid: { paymentId: string; method: string; amountReceived: number; paidAt: Date } | null;
  /** The ways the till may take payment now; cash is always among them. */
  paymentMethods: PosPaymentMethodKey[];
}

/** The order, all its lines (cancelled ones included, oldest first), its totals and the rates they were computed with. */
export async function readOrderView(db: AnyDb, restaurantId: string, orderId: string): Promise<OrderView | null> {
  const order = await db.posOrder.findFirst({
    where: { id: orderId, restaurantId },
    include: {
      table: { select: { number: true, area: { select: { name: true } } } },
      payment: { select: { id: true, method: true, amountReceived: true, paidAt: true } },
    },
  });
  if (!order) return null;
  const [lines, settings, methodRow] = await Promise.all([
    db.posOrderLine.findMany({ where: { orderId: order.id, restaurantId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    readRates(db, restaurantId),
    db.posSettings.findFirst({ where: { restaurantId }, select: { enabledPaymentMethods: true } }),
  ]);
  const { totals, invoiceDiscount } = orderTotals(order, lines, settings);
  const rates = effectiveRates(order.kind, settings);
  return {
    id: order.id,
    number: order.number,
    status: order.status,
    version: order.version,
    tableId: order.tableId,
    tableNumber: order.table?.number ?? null,
    areaName: order.table?.area.name ?? null,
    kind: order.kind,
    offPremise:
      order.kind === 'DINE_IN'
        ? null
        : {
            queueNumber: order.queueNumber ?? 0,
            fulfillment: order.fulfillment ?? 'NEW',
            customerName: order.customerName,
            customerPhone: order.customerPhone,
            address: order.address,
            addressNote: order.addressNote,
            zoneId: order.deliveryZoneId,
            zoneName: order.deliveryZoneName,
            driverId: order.driverId,
            driverName: order.driverNameSnapshot,
          },
    seatedAt: order.seatedAt,
    invoiceDiscount: invoiceDiscount ?? null,
    lines: lines.map((line) => {
      const priced = pricedLine(line);
      return {
        id: line.id,
        productId: line.productId,
        name: line.nameSnapshot,
        quantity: line.quantity,
        unitPrice: line.unitPriceSnapshot,
        options: optionsSnapshotSchema.parse(line.optionsSnapshot),
        note: line.note,
        offerPerUnit: line.promoDiscountPerUnit,
        discount: priced.discount ?? null,
        lineTotal: lineTotal(priced),
        cancelled: line.cancelledAt !== null,
        cancelReason: line.cancelReason,
        sent: line.sentAt !== null,
        batch: line.batch,
        ready: line.readyAt !== null,
        sectionName: line.sectionNameSnapshot,
      };
    }),
    totals,
    rates,
    kitchen: { print: settings.kitchenPrintEnabled, screen: settings.kitchenScreenEnabled },
    paid: order.payment
      ? { paymentId: order.payment.id, method: order.payment.method, amountReceived: order.payment.amountReceived, paidAt: order.payment.paidAt }
      : null,
    paymentMethods: POS_PAYMENT_METHODS.filter((method) => method === 'CASH' || (methodRow?.enabledPaymentMethods ?? []).includes(method)),
  };
}
