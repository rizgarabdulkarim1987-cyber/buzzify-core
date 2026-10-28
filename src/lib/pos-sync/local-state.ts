import { pickName } from '@/lib/pos-view';
import type { OrderStatus } from '@/server/domain/pos/order-state';
import { tillOfferPerUnit } from '@/server/domain/pos/line-offer';
import { roundTo } from '@/server/domain/pos/rounding';
import { computeTotals, type Discount, type Rates, type Totals } from '@/server/domain/pos/totals';
import type { TillCatalog, TillProduct } from '@/server/pos/till-catalog';
import type { QueuedOp } from './queue';
import type { SnapshotLine, SyncSnapshot } from './snapshot';

/**
 * What the cashier sees while offline: the cached snapshot with every operation that has not been applied yet laid on top,
 * in the order they were made. Pure: no storage, no clock. The server stays the authority; this is only a preview of what
 * it will be told, and its totals come from the same rules (`computeTotals`).
 */

export interface LocalOrder {
  /** Stable identity on this device: the opening operation id (`op:<id>`), else the server order (`id:<id>`). */
  key: string;
  /** The server id once it knows the order. */
  serverId: string | null;
  /** The order number the server gave, if it has. */
  number: number | null;
  /** `P-ABCD-3` until the server gives a number, for an order opened on this device. */
  provisional: string | null;
  tableId: string;
  status: OrderStatus;
  /** The `expectedVersion` the next operation on this order must carry. */
  version: number;
  seatedAt: string | null;
  invoiceDiscount: Discount | null;
  /** A part of the bill is already paid (from the snapshot): the offline till cannot take the rest. */
  partPaid?: boolean;
  lines: SnapshotLine[];
  /** Operations of this order that have not been applied. */
  waiting: number;
  attention: boolean;
  paid: { total: number; amountReceived: number; change: number } | null;
  cancelled: boolean;
}

export interface LocalState {
  /** Orders still on the floor (not paid, not cancelled here). */
  live: LocalOrder[];
  /** Every order the queue touched, paid and cancelled ones too, for the receipt and the queue panel. */
  all: LocalOrder[];
  /** table id to the order that holds it. */
  byTable: Map<string, LocalOrder>;
}

/** What is actually taken for a bill: its total rounded to the restaurant's step, and the difference the rounding made. */
export function payableOf(totals: Pick<Totals, 'total'>, rates: { roundingStep?: number }): { total: number; rounding: number } {
  return roundTo(totals.total, rates.roundingStep ?? 0);
}

export function localTotals(order: Pick<LocalOrder, 'lines' | 'invoiceDiscount'>, rates: Rates): Totals {
  return computeTotals(
    order.lines.map((line) => ({
      unitPrice: line.unitPrice,
      optionsTotal: line.options.reduce((sum, option) => sum + option.priceDelta, 0),
      quantity: line.quantity,
      promoPerUnit: line.promoPerUnit,
      discount: line.discount ?? undefined,
      cancelled: line.cancelled,
    })),
    order.invoiceDiscount ?? undefined,
    rates,
  );
}

type AddLine = Extract<QueuedOp['op'], { kind: 'addLine' }>;

/** The line as the server will store it: names in the menu default language, the chosen size first, then the options. */
function newLine(product: TillProduct, op: AddLine, defaultLocale: Parameters<typeof pickName>[2], operationId: string, offers: Pick<TillCatalog, 'offers' | 'timeZone'> | null): SnapshotLine {
  const chosen: SnapshotLine['options'] = [];
  const variant = op.payload.variantId
    ? product.variants.find((v) => v.id === op.payload.variantId)
    : (product.variants.find((v) => v.isDefault) ?? (product.variants.length === 1 ? product.variants[0] : undefined));
  if (variant) chosen.push({ id: variant.id, name: pickName(variant.names, defaultLocale, defaultLocale), priceDelta: variant.priceDelta });
  for (const id of op.payload.optionIds) {
    for (const group of product.groups) {
      const option = group.options.find((o) => o.id === id);
      if (option) chosen.push({ id: option.id, name: pickName(option.names, defaultLocale, defaultLocale), priceDelta: option.priceDelta });
    }
  }
  // Priced at the moment the cashier tapped the dish, as the server prices the replay (`pricingMoment`).
  const regularUnit = product.price + chosen.reduce((sum, option) => sum + option.priceDelta, 0);
  const promoPerUnit = offers ? tillOfferPerUnit(product, regularUnit, offers.offers ?? [], new Date(op.clientAt), offers.timeZone) : 0;
  return {
    id: `op:${operationId}`,
    productId: product.id,
    name: pickName(product.names, defaultLocale, defaultLocale),
    quantity: op.payload.quantity,
    unitPrice: product.price,
    promoPerUnit,
    options: chosen,
    note: op.payload.note,
    discount: null,
    cancelled: false,
    sent: false,
  };
}

