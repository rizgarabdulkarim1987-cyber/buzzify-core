import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import { baghdadDayOf } from '@/lib/baghdad';
import { normalizePhone } from '@/lib/phone';
import type { AnyDb } from '@/server/data/tenant-db';
import { StudioError } from '@/server/studio/framework/result';
import { refuse } from './errors';
import { canAdvance, isFinished, type Fulfillment } from '@/server/domain/pos/fulfillment';
import { assertNotHandedOver, bumpOrder, loadOrderForChange, orderTotals, readRates, reopened } from './orders';

/**
 * Takeaway and delivery orders: the same `PosOrder` as a table's, with no table, a queue number that restarts every Baghdad
 * day, and the customer's details. Everything else (lines, kitchen, payment, receipt) is the one path of the till.
 */

export type OffPremiseKind = 'TAKEAWAY' | 'DELIVERY';

export type OpenOffPremiseInput =
  | { kind: 'TAKEAWAY'; customerName: string; customerPhone: string }
  | { kind: 'DELIVERY'; customerName: string; customerPhone: string; address: string; addressNote: string; zoneId: string | null; deliveryFee: number | null };

/** Whether the restaurant takes this kind of order: switched off, nothing can be opened (existing orders can still be finished). */
async function assertTypeOn(db: AnyDb, restaurantId: string, kind: OffPremiseKind): Promise<void> {
  const settings = await db.posSettings.findFirst({ where: { restaurantId }, select: { takeawayEnabled: true, deliveryEnabled: true } });
  const on = kind === 'TAKEAWAY' ? settings?.takeawayEnabled : settings?.deliveryEnabled;
  if (!on) throw refuse('CONFLICT', 'This order type is switched off');
}

/**
 * Opens a takeaway or delivery order. The queue number is the next one of the Baghdad day, shared by both kinds. A lost race
 * for the order number or the queue number is a unique violation: the caller retries the whole call.
 */
export async function openOffPremiseIn(db: AnyDb, restaurantId: string, input: OpenOffPremiseInput, now: Date = new Date()) {
  await assertTypeOn(db, restaurantId, input.kind);
  let zone: { id: string; name: string; fee: number } | null = null;
  if (input.kind === 'DELIVERY' && input.zoneId !== null) {
    zone = await db.posDeliveryZone.findFirst({ where: { id: input.zoneId, restaurantId, active: true }, select: { id: true, name: true, fee: true } });
    if (!zone) throw new StudioError('NOT_FOUND');
  }
  const queueDay = baghdadDayOf(now);
  const [lastNumber, lastQueue] = await Promise.all([
    db.posOrder.aggregate({ where: { restaurantId }, _max: { number: true } }),
    db.posOrder.aggregate({ where: { restaurantId, queueDay }, _max: { queueNumber: true } }),
  ]);
  const delivery = input.kind === 'DELIVERY';
  const deliveryFee = delivery ? (input.deliveryFee ?? zone?.fee ?? 0) : 0;
  const order = await db.posOrder.create({
    data: {
      restaurantId,
      tableId: null,
      kind: input.kind,
      status: 'OPEN',
      seatedAt: now,
      number: (lastNumber._max.number ?? 0) + 1,
      queueDay,
      queueNumber: (lastQueue._max.queueNumber ?? 0) + 1,
      fulfillment: 'NEW',
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      ...(input.kind === 'DELIVERY'
        ? { address: input.address, addressNote: input.addressNote, deliveryZoneId: zone?.id ?? null, deliveryZoneName: zone?.name ?? '', deliveryFee }
        : {}),
    },
  });
  return { orderId: order.id, number: order.number, queueNumber: order.queueNumber as number, version: order.version, deliveryFee, zoneId: zone?.id ?? null };
}

export interface OffPremiseDetailsInput {
  orderId: string;
  expectedVersion: number;
  customerName?: string;
  customerPhone?: string;
  address?: string;
  addressNote?: string;
  /** A zone copies its name and fee; null clears the zone (the fee stays unless `deliveryFee` is given). */
  zoneId?: string | null;
  deliveryFee?: number;
}

/**
 * Changes the customer's details until the order is paid. A delivery keeps a phone and an address. A change of fee takes a
 * requested bill back to OPEN, like a change of lines. Returns the names of the fields that changed and the fee before and after
 * (never the phone or address themselves: they stay out of the audit).
 */
