import type { PosStockUnit } from '@/generated/prisma/client';
import type { AnyDb } from '@/server/data/tenant-db';
import { costOf, MAX_MOVEMENT } from '@/server/domain/pos/stock';
import { StudioError } from '@/server/studio/framework/result';
import { refuse } from './errors';
import { applyMovements, type MovementInput } from './inventory';

/**
 * Optional recipes: the ingredients one unit of a product uses. A paid sale takes them out of stock inside the payment's own
 * transaction, at each item's last cost frozen on the movement. A product with no recipe is never touched. Stock may go
 * negative and a sale never fails for it.
 */

export interface RecipeView {
  productId: string;
  lines: { itemId: string; itemName: string; unit: PosStockUnit; quantity: number }[];
}

export async function readRecipe(db: AnyDb, restaurantId: string, productId: string): Promise<RecipeView> {
  const lines = await db.posRecipeLine.findMany({ where: { restaurantId, productId }, include: { item: { select: { name: true, unit: true } } }, orderBy: [{ id: 'asc' }] });
  return { productId, lines: lines.map((l) => ({ itemId: l.itemId, itemName: l.item.name, unit: l.item.unit, quantity: l.quantity })).sort((a, b) => (a.itemName < b.itemName ? -1 : a.itemName > b.itemName ? 1 : 0)) };
}

/** Product ids that have a recipe, with the number of ingredients. */
export async function recipeCounts(db: AnyDb, restaurantId: string): Promise<Record<string, number>> {
  const rows = await db.posRecipeLine.groupBy({ by: ['productId'], where: { restaurantId }, _count: { _all: true } });
  return Object.fromEntries(rows.map((row) => [row.productId, row._count._all]));
}

/** Replaces a product's recipe. Items must be active and the restaurant's own; an empty list removes the recipe. */
export async function setRecipe(db: AnyDb, restaurantId: string, productId: string, lines: { itemId: string; quantity: number }[]) {
  const ids = lines.map((line) => line.itemId);
  if (new Set(ids).size !== ids.length) throw refuse('INVALID', 'Each item can be counted once');
  const product = await db.product.findFirst({ where: { id: productId }, select: { id: true } });
  if (!product) throw new StudioError('NOT_FOUND');
  const items = await db.posInventoryItem.findMany({ where: { restaurantId, id: { in: ids } }, select: { id: true, active: true } });
  if (items.length !== ids.length) throw new StudioError('NOT_FOUND');
  if (items.some((item) => !item.active)) throw refuse('CONFLICT', 'This item is switched off');
  const before = await db.posRecipeLine.findMany({ where: { restaurantId, productId }, select: { itemId: true, quantity: true }, orderBy: { itemId: 'asc' } });
  const next = [...lines].sort((a, b) => (a.itemId < b.itemId ? -1 : 1));
  if (JSON.stringify(before) === JSON.stringify(next.map((l) => ({ itemId: l.itemId, quantity: l.quantity })))) return { changed: false as const, before, after: next };
  await db.posRecipeLine.deleteMany({ where: { restaurantId, productId } });
  if (next.length > 0) await db.posRecipeLine.createMany({ data: next.map((line) => ({ restaurantId, productId, itemId: line.itemId, quantity: line.quantity })) });
  return { changed: true as const, before, after: next };
}

/**
 * Takes the ingredients of every paid line out of stock: one SALE movement per (line, ingredient). Called by `payOrderIn`, which
 * the online action and the offline replay share, so a replayed payment (exactly-once by operation id) consumes once.
 */
export async function consumeForPayment(
  db: AnyDb,
  restaurantId: string,
  userId: string | null,
  input: { paymentId: string; lines: { orderLineId: string; productId: string | null; quantity: number }[] },
): Promise<number> {
  const productIds = [...new Set(input.lines.flatMap((line) => (line.productId ? [line.productId] : [])))];
  if (productIds.length === 0) return 0;
  const recipes = await db.posRecipeLine.findMany({ where: { restaurantId, productId: { in: productIds } }, select: { productId: true, itemId: true, quantity: true } });
  if (recipes.length === 0) return 0;
  const items = await db.posInventoryItem.findMany({ where: { restaurantId, id: { in: [...new Set(recipes.map((r) => r.itemId))] } } });
  const byItem = new Map(items.map((item) => [item.id, item]));
  const movements: MovementInput[] = [];
  for (const line of input.lines) {
    for (const recipe of recipes.filter((r) => r.productId === line.productId)) {
      const item = byItem.get(recipe.itemId);
      if (!item) continue;
      const used = recipe.quantity * line.quantity;
      if (!Number.isSafeInteger(used) || used > MAX_MOVEMENT * 100) throw new Error('A recipe consumes an impossible quantity');
      const cost = item.lastCostAmount !== null && item.lastCostQuantity !== null ? { amount: item.lastCostAmount, quantity: item.lastCostQuantity } : null;
      movements.push({ itemId: item.id, kind: 'SALE', quantity: -used, costTotal: costOf(used, cost), paymentId: input.paymentId, orderLineId: line.orderLineId });
    }
  }
  await applyMovements(db, restaurantId, userId, movements);
  return movements.length;
}
