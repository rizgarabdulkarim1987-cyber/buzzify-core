import type { AnyDb } from '@/server/data/tenant-db';
import { groupExpo, type ExpoLine, type ExpoOrder } from '@/server/domain/pos/expo';
import { StudioError } from '@/server/studio/framework/result';
import { KITCHEN_QUEUE_WINDOW_HOURS, QUEUE_LIMIT, readKitchenScope, type KitchenActor } from './kitchen';

/**
 * The pass: every order with food sent to the kitchen, by section, so the person at the pass sees when a whole table is
 * ready. Only for those who see every section (a kitchen member tied to one section has the kitchen screen).
 */
export async function readExpo(db: AnyDb, restaurantId: string, actor: KitchenActor, now = new Date()): Promise<{ orders: ExpoOrder[]; screen: boolean }> {
  const scope = await readKitchenScope(db, restaurantId, actor);
  if (scope.sectionId !== null) throw new StudioError('FORBIDDEN');
  if (!scope.screen) return { orders: [], screen: false };
  const oldest = new Date(now.getTime() - KITCHEN_QUEUE_WINDOW_HOURS * 3_600_000);
  const rows = await db.posOrderLine.findMany({
    where: { restaurantId, sentAt: { not: null, gte: oldest }, cancelledAt: null, order: { status: { notIn: ['REJECTED', 'CANCELLED'] } } },
    orderBy: [{ sentAt: 'asc' }, { id: 'asc' }],
    take: QUEUE_LIMIT * 5,
    select: {
      orderId: true,
      sectionId: true,
      sectionNameSnapshot: true,
      sentAt: true,
      readyAt: true,
      order: { select: { number: true, status: true, kind: true, queueNumber: true, table: { select: { number: true } } } },
    },
  });
  const lines: ExpoLine[] = rows.flatMap((row) =>
    row.sentAt === null
      ? []
      : [
          {
            orderId: row.orderId,
            orderNumber: row.order.number,
            orderStatus: row.order.status,
            kind: row.order.kind,
            queueNumber: row.order.queueNumber,
            tableNumber: row.order.table?.number ?? null,
            sectionId: row.sectionId,
            sectionName: row.sectionNameSnapshot,
            sentAt: row.sentAt,
            ready: row.readyAt !== null,
          },
        ],
  );
  return { orders: groupExpo(lines), screen: true };
}
