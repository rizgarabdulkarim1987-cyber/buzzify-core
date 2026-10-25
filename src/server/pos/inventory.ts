import type { PosStockMovementKind, PosStockUnit } from '@/generated/prisma/client';
import type { AnyDb } from '@/server/data/tenant-db';
import { costOf, MAX_MOVEMENT, nameKey, stockState, type LastCost } from '@/server/domain/pos/stock';
import { StudioError } from '@/server/studio/framework/result';
import { isUniqueViolation, refuse } from './errors';

/**
 * Inventory items and the stock ledger. `PosStockMovement` rows are only ever created, and an item's `onHand` changes only
 * in `applyMovements`, by exactly the movement's quantity, so the ledger always adds up to the number on the shelf. Stock
 * may go negative (a sale never fails for stock); a negative item is flagged "count needed".
 */

export interface MovementInput {
  itemId: string;
  kind: PosStockMovementKind;
  /** Signed delta in the item's smallest unit. */
  quantity: number;
  costTotal: number | null;
  reason?: string;
  purchaseLineId?: string;
  paymentId?: string;
  orderLineId?: string;
  countId?: string;
}

const lastCostOf = (item: { lastCostAmount: number | null; lastCostQuantity: number | null }): LastCost | null =>
  item.lastCostAmount !== null && item.lastCostQuantity !== null ? { amount: item.lastCostAmount, quantity: item.lastCostQuantity } : null;

/**
 * The only writer of the ledger and of `onHand`: the rows are created, then each item is moved once by the sum of its
 * movements. A movement for an item of another restaurant moves nothing and fails.
 */
export async function applyMovements(db: AnyDb, restaurantId: string, userId: string | null, movements: readonly MovementInput[]): Promise<void> {
  if (movements.length === 0) return;
  await db.posStockMovement.createMany({
    data: movements.map((m) => ({
      restaurantId,
      itemId: m.itemId,
      kind: m.kind,
      quantity: m.quantity,
      costTotal: m.costTotal,
      reason: m.reason ?? '',
      purchaseLineId: m.purchaseLineId ?? null,
      paymentId: m.paymentId ?? null,
      orderLineId: m.orderLineId ?? null,
      countId: m.countId ?? null,
      userId,
    })),
  });
  const delta = new Map<string, number>();
  for (const m of movements) delta.set(m.itemId, (delta.get(m.itemId) ?? 0) + m.quantity);
  for (const [itemId, quantity] of [...delta].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const { count } = await db.posInventoryItem.updateMany({ where: { id: itemId, restaurantId }, data: { onHand: { increment: quantity } } });
    if (count === 0) throw new StudioError('NOT_FOUND');
  }
}

export interface ItemRow {
  id: string;
  name: string;
  unit: PosStockUnit;
  onHand: number;
  reorderLevel: number;
  active: boolean;
  state: 'negative' | 'low' | 'ok';
  /** Null unless the reader may see costs, and until the first purchase. */
  lastCost: LastCost | null;
}

type ItemRecord = { id: string; name: string; unit: PosStockUnit; onHand: number; reorderLevel: number; active: boolean; lastCostAmount: number | null; lastCostQuantity: number | null };

const toRow = (item: ItemRecord, withCost: boolean): ItemRow => ({
  id: item.id,
  name: item.name,
  unit: item.unit,
  onHand: item.onHand,
  reorderLevel: item.reorderLevel,
  active: item.active,
  state: stockState(item.onHand, item.reorderLevel),
  lastCost: withCost ? lastCostOf(item) : null,
});

export async function createItem(db: AnyDb, restaurantId: string, input: { name: string; unit: PosStockUnit; reorderLevel: number }) {
  try {
    const item = await db.posInventoryItem.create({
      data: { restaurantId, name: input.name, nameKey: nameKey(input.name), unit: input.unit, reorderLevel: input.reorderLevel },
      select: { id: true },
    });
    return item.id;
  } catch (error) {
    if (isUniqueViolation(error)) throw refuse('CONFLICT', 'An item with this name already exists');
    throw error;
  }
}

/** Renames, sets the reorder level, or switches an item off. The unit never changes. An item in a recipe cannot be switched off. */
export async function updateItem(db: AnyDb, restaurantId: string, itemId: string, input: { name?: string; reorderLevel?: number; active?: boolean }) {
  const item = await db.posInventoryItem.findFirst({ where: { id: itemId, restaurantId } });
  if (!item) throw new StudioError('NOT_FOUND');
  if (input.active === false && item.active) {
    const used = await db.posRecipeLine.count({ where: { restaurantId, itemId } });
    if (used > 0) throw refuse('CONFLICT', 'Remove the item from its recipes first');
  }
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  const data: { name?: string; nameKey?: string; reorderLevel?: number; active?: boolean } = {};
  if (input.name !== undefined && input.name !== item.name) {
    data.name = input.name;
    data.nameKey = nameKey(input.name);
    before.name = item.name;
    after.name = input.name;
  }
  if (input.reorderLevel !== undefined && input.reorderLevel !== item.reorderLevel) {
    data.reorderLevel = input.reorderLevel;
    before.reorderLevel = item.reorderLevel;
    after.reorderLevel = input.reorderLevel;
  }
  if (input.active !== undefined && input.active !== item.active) {
    data.active = input.active;
    before.active = item.active;
    after.active = input.active;
  }
  if (Object.keys(data).length === 0) return { changed: false as const, before, after };
  try {
    await db.posInventoryItem.update({ where: { id: itemId }, data });
  } catch (error) {
    if (isUniqueViolation(error)) throw refuse('CONFLICT', 'An item with this name already exists');
    throw error;
  }
  return { changed: true as const, before, after };
}

