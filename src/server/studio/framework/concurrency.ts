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
  throw await refusal(delegate, args, tx);
}

/** A delegate that can delete rows by id and version (`tx.category`, `tx.product`, ...). */
export interface DeletableDelegate {
  deleteMany(args: never): PromiseLike<{ count: number }>;
  findFirst(args: never): PromiseLike<unknown>;
}

/**
 * Deletes the row only if it is still at `version`. Otherwise nothing is deleted and it throws as `updateWithVersion`
 * does: `CONFLICT` with who changed the row last, or `NOT_FOUND`.
 */
export function deleteWithVersion(delegate: DeletableDelegate, args: Omit<VersionedUpdate, 'data'>, tx: ScopedTx): Promise<void>;
export function deleteWithVersion(delegate: DeletableDelegate, args: Omit<VersionedUpdate, 'data'>, tx: AnyDb): Promise<void>;
export async function deleteWithVersion(
  delegate: DeletableDelegate,
  args: Omit<VersionedUpdate, 'data'>,
  tx: AnyDb | ScopedDb,
): Promise<void> {
  const { count } = await delegate.deleteMany({ where: { id: args.id, version: args.version } } as never);
  if (count > 0) return;
  throw await refusal(delegate, args, tx);
}

/** Audit actions that write a row without moving its version (sold out, hidden): they never explain a conflict. */
const KEEPS_VERSION = ['product.availability_changed', 'option.availability_changed', 'product.stock_changed', 'product.drop_changed'];

/** The catalog's rows. Restoring a revision moves every one of their versions and files one audit row, on the menu. */
const CATALOG = new Set(['Category', 'Product', 'ProductVariant', 'ModifierGroup', 'ModifierOption']);

/**
 * Why a versioned write found nothing to write: the row is gone or outside the scope, or someone moved it on. Who moved
 * it is the newest audit row that moves its version: its own, or a restore of its menu.
 */
async function refusal(
  delegate: Pick<VersionedDelegate, 'findFirst'>,
  args: Pick<VersionedUpdate, 'id' | 'entityType'>,
  tx: AnyDb | ScopedDb,
): Promise<StudioError> {
  const catalog = CATALOG.has(args.entityType);
  const select = catalog ? { id: true, menuId: true } : { id: true };
  const row = (await delegate.findFirst({ where: { id: args.id }, select } as never)) as { menuId?: string } | null;
  if (!row) return new StudioError('NOT_FOUND');

  const db = delegates(tx);
  const restored = row.menuId ? [{ entityType: 'Menu', entityId: row.menuId, action: 'menu.restored_to_draft' }] : [];
  const last = await db.auditLog.findFirst({
    where: { OR: [{ entityType: args.entityType, entityId: args.id, action: { notIn: KEEPS_VERSION } }, ...restored] },
    orderBy: { occurredAt: 'desc' },
    select: { actorId: true, occurredAt: true },
  });
  if (!last) return new StudioError('CONFLICT');
  const actor = last.actorId ? await db.user.findUnique({ where: { id: last.actorId }, select: { name: true } }) : null;
  return new StudioError('CONFLICT', undefined, {
    ...(actor ? { changedBy: actor.name } : {}),
    changedAt: last.occurredAt.toISOString(),
  });
}