export async function updateOffPremiseDetailsIn(db: AnyDb, restaurantId: string, input: OffPremiseDetailsInput) {
  const order = await loadOrderForChange(db, restaurantId, input.orderId, input.expectedVersion);
  assertNotHandedOver(order);
  if (order.kind !== 'TAKEAWAY' && order.kind !== 'DELIVERY') throw refuse('CONFLICT', 'Only a takeaway or delivery order has these details');
  const delivery = order.kind === 'DELIVERY';
  const data: Record<string, string | number | null> = {};
  const changed: string[] = [];
  const set = (field: 'customerName' | 'customerPhone' | 'address' | 'addressNote', value: string | undefined) => {
    if (value === undefined || value === order[field]) return;
    data[field] = value;
    changed.push(field);
  };
  set('customerName', input.customerName);
  set('customerPhone', input.customerPhone);
  if (delivery) {
    set('address', input.address);
    set('addressNote', input.addressNote);
    if (input.customerPhone !== undefined && input.customerPhone === '') {
      throw new StudioError('INVALID', 'Enter a valid phone number', { customerPhone: 'Enter a valid phone number' });
    }
    if (input.address !== undefined && input.address.trim() === '') throw new StudioError('INVALID', 'Enter an address', { address: 'Enter an address' });
  }
  let fee = order.deliveryFee;
  if (delivery && input.zoneId !== undefined) {
    if (input.zoneId === null) {
      if (order.deliveryZoneId !== null) {
        data.deliveryZoneId = null;
        data.deliveryZoneName = '';
        changed.push('zone');
      }
    } else if (input.zoneId !== order.deliveryZoneId) {
      const zone = await db.posDeliveryZone.findFirst({ where: { id: input.zoneId, restaurantId, active: true }, select: { id: true, name: true, fee: true } });
      if (!zone) throw new StudioError('NOT_FOUND');
      data.deliveryZoneId = zone.id;
      data.deliveryZoneName = zone.name;
      changed.push('zone');
      if (input.deliveryFee === undefined) fee = zone.fee;
    }
  }
  if (delivery && input.deliveryFee !== undefined) fee = input.deliveryFee;
  if (delivery && fee !== order.deliveryFee) {
    data.deliveryFee = fee;
    changed.push('deliveryFee');
  }
  const status = changed.includes('deliveryFee') ? reopened(order.status, ['BILL_REQUESTED']) : order.status;
  if (status !== order.status) data.status = status;
  const version = await bumpOrder(db, restaurantId, order.id, input.expectedVersion, data);
  return { orderId: order.id, version, changed, fee: { before: order.deliveryFee, after: fee }, from: order.status, to: status };
}

export interface RecentCustomer {
  customerName: string;
  address: string;
  addressNote: string;
  zoneId: string | null;
}

/** The latest delivery of this restaurant to this exact phone number, so a returning customer's address is filled in. */
export async function findRecentCustomerIn(db: AnyDb, restaurantId: string, rawPhone: string): Promise<RecentCustomer | null> {
  const phone = normalizePhone(rawPhone);
  if (phone === '') return null;
  const last = await db.posOrder.findFirst({
    where: { restaurantId, kind: 'DELIVERY', customerPhone: phone },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { customerName: true, address: true, addressNote: true, deliveryZoneId: true },
  });
  if (!last) return null;
  const zone = last.deliveryZoneId ? await db.posDeliveryZone.findFirst({ where: { id: last.deliveryZoneId, restaurantId, active: true }, select: { id: true } }) : null;
  return { customerName: last.customerName, address: last.address, addressNote: last.addressNote, zoneId: zone?.id ?? null };
}

// Fulfillment, the driver and the board ---------------------------------------------------------------------------------

const staleOrder = () => refuse('CONFLICT', 'The order was changed by someone else. Reload it and try again.');

/** A takeaway or delivery order that can still move: it exists here, is not cancelled or rejected and is at the expected version. Paid is allowed. */
async function loadMovable(db: AnyDb, restaurantId: string, orderId: string, expected: number, sentence: Parameters<typeof refuse>[1]) {
  const order = await db.posOrder.findFirst({ where: { id: orderId, restaurantId } });
  if (!order) throw new StudioError('NOT_FOUND');
  if (order.kind === 'DINE_IN') throw refuse('CONFLICT', sentence);
  if (order.status === 'CANCELLED' || order.status === 'REJECTED') throw refuse('CONFLICT', 'The order is paid, cancelled or rejected and can no longer change');
  if (order.version !== expected) throw staleOrder();
  return order as typeof order & { kind: OffPremiseKind; fulfillment: Fulfillment };
}