/**
 * The key an order is known by now. A screen holds the key it opened the order under (`op:<id>`); once the server applied
 * that operation the order lives under its server id, and the screen must follow it rather than lose it.
 */
export function currentKey(key: string, queue: readonly QueuedOp[]): string {
  if (!key.startsWith('op:')) return key;
  const opened = queue.find((q) => q.operationId === key.slice(3));
  return opened?.state === 'done' && typeof opened.result?.orderId === 'string' ? `id:${opened.result.orderId}` : key;
}

/** The snapshot orders with the queue unapplied operations applied, oldest first. */
export function deriveLocalState(snapshot: SyncSnapshot, queue: readonly QueuedOp[]): LocalState {
  const orders = new Map<string, LocalOrder>();
  for (const order of snapshot.orders) {
    orders.set(`id:${order.id}`, {
      key: `id:${order.id}`,
      serverId: order.id,
      number: order.number,
      provisional: null,
      tableId: order.tableId,
      status: order.status,
      version: order.version,
      seatedAt: order.seatedAt,
      invoiceDiscount: order.invoiceDiscount,
      partPaid: order.partPaid,
      // A snapshot cached by a device before offers reached the till has no `promoPerUnit`: those lines carry none.
      lines: order.lines.map((line) => ({ ...line, promoPerUnit: line.promoPerUnit ?? 0, options: [...line.options] })),
      waiting: 0,
      attention: false,
      paid: null,
      cancelled: false,
    });
  }
  const products = new Map((snapshot.catalog?.products ?? []).map((p) => [p.id, p]));
  const defaultLocale = snapshot.catalog?.defaultLocale ?? 'en';
  // An order whose opening operation the server applied lives in the snapshot under its server id.
  const appliedOpen = new Map<string, string>();
  for (const q of queue) if (q.kind === 'openOrder' && q.state === 'done' && typeof q.result?.orderId === 'string') appliedOpen.set(q.operationId, `id:${q.result.orderId}`);

  for (const q of [...queue].sort((a, b) => a.seq - b.seq)) {
    if (q.state === 'done') continue;
    const op = q.op;
    if (op.kind === 'openOrder') {
      orders.set(`op:${q.operationId}`, {
        key: `op:${q.operationId}`,
        serverId: null,
        number: null,
        provisional: q.provisional,
        tableId: op.payload.tableId,
        status: 'OPEN',
        version: 1,
        seatedAt: null,
        invoiceDiscount: null,
        lines: [],
        waiting: 1,
        attention: q.state === 'attention',
        paid: null,
        cancelled: false,
      });
      continue;
    }
    const ref = op.orderRef;
    const order = orders.get('id' in ref ? `id:${ref.id}` : (appliedOpen.get(ref.op) ?? `op:${ref.op}`));
    if (!order) continue;
    order.waiting += 1;
    if (q.state === 'attention') order.attention = true;
    order.version = op.expectedVersion + 1;
    switch (op.kind) {
      case 'addLine': {
        const product = products.get(op.payload.productId);
        if (product) order.lines.push(newLine(product, op, defaultLocale, q.operationId, snapshot.catalog));
        if (order.status === 'READY' || order.status === 'BILL_REQUESTED') order.status = 'OPEN';
        break;
      }
      case 'sendToKitchen':
        for (const line of order.lines) if (!line.cancelled) line.sent = true;
        break;
      case 'requestBill':
        order.status = 'BILL_REQUESTED';
        break;
      case 'cancelOrder':
        order.status = 'CANCELLED';
        order.cancelled = true;
        break;
      case 'payCash': {
        const total = payableOf(localTotals(order, snapshot.rates), snapshot.rates).total;
        order.status = 'PAID';
        order.paid = { total, amountReceived: op.payload.amountReceived, change: op.payload.amountReceived - total };
        break;
      }
    }
  }
  const all = [...orders.values()];
  const live = all.filter((o) => o.status !== 'PAID' && o.status !== 'CANCELLED' && o.status !== 'REJECTED');
  return { live, all, byTable: new Map(live.map((o) => [o.tableId, o])) };
}
