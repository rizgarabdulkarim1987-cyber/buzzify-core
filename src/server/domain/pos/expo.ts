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
}

export interface ExpoOrder {
  orderId: string;
  orderNumber: number;
  kind: ExpoLine['kind'];
  queueNumber: number | null;
  tableNumber: number | null;
  sections: { sectionId: string | null; name: string; ready: boolean }[];
  /** Every section has finished: the food can go out together. */
  allReady: boolean;
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
 * One tile per order: its sections, each ready only when all its lines are. Orders ready to run come first, then the oldest.
 * A paid order stays only while some of its food is still being cooked.
 */
export function groupExpo(lines: readonly ExpoLine[]): ExpoOrder[] {
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
      oldestAt: new Date(Math.min(...group.map((line) => line.sentAt.getTime()))),
    });
  }
  return orders.sort((a, b) => Number(b.allReady) - Number(a.allReady) || a.oldestAt.getTime() - b.oldestAt.getTime() || a.orderNumber - b.orderNumber);
}