/**
 * Moves the order one step. This is the only change a PAID order accepts (a takeaway paid at the counter, then picked up): a
 * compare-and-set on the version and the current step, so two taps at once leave one winner and one stale conflict.
 */
export async function advanceFulfillmentIn(db: AnyDb, restaurantId: string, input: { orderId: string; expectedVersion: number; to: Fulfillment }) {
  const order = await loadMovable(db, restaurantId, input.orderId, input.expectedVersion, 'Only a takeaway or delivery order has these details');
  if (!canAdvance(order.kind, order.fulfillment, input.to)) throw refuse('CONFLICT', 'That step is not allowed');
  if (input.to === 'PICKED_UP' && order.status !== 'PAID') throw refuse('CONFLICT', 'The order is not paid yet');
  if (input.to === 'OUT' && order.driverId === null) throw refuse('CONFLICT', 'Choose a driver before the order goes out');
  const now = new Date();
  const { count } = await db.posOrder.updateMany({
    where: { id: order.id, restaurantId, version: input.expectedVersion, fulfillment: order.fulfillment, status: { notIn: ['CANCELLED', 'REJECTED'] } },
    data: {
      fulfillment: input.to,
      version: { increment: 1 },
      ...(input.to === 'OUT' ? { outAt: now } : {}),
      ...(input.to === 'READY' && order.fulfillment === 'OUT' ? { outAt: null } : {}),
      ...(isFinished(input.to) ? { doneAt: now } : {}),
    },
  });
  if (count === 0) throw staleOrder();
  return { orderId: order.id, version: input.expectedVersion + 1, from: order.fulfillment, to: input.to };
}

/** Assigns an active driver (or, before it goes out, takes the driver off). The name is copied, so a later rename leaves the order alone. */
export async function assignDriverIn(db: AnyDb, restaurantId: string, input: { orderId: string; expectedVersion: number; driverId: string | null }) {
  const order = await loadMovable(db, restaurantId, input.orderId, input.expectedVersion, 'Only a delivery order has a driver');
  if (order.kind !== 'DELIVERY') throw refuse('CONFLICT', 'Only a delivery order has a driver');
  if (isFinished(order.fulfillment)) throw refuse('CONFLICT', 'That step is not allowed');
  let driver: { id: string; name: string } | null = null;
  if (input.driverId !== null) {
    const found = await db.posDriver.findFirst({ where: { id: input.driverId, restaurantId }, select: { id: true, name: true, active: true } });
    if (!found) throw new StudioError('NOT_FOUND');
    if (!found.active) throw refuse('CONFLICT', 'That driver is not available');
    driver = found;
  } else if (order.fulfillment === 'OUT') {
    throw refuse('CONFLICT', 'Choose a driver before the order goes out');
  }
  const { count } = await db.posOrder.updateMany({
    where: { id: order.id, restaurantId, version: input.expectedVersion, status: { notIn: ['CANCELLED', 'REJECTED'] } },
    data: { driverId: driver?.id ?? null, driverNameSnapshot: driver?.name ?? '', version: { increment: 1 } },
  });
  if (count === 0) throw staleOrder();
  return { orderId: order.id, version: input.expectedVersion + 1, before: order.driverId, after: driver?.id ?? null };
}

export interface OffPremiseCard {
  orderId: string;
  number: number;
  queueNumber: number;
  kind: OffPremiseKind;
  status: string;
  fulfillment: Fulfillment;
  version: number;
  customerName: string;
  customerPhone: string;
  address: string;
  zoneName: string;
  driverId: string | null;
  driverName: string;
  seatedAt: Date;
  total: number;
  paid: boolean;
  /** Delivered and not paid: the driver holds the customer's cash. */
  cashWithDriver: boolean;
}

export interface OffPremiseBoard {
  takeaway: OffPremiseCard[];
  delivery: OffPremiseCard[];
  cashWithDrivers: { driverId: string | null; driverName: string; count: number; amount: number }[];
}

/** Orders shown at most. Anything older than the window drops off the board (cash with a driver never does), so leftovers cannot crowd out new orders. */
export const OFF_PREMISE_LIMIT = 200;
export const OFF_PREMISE_WINDOW_DAYS = 3;

const UNSETTLED_WHERE = { kind: 'DELIVERY', fulfillment: 'DELIVERED', status: { notIn: ['PAID', 'CANCELLED', 'REJECTED'] } } satisfies Prisma.PosOrderWhereInput;
const FINISHED_AND_PAID = { status: 'PAID', fulfillment: { in: ['DELIVERED', 'PICKED_UP'] } } satisfies Prisma.PosOrderWhereInput;
const paidTotal = z.object({ total: z.number().int() });