export async function listItems(db: AnyDb, restaurantId: string, options: { includeInactive?: boolean; withCost: boolean }): Promise<ItemRow[]> {
  const rows = await db.posInventoryItem.findMany({
    where: { restaurantId, ...(options.includeInactive ? {} : { active: true }) },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
  });
  return rows.map((row) => toRow(row, options.withCost));
}

/** Negative items first (a count is needed), then the ones at or under their reorder level, the emptiest first. */
export async function listLowStock(db: AnyDb, restaurantId: string, withCost: boolean): Promise<ItemRow[]> {
  const rows = await db.posInventoryItem.findMany({ where: { restaurantId, active: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }] });
  return rows
    .filter((row) => stockState(row.onHand, row.reorderLevel) !== 'ok')
    .sort((a, b) => Number(b.onHand < 0) - Number(a.onHand < 0) || a.onHand - a.reorderLevel - (b.onHand - b.reorderLevel))
    .map((row) => toRow(row, withCost));
}

export async function readItem(db: AnyDb, restaurantId: string, itemId: string, withCost: boolean): Promise<ItemRow> {
  const item = await db.posInventoryItem.findFirst({ where: { id: itemId, restaurantId } });
  if (!item) throw new StudioError('NOT_FOUND');
  return toRow(item, withCost);
}

async function activeItem(db: AnyDb, restaurantId: string, itemId: string) {
  const item = await db.posInventoryItem.findFirst({ where: { id: itemId, restaurantId } });
  if (!item) throw new StudioError('NOT_FOUND');
  if (!item.active) throw refuse('CONFLICT', 'This item is switched off');
  return item;
}

/** A signed correction with a reason. */
export async function adjustStock(db: AnyDb, restaurantId: string, userId: string, input: { itemId: string; quantity: number; reason: string }) {
  await activeItem(db, restaurantId, input.itemId);
  await applyMovements(db, restaurantId, userId, [{ itemId: input.itemId, kind: 'ADJUSTMENT', quantity: input.quantity, costTotal: null, reason: input.reason }]);
}

/** Waste comes out of stock at the item's last cost (unknown when it has none). */
export async function recordWaste(db: AnyDb, restaurantId: string, userId: string, input: { itemId: string; quantity: number; reason: string }) {
  const item = await activeItem(db, restaurantId, input.itemId);
  const costTotal = costOf(input.quantity, lastCostOf(item));
  await applyMovements(db, restaurantId, userId, [{ itemId: input.itemId, kind: 'WASTE', quantity: -input.quantity, costTotal, reason: input.reason }]);
  return { costTotal };
}

/**
 * Saves a stock count: each counted item gets a COUNT movement for the difference to what the system held. An item is moved
 * only if its quantity is still what the counter saw (read here, written with a condition), else the whole count is refused
 * and the person counts again; so a sale in between is never lost.
 */
export async function recordStockCount(db: AnyDb, restaurantId: string, userId: string, input: { lines: { itemId: string; counted: number }[]; note: string }) {
  const ids = input.lines.map((line) => line.itemId);
  if (new Set(ids).size !== ids.length) throw refuse('INVALID', 'Each item can be counted once');
  const items = await db.posInventoryItem.findMany({ where: { restaurantId, id: { in: ids }, active: true } });
  if (items.length !== ids.length) throw new StudioError('NOT_FOUND');
  const held = new Map(items.map((item) => [item.id, item.onHand]));
  const count = await db.posStockCount.create({ data: { restaurantId, userId, note: input.note }, select: { id: true } });
  let changed = 0;
  for (const line of input.lines) {
    const observed = held.get(line.itemId)!;
    if (line.counted === observed) continue;
    const { count: rows } = await db.posInventoryItem.updateMany({ where: { id: line.itemId, restaurantId, onHand: observed }, data: { onHand: line.counted } });
    if (rows === 0) throw refuse('CONFLICT', 'Stock changed while you counted. Check the numbers and save again.');
    await db.posStockMovement.create({
      data: { restaurantId, itemId: line.itemId, kind: 'COUNT', quantity: line.counted - observed, costTotal: null, countId: count.id, userId },
    });
    changed += 1;
  }
  return { countId: count.id, changed };
}

export interface MovementRow {
  id: string;
  kind: PosStockMovementKind;
  quantity: number;
  reason: string;
  at: Date;
  userName: string;
  /** Null unless the reader may see costs. */
  costTotal: number | null;
  paymentId: string | null;
}

/** An item's ledger, newest first. */
export async function listMovements(db: AnyDb, restaurantId: string, itemId: string, options: { before?: Date; take?: number; withCost: boolean }): Promise<MovementRow[]> {
  const rows = await db.posStockMovement.findMany({
    where: { restaurantId, itemId, ...(options.before ? { createdAt: { lt: options.before } } : {}) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: Math.min(options.take ?? 50, 100),
  });
  const ids = [...new Set(rows.flatMap((row) => (row.userId ? [row.userId] : [])))];
  const users = ids.length > 0 ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const names = new Map(users.map((u) => [u.id, u.name]));
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    quantity: row.quantity,
    reason: row.reason,
    at: row.createdAt,
    userName: row.userId ? (names.get(row.userId) ?? '') : '',
    costTotal: options.withCost ? row.costTotal : null,
    paymentId: row.paymentId,
  }));
}

export { MAX_MOVEMENT };
