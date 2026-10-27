import type { AnyDb } from '@/server/data/tenant-db';

/** The kinds of event an owner watches for: where money or trust can leak. */
export const ACTIVITY_TYPES = ['discount', 'cancel', 'refund', 'difference', 'pin'] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export interface ActivityRow {
  id: string;
  type: ActivityType;
  action: string;
  actorName: string | null;
  entityId: string;
  /** The audit row's `{ field: { before, after } }`, for the page to show what changed. */
  changes: Record<string, { before?: unknown; after?: unknown }>;
  occurredAt: Date;
}

export interface ActivityFilter {
  userId?: string;
  type?: ActivityType;
  before?: Date;
  limit?: number;
}

type Changes = ActivityRow['changes'];

/** Which watched kind an audit row is, or null when it is not one the owner watches. */
function typeOf(action: string, changes: Changes): ActivityType | null {
  switch (action) {
    case 'pos.order.discount.invoice':
      return 'discount';
    case 'pos.order.line.update':
      return changes.discount ? 'discount' : null;
    case 'pos.order.cancel':
    case 'pos.order.line.cancel':
      return 'cancel';
    case 'pos.payment.reverse':
      return 'refund';
    case 'pos.shift.close': {
      const difference = changes.difference?.after;
      return typeof difference === 'number' && difference !== 0 ? 'difference' : null;
    }
    case 'pos.pin.fail':
    case 'pos.approval.ok':
    case 'pos.approval.fail':
      return 'pin';
    default:
      return null;
  }
}

const WATCHED = ['pos.order.discount.invoice', 'pos.order.line.update', 'pos.order.cancel', 'pos.order.line.cancel', 'pos.payment.reverse', 'pos.shift.close', 'pos.pin.fail', 'pos.approval.ok', 'pos.approval.fail'];

const DEFAULT_LIMIT = 50;

/**
 * The restaurant's watched events, newest first. `next` is the time to pass as `before` for the following page, or null at
 * the end. Rows are matched in memory (a line update only counts when it carried a discount), so the audit table is read in
 * batches until the page is full.
 */
export async function listActivityIn(db: AnyDb, restaurantId: string, filter: ActivityFilter): Promise<{ rows: ActivityRow[]; next: Date | null }> {
  const limit = filter.limit ?? DEFAULT_LIMIT;
  const batch = limit * 3;
  const found: (Omit<ActivityRow, 'actorName'> & { actorId: string | null })[] = [];
  let before = filter.before;

  while (found.length <= limit) {
    const page = await db.auditLog.findMany({
      where: {
        restaurantId,
        action: { in: WATCHED },
        ...(filter.userId ? { actorId: filter.userId } : {}),
        ...(before ? { occurredAt: { lt: before } } : {}),
      },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: batch,
    });
    for (const entry of page) {
      const changes = (entry.changes ?? {}) as Changes;
      const type = typeOf(entry.action, changes);
      if (type === null || (filter.type && type !== filter.type)) continue;
      found.push({ id: entry.id, type, action: entry.action, actorId: entry.actorId, entityId: entry.entityId, changes, occurredAt: entry.occurredAt });
    }
    if (page.length < batch) break;
    before = page[page.length - 1]!.occurredAt;
  }

  const shown = found.slice(0, limit);
  const ids = [...new Set(shown.flatMap((r) => (r.actorId ? [r.actorId] : [])))];
  const names = new Map<string, string>();
  if (ids.length > 0) for (const user of await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })) names.set(user.id, user.name);
  const rows = shown.map(({ actorId, ...row }) => ({ ...row, actorName: actorId ? (names.get(actorId) ?? null) : null }));
  return { rows, next: found.length > limit ? rows[rows.length - 1]!.occurredAt : null };
}