/** A delivered order that is still unpaid (cash with the driver): the one case where a finished fulfillment keeps showing. */
const isUnsettled = (o: { kind: string; fulfillment: string | null; status: string }): boolean => o.kind === 'DELIVERY' && o.fulfillment === 'DELIVERED' && o.status !== 'PAID';

/** The live takeaway and delivery orders: not cancelled, and not both finished and paid. */
export async function readOffPremiseBoard(db: AnyDb, restaurantId: string, now: Date = new Date()): Promise<OffPremiseBoard> {
  const since = new Date(now.getTime() - OFF_PREMISE_WINDOW_DAYS * 86_400_000);
  const [orders, rates] = await Promise.all([
    db.posOrder.findMany({
      where: {
        restaurantId,
        kind: { in: ['TAKEAWAY', 'DELIVERY'] },
        status: { notIn: ['CANCELLED', 'REJECTED'] },
        NOT: FINISHED_AND_PAID,
        OR: [{ seatedAt: { gte: since } }, UNSETTLED_WHERE],
      },
      orderBy: [{ seatedAt: 'asc' }, { id: 'asc' }],
      take: OFF_PREMISE_LIMIT,
      include: { lines: true, payment: { select: { totalsSnapshot: true } } },
    }),
    readRates(db, restaurantId),
  ]);
  const cards: OffPremiseCard[] = orders.map((o) => ({
    orderId: o.id,
    number: o.number,
    queueNumber: o.queueNumber ?? 0,
    kind: o.kind as OffPremiseKind,
    status: o.status,
    fulfillment: (o.fulfillment ?? 'NEW') as Fulfillment,
    version: o.version,
    customerName: o.customerName,
    customerPhone: o.customerPhone,
    address: o.address,
    zoneName: o.deliveryZoneName,
    driverId: o.driverId,
    driverName: o.driverNameSnapshot,
    seatedAt: o.seatedAt,
    total: o.payment ? paidTotal.parse(o.payment.totalsSnapshot).total : orderTotals(o, o.lines, rates).totals.total,
    paid: o.status === 'PAID',
    cashWithDriver: isUnsettled(o),
  }));
  const unsettled = new Map<string, { driverId: string | null; driverName: string; count: number; amount: number }>();
  for (const card of cards.filter((c) => c.cashWithDriver)) {
    const key = card.driverId ?? '';
    const row = unsettled.get(key) ?? { driverId: card.driverId, driverName: card.driverName, count: 0, amount: 0 };
    row.count += 1;
    row.amount += card.total;
    unsettled.set(key, row);
  }
  return {
    takeaway: cards.filter((c) => c.kind === 'TAKEAWAY'),
    delivery: cards.filter((c) => c.kind === 'DELIVERY'),
    cashWithDrivers: [...unsettled.values()].sort((a, b) => b.amount - a.amount || a.driverName.localeCompare(b.driverName)),
  };
}

/** How many delivered orders are unpaid and how much the drivers hold: counted on the close-shift screen, never blocking it. */
export async function readUnsettledDeliveries(db: AnyDb, restaurantId: string): Promise<{ count: number; amount: number }> {
  const [orders, rates] = await Promise.all([
    db.posOrder.findMany({ where: { restaurantId, ...UNSETTLED_WHERE }, take: 1000, include: { lines: true } }),
    readRates(db, restaurantId),
  ]);
  return { count: orders.length, amount: orders.reduce((sum, o) => sum + orderTotals(o, o.lines, rates).totals.total, 0) };
}

/** Which kinds show their tab: switched on, or still holding live orders that must be finished. */
export async function readOffPremiseFlags(db: AnyDb, restaurantId: string) {
  const [settings, live] = await Promise.all([
    db.posSettings.findFirst({ where: { restaurantId }, select: { takeawayEnabled: true, deliveryEnabled: true } }),
    db.posOrder.findMany({
      where: { restaurantId, kind: { in: ['TAKEAWAY', 'DELIVERY'] }, status: { notIn: ['CANCELLED', 'REJECTED'] }, NOT: FINISHED_AND_PAID },
      distinct: ['kind'],
      select: { kind: true },
    }),
  ]);
  const has = (kind: string) => live.some((o) => o.kind === kind);
  const takeawayOn = settings?.takeawayEnabled === true;
  const deliveryOn = settings?.deliveryEnabled === true;
  return { takeaway: takeawayOn || has('TAKEAWAY'), delivery: deliveryOn || has('DELIVERY'), takeawayOn, deliveryOn };
}
