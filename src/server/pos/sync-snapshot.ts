import type { PrismaClient } from '@/generated/prisma/client';
import type { SnapshotOrder, SyncSnapshot } from '@/lib/pos-sync/snapshot';
import { LOCKED_STATUSES } from '@/server/domain/pos/order-state';
import { canPos } from '@/server/domain/pos/permissions';
import type { PosActor } from '@/server/pos/actor';
import { readBoard } from './board';
import { optionsSnapshotSchema, readRates, toDiscount } from './orders';
import { openShiftIdOf } from './shifts';
import { loadTillCatalog } from './till-catalog';

/** The most live orders a snapshot carries: a restaurant has far fewer tables than this. */
const ORDER_LIMIT = 500;

/**
 * The read cache of an offline till, in a fixed number of queries: settings, the floor, the catalog, the live dine-in
 * orders with their lines, and the person's own open shift. Prices are the catalog's and the orders' own snapshots;
 * nothing here is a secret.
 */
export async function readSyncSnapshot(db: PrismaClient, pos: PosActor, now: Date = new Date()): Promise<SyncSnapshot> {
  const restaurantId = pos.restaurantId;
  const [rates, board, catalog, orders, shiftId] = await Promise.all([
    readRates(db, restaurantId),
    readBoard(db, restaurantId, { now }),
    loadTillCatalog(db, restaurantId),
    db.posOrder.findMany({
      where: { restaurantId, kind: 'DINE_IN', tableId: { not: null }, status: { notIn: [...LOCKED_STATUSES, 'PENDING_APPROVAL'] } },
      orderBy: [{ seatedAt: 'asc' }, { id: 'asc' }],
      take: ORDER_LIMIT,
      include: { lines: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
    }),
    openShiftIdOf(db, restaurantId, pos.userId),
  ]);
  const snapshotOrders = orders.map<SnapshotOrder>((order) => ({
    id: order.id,
    number: order.number,
    status: order.status,
    version: order.version,
    tableId: order.tableId as string,
    seatedAt: order.seatedAt.toISOString(),
    invoiceDiscount: toDiscount(order.invoiceDiscountKind, order.invoiceDiscountValue) ?? null,
    lines: order.lines.map((line) => ({
      id: line.id,
      productId: line.productId,
      name: line.nameSnapshot,
      quantity: line.quantity,
      unitPrice: line.unitPriceSnapshot,
      options: optionsSnapshotSchema.parse(line.optionsSnapshot),
      note: line.note,
      discount: toDiscount(line.discountKind, line.discountValue) ?? null,
      cancelled: line.cancelledAt !== null,
      sent: line.sentAt !== null,
    })),
  }));
  return {
    serverTime: now.toISOString(),
    restaurantId,
    user: {
      id: pos.userId,
      name: pos.name,
      locale: pos.locale,
      can: { discount: canPos(pos.role, 'order.discount'), cancel: canPos(pos.role, 'order.cancel'), pay: canPos(pos.role, 'payment.take') },
    },
    rates: { serviceRatePercent: rates.serviceRatePercent, taxRatePercent: rates.taxRatePercent },
    kitchen: { print: rates.kitchenPrintEnabled, screen: rates.kitchenScreenEnabled },
    catalog,
    areas: board.areas.map((area) => ({
      id: area.id,
      name: area.name,
      tables: board.tables.filter((table) => table.areaId === area.id).map((table) => ({ id: table.id, number: table.number })),
    })),
    orders: snapshotOrders,
    openShift: shiftId ? { id: shiftId } : null,
  };
}
