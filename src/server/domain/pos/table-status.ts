import type { OrderStatus } from './order-state';

export type TableStatus = 'FREE' | 'PENDING_APPROVAL' | 'BUSY' | 'READY' | 'BILL_REQUESTED';

/**
 * The colour state of a table from its live order. A table without a live order that has a customer request waiting
 * (QR ordering) is PENDING_APPROVAL; a table with an order keeps the order's state whatever requests wait.
 */
export function tableStatus(order: { status: OrderStatus } | null, input: { hasPendingRequest?: boolean } = {}): TableStatus {
  const fromOrder = orderTableStatus(order);
  return fromOrder === 'FREE' && input.hasPendingRequest ? 'PENDING_APPROVAL' : fromOrder;
}

function orderTableStatus(order: { status: OrderStatus } | null): TableStatus {
  if (!order) return 'FREE';
  switch (order.status) {
    case 'PENDING_APPROVAL':
      return 'PENDING_APPROVAL';
    case 'OPEN':
      return 'BUSY';
    case 'READY':
      return 'READY';
    case 'BILL_REQUESTED':
      return 'BILL_REQUESTED';
    default:
      return 'FREE';
  }
}

/** Fraction of maxMinutes (the business's table ring setting, always passed) elapsed since seatedAt, clamped to [0, 1]. */
export function ringProgress(seatedAt: Date, now: Date, maxMinutes: number): number {
  const elapsedMinutes = (now.getTime() - seatedAt.getTime()) / 60_000;
  return Math.min(Math.max(elapsedMinutes / maxMinutes, 0), 1);
}
