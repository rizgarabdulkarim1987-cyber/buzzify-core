import { z } from 'zod';
import type { AnyDb } from '@/server/data/tenant-db';
import { LOCKED_STATUSES } from '@/server/domain/pos/order-state';
import { tableStatus, type TableStatus } from '@/server/domain/pos/table-status';
import { baghdadDayRange } from '@/lib/baghdad';
import { orderTotals, readRates } from './orders';

export interface BoardView {
  areas: { id: string; name: string; tableCount: number; busyCount: number }[];
  tables: { id: string; number: number; areaId: string; status: TableStatus; seatedAt: Date | null; total: number; orderId: string | null }[];
  busyCount: number;
  todaySales: number;
  ringMinutes: number;
  readAt: Date;
}

const paidTotal = z.object({ total: z.number().int() });

/**
 * The tables board in a fixed number of queries however many tables and orders there are: areas, tables, live orders, their
 * lines, the settings and today's payments. `areaId` narrows the tables, never the counts in the header and the area tabs.
 */
export async function readBoard(db: AnyDb, restaurantId: string, options: { areaId?: string; now?: Date } = {}): Promise<BoardView> {
  const now = options.now ?? new Date();
  const day = baghdadDayRange(now);
  const [areas, tables, orders, settings, payments] = await Promise.all([
    db.posArea.findMany({ where: { restaurantId }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], select: { id: true, name: true } }),
    db.posTable.findMany({ where: { restaurantId }, orderBy: [{ number: 'asc' }, { id: 'asc' }], select: { id: true, number: true, areaId: true } }),
    db.posOrder.findMany({
      where: { restaurantId, status: { notIn: [...LOCKED_STATUSES] }, tableId: { not: null } },
      select: { id: true, tableId: true, status: true, kind: true, seatedAt: true, invoiceDiscountKind: true, invoiceDiscountValue: true, lines: true },
    }),
    readRates(db, restaurantId),
    db.posPayment.findMany({ where: { restaurantId, paidAt: { gte: day.start, lt: day.end } }, select: { totalsSnapshot: true } }),
  ]);
  const byTable = new Map(orders.map((order) => [order.tableId as string, order]));
  const rows = tables.map((table) => {
    const order = byTable.get(table.id) ?? null;
    return {
      id: table.id,
      number: table.number,
      areaId: table.areaId,
      status: tableStatus(order),
      seatedAt: order?.seatedAt ?? null,
      total: order ? orderTotals(order, order.lines, settings).totals.total : 0,
      orderId: order?.id ?? null,
    };
  });
  const tableIds = new Set(tables.map((t) => t.id));
  return {
    areas: areas.map((area) => {
      const inArea = rows.filter((row) => row.areaId === area.id);
      return { id: area.id, name: area.name, tableCount: inArea.length, busyCount: inArea.filter((row) => row.orderId !== null).length };
    }),
    tables: options.areaId ? rows.filter((row) => row.areaId === options.areaId) : rows,
    busyCount: orders.filter((order) => order.tableId !== null && tableIds.has(order.tableId)).length,
    todaySales: payments.reduce((sum, payment) => sum + paidTotal.parse(payment.totalsSnapshot).total, 0),
    ringMinutes: settings.tableRingMinutes,
    readAt: now,
  };
}
