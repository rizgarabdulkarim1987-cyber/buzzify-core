import { baghdadDayOf } from '@/lib/baghdad';
import { normalizePhone } from '@/lib/phone';
import type { AnyDb } from '@/server/data/tenant-db';
import { StudioError } from '@/server/studio/framework/result';
import { refuse } from './errors';
import { bumpOrder, loadOrderForChange, reopened } from './orders';

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
    } else {
      const zone = await db.posDeliveryZone.findFirst({ where: { id: input.zoneId, restaurantId, active: true }, select: { id: true, name: true, fee: true } });
      if (!zone) throw new StudioError('NOT_FOUND');
      if (zone.id !== order.deliveryZoneId) {
        data.deliveryZoneId = zone.id;
        data.deliveryZoneName = zone.name;
        changed.push('zone');
      }
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
