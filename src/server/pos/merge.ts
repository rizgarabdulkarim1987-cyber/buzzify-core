import type { AnyDb } from '@/server/data/tenant-db';
import { canTransition } from '@/server/domain/pos/order-state';
import { refuse } from './errors';
import { bumpOrder, loadOrderForChange } from './orders';

export interface MergeInput {
  fromOrderId: string;
  intoOrderId: string;
  fromVersion: number;
  intoVersion: number;
}

/**
 * Moves every live line of one dine-in order onto another (two tables that sit together asked for one bill) and cancels the
 * emptied order, freeing its table. Lines keep their kitchen state; their rounds are numbered after the target's own so the
 * kitchen never sees two different rounds with one number. Neither order may have a payment, and both versions must match.
 * The source's own invoice discount goes with it; the target keeps its own.
 */
export async function mergeOrdersIn(db: AnyDb, restaurantId: string, input: MergeInput) {
  if (input.fromOrderId === input.intoOrderId) throw refuse('CONFLICT', 'Choose another order to merge into');
  const source = await loadOrderForChange(db, restaurantId, input.fromOrderId, input.fromVersion);
  const target = await loadOrderForChange(db, restaurantId, input.intoOrderId, input.intoVersion);
  if (source.kind !== 'DINE_IN' || target.kind !== 'DINE_IN') throw refuse('CONFLICT', 'Only a dine-in order sits at a table');
  if (!canTransition(source.status, 'CANCELLED')) throw refuse('CONFLICT', 'The order cannot be cancelled');
  if ((await db.posPayment.count({ where: { orderId: { in: [source.id, target.id] }, restaurantId } })) > 0) throw refuse('CONFLICT', 'This order already has payments');

  // The orders are written in a fixed order, so two people merging the same pair from both ends cannot wait on each other.
  let intoVersion = input.intoVersion;
  for (const order of source.id < target.id ? [source, target] : [target, source]) {
    if (order.id === source.id) await bumpOrder(db, restaurantId, source.id, input.fromVersion, { status: 'CANCELLED' });
    else intoVersion = await bumpOrder(db, restaurantId, target.id, input.intoVersion);
  }

  const last = await db.posOrderLine.aggregate({ where: { orderId: target.id, restaurantId }, _max: { batch: true } });
  const offset = last._max.batch ?? 0;
  if (offset > 0) {
    await db.posOrderLine.updateMany({ where: { orderId: source.id, restaurantId, cancelledAt: null, batch: { not: null } }, data: { batch: { increment: offset } } });
  }
  const moved = await db.posOrderLine.updateMany({ where: { orderId: source.id, restaurantId, cancelledAt: null }, data: { orderId: target.id } });
  return { moved: moved.count, fromNumber: source.number, intoNumber: target.number, fromId: source.id, intoId: target.id, intoVersion };
}
