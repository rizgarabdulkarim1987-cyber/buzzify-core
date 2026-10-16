import { delegates, type AnyDb, type ScopedDb, type ScopedTx } from '@/server/data/tenant-db';
import { StudioError } from './result';

/**
 * The two calls `updateWithVersion` makes on a model delegate (`tx.restaurant`, `tx.branch`, ...): any model with an
 * `id` and an integer `version` fits. The parameters are left open because Prisma's generic signatures differ per model.
 */
export interface VersionedDelegate {
  updateMany(args: never): PromiseLike<{ count: number }>;
  findFirst(args: never): PromiseLike<unknown>;
}

export interface VersionedUpdate {
  id: string;
  /** The version the person started editing from. */
  version: number;
  data: object;
  /** The audit log's name for the model, to find who changed the row last. */
  entityType: string;
}

/**
 * Saves `data` only if the row is still at `version`, and moves it to the next version (spec 10.5). When the row has
 * moved on, nothing is written and it throws `CONFLICT` with who changed it last and when (`fields.changedBy`, the
 * person's name, and `fields.changedAt`, ISO 8601), read from the newest audit row for it; a row that does not exist,
 * or is outside the client's scope, is `NOT_FOUND`. Run it on the transaction's own delegate and pass the transaction.
 */
export function updateWithVersion(delegate: VersionedDelegate, args: VersionedUpdate, tx: ScopedTx): Promise<void>;
export function updateWithVersion(delegate: VersionedDelegate, args: VersionedUpdate, tx: AnyDb): Promise<void>;
export async function updateWithVersion(
  delegate: VersionedDelegate,
  args: VersionedUpdate,
  tx: AnyDb | ScopedDb,
): Promise<void> {
  const { count } = await delegate.updateMany({
    where: { id: args.id, version: args.version },
    data: { ...args.data, version: { increment: 1 } },
  } as never);
  if (count > 0) return;

  const row = await delegate.findFirst({ where: { id: args.id }, select: { id: true } } as never);
  if (!row) throw new StudioError('NOT_FOUND');

  const db = delegates(tx);
  const last = await db.auditLog.findFirst({
    where: { entityType: args.entityType, entityId: args.id },
    orderBy: { occurredAt: 'desc' },
    select: { actorId: true, occurredAt: true },
  });
  if (!last) throw new StudioError('CONFLICT');
  const actor = last.actorId ? await db.user.findUnique({ where: { id: last.actorId }, select: { name: true } }) : null;
  throw new StudioError('CONFLICT', undefined, {
    ...(actor ? { changedBy: actor.name } : {}),
    changedAt: last.occurredAt.toISOString(),
  });
}
