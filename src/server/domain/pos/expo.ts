/** One sent, uncancelled line as the pass sees it. */
export interface ExpoLine {
  orderId: string;
  orderNumber: number;
  orderStatus: string;
  kind: 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY';
  queueNumber: number | null;
  tableNumber: number | null;
  sectionId: string | null;
  /** The section's name when the line was added; '' for lines with no section. */
  sectionName: string;
  sentAt: Date;
  ready: boolean;
  /** When the line was marked ready; null while it cooks (absent: unknown). */
  readyAt?: Date | null;
  /** A takeaway or delivery's fulfillment step (null for dine-in). */
  fulfillment?: string | null;
}

/** A dine-in table whose food has all been ready this long is taken as served (there is no "served" tap at the pass). */
export const EXPO_SERVED_AFTER_MINUTES = 10;

/** Fulfillment steps where a takeaway or delivery has left the pass. */
const HANDED_OVER = new Set(['OUT', 'DELIVERED', 'PICKED_UP']);

export interface ExpoOrder {
  orderId: string;
  orderNumber: number;
  kind: ExpoLine['kind'];
  queueNumber: number | null;
  tableNumber: number | null;
  sections: { sectionId: string | null; name: string; ready: boolean }[];
  /** Every section has finished: the food can go out together. */
  allReady: boolean;
  /** All ready and already gone out: sinks below the orders still waiting, but stays until paid. */
  served: boolean;
  oldestAt: Date;
}

/** Section names in name order, with "no section" ('') last. */
function compareNames(a: string, b: string): number {
  if (a === b) return 0;
  if (a === '') return 1;
  if (b === '') return -1;
  return a.localeCompare(b);
}

/**
 * Served: every line is ready and the food has gone out. Takeaway and delivery know it from their fulfillment step. Dine-in
 * has no such step, so a table counts as served once it asked for the bill, or once all its food has been ready for
 * EXPO_SERVED_AFTER_MINUTES (the runner has long taken it).
 */
function isServed(group: readonly ExpoLine[], allReady: boolean, now: Date): boolean {
  if (!allReady) return false;
  const first = group[0]!;
  if (first.kind !== 'DINE_IN') return HANDED_OVER.has(first.fulfillment ?? '');
  if (first.orderStatus === 'BILL_REQUESTED') return true;
  const readyTimes = group.map((line) => line.readyAt?.getTime());
  if (readyTimes.some((time) => time === undefined)) return false;
  return now.getTime() - Math.max(...(readyTimes as number[])) >= EXPO_SERVED_AFTER_MINUTES * 60_000;
}

/** Ready to run first, then the orders still cooking, then the ones already served; oldest first within each. */
const band = (order: ExpoOrder): number => (order.served ? 2 : order.allReady ? 0 : 1);

/**
 * One tile per order: its sections, each ready only when all its lines are. Orders ready to run come first, then the ones
 * still cooking, then the ones already served (they stay until paid); oldest first within each. A paid order stays only
 * while some of its food is still being cooked.
 */
export function groupExpo(lines: readonly ExpoLine[], now: Date = new Date()): ExpoOrder[] {
  const byOrder = new Map<string, ExpoLine[]>();
  for (const line of lines) {
    const group = byOrder.get(line.orderId);
    if (group) group.push(line);
    else byOrder.set(line.orderId, [line]);
  }
  const orders: ExpoOrder[] = [];
  for (const group of byOrder.values()) {
    const first = group[0];
    const sections = new Map<string, { sectionId: string | null; name: string; ready: boolean }>();
    for (const line of group) {
      const key = line.sectionId ?? '';
      const section = sections.get(key);
      if (section) section.ready = section.ready && line.ready;
      else sections.set(key, { sectionId: line.sectionId, name: line.sectionName, ready: line.ready });
    }
    const ordered = [...sections.values()].sort((a, b) => compareNames(a.name, b.name));
    const allReady = ordered.every((section) => section.ready);
    if (first.orderStatus === 'PAID' && allReady) continue;
    orders.push({
      orderId: first.orderId,
      orderNumber: first.orderNumber,
      kind: first.kind,
      queueNumber: first.queueNumber,
      tableNumber: first.tableNumber,
      sections: ordered,
      allReady,
      served: isServed(group, allReady, now),
      oldestAt: new Date(Math.min(...group.map((line) => line.sentAt.getTime()))),
    });
  }
  return orders.sort((a, b) => band(a) - band(b) || a.oldestAt.getTime() - b.oldestAt.getTime() || a.orderNumber - b.orderNumber);
}
