import { expireLive } from '@/server/data/cache';
import type { ActionContext } from '@/server/studio/framework/action';
import { requireFeature } from '@/server/studio/framework/plan';
import { StudioError } from '@/server/studio/framework/result';
import type { UpgradeInfo } from './plans';
import { textsOf, type Names } from './content';

/**
 * What guests see change at once, without a publish (spec 10.3, Availability): a product sold out or hidden, an option
 * sold out. These fields are not in the snapshot, so the draft's hash stays as it is and no version moves: a person
 * editing the product in the drawer at the same moment saves without a conflict. The live overlay is expired after the
 * change commits, so the next guest sees it.
 */

function menuOf(ctx: ActionContext): string {
  if (ctx.menuId === null) throw new Error('A menu action ran without a menu');
  return ctx.menuId;
}

export async function setProductAvailability(
  ctx: ActionContext,
  input: { productId: string; isAvailable?: boolean | undefined; isHidden?: boolean | undefined },
): Promise<{ isAvailable: boolean; isHidden: boolean }> {
  const menuId = menuOf(ctx);
  const result = await ctx.transaction(async (tx) => {
    const row = await tx.product.findFirst({ where: { id: input.productId }, select: { id: true, isAvailable: true, isHidden: true } });
    if (!row) throw new StudioError('NOT_FOUND');
    const after = { isAvailable: input.isAvailable ?? row.isAvailable, isHidden: input.isHidden ?? row.isHidden };
    await tx.product.updateMany({ where: { id: row.id }, data: after });
    const changes: Record<string, { before: unknown; after: unknown }> = {};
    if (after.isAvailable !== row.isAvailable) changes.isAvailable = { before: row.isAvailable, after: after.isAvailable };
    if (after.isHidden !== row.isHidden) changes.isHidden = { before: row.isHidden, after: after.isHidden };
    if (Object.keys(changes).length > 0) ctx.audit({ action: 'product.availability_changed', entityType: 'Product', entityId: row.id, changes });
    return after;
  });
  ctx.afterCommit(() => expireLive(menuId));
  return result;
}

/** How many portions of a product are left today, or null for not counted. A product at 0 is out of stock for guests. */
export async function setProductStock(ctx: ActionContext, input: { productId: string; stockCount: number | null }): Promise<{ stockCount: number | null }> {
  const menuId = menuOf(ctx);
  const result = await ctx.transaction(async (tx) => {
    const row = await tx.product.findFirst({ where: { id: input.productId }, select: { id: true, stockCount: true } });
    if (!row) throw new StudioError('NOT_FOUND');
    await tx.product.updateMany({ where: { id: row.id }, data: { stockCount: input.stockCount } });
    if (row.stockCount !== input.stockCount) {
      ctx.audit({ action: 'product.stock_changed', entityType: 'Product', entityId: row.id, changes: { stockCount: { before: row.stockCount, after: input.stockCount } } });
    }
    return { stockCount: input.stockCount };
  });
  ctx.afterCommit(() => expireLive(menuId));
  return result;
}

/**
 * Puts a dish on the menu only between two instants (a limited drop, plan feature `selling.limitedDrops`), or takes the
 * window away (both null). Live like the other switches: no publish, the live overlay is expired after the commit. The
 * end must still be ahead; a plan without the feature can clear a window but not set one.
 */
export async function setProductDrop(
  ctx: ActionContext,
  input: { productId: string; startsAt: Date | null; endsAt: Date | null },
  now: Date = new Date(),
): Promise<{ startsAt: string | null; endsAt: string | null }> {
  const menuId = menuOf(ctx);
  if (input.startsAt !== null && input.endsAt !== null) {
    requireFeature(ctx.plan, 'selling.limitedDrops');
    if (input.endsAt.getTime() <= now.getTime()) throw new StudioError('INVALID', 'The drop must end in the future', { endsAt: 'The drop must end in the future' });
  }
  const result = await ctx.transaction(async (tx) => {
    const row = await tx.product.findFirst({ where: { id: input.productId }, select: { id: true, dropStartsAt: true, dropEndsAt: true } });
    if (!row) throw new StudioError('NOT_FOUND');
    await tx.product.updateMany({ where: { id: row.id }, data: { dropStartsAt: input.startsAt, dropEndsAt: input.endsAt } });
    const iso = (date: Date | null) => (date === null ? null : date.toISOString());
    if (iso(row.dropStartsAt) !== iso(input.startsAt) || iso(row.dropEndsAt) !== iso(input.endsAt)) {
      ctx.audit({
        action: 'product.drop_changed',
        entityType: 'Product',
        entityId: row.id,
        changes: { dropStartsAt: { before: iso(row.dropStartsAt), after: iso(input.startsAt) }, dropEndsAt: { before: iso(row.dropEndsAt), after: iso(input.endsAt) } },
      });
    }
    return { startsAt: iso(input.startsAt), endsAt: iso(input.endsAt) };
  });
  ctx.afterCommit(() => expireLive(menuId));
  return result;
}

export async function setOptionAvailability(ctx: ActionContext, input: { optionId: string; isAvailable: boolean }): Promise<{ isAvailable: boolean }> {
  const menuId = menuOf(ctx);
  const result = await ctx.transaction(async (tx) => {
    const row = await tx.modifierOption.findFirst({ where: { id: input.optionId }, select: { id: true, isAvailable: true } });
    if (!row) throw new StudioError('NOT_FOUND');
    await tx.modifierOption.updateMany({ where: { id: row.id }, data: { isAvailable: input.isAvailable } });
    if (row.isAvailable !== input.isAvailable) {
      ctx.audit({
        action: 'option.availability_changed',
        entityType: 'ModifierOption',
        entityId: row.id,
        changes: { isAvailable: { before: row.isAvailable, after: input.isAvailable } },
      });
    }
    return { isAvailable: input.isAvailable };
  });
  ctx.afterCommit(() => expireLive(menuId));
  return result;
}

export interface AvailabilityBoard {
  /** Whether the plan has limited drops, and what the upgrade hint needs when it does not. */
  drops: { allowed: boolean; upgrade: UpgradeInfo };
  locales: string[];
  defaultLocale: string;
  categories: Array<{
    id: string;
    names: Names;
    products: Array<{
      id: string;
      names: Names;
      isAvailable: boolean;
      isHidden: boolean;
      /** Portions left today, or null when not counted. */
      stockCount: number | null;
      lowStockThreshold: number | null;
      /** The limited-drop window as ISO instants, or null for none. */
      dropStartsAt: string | null;
      dropEndsAt: string | null;
      groups: Array<{ id: string; names: Names; options: Array<{ id: string; names: Names; isAvailable: boolean }> }>;
    }>;
  }>;
}

const ORDER = [{ sortOrder: 'asc' as const }, { id: 'asc' as const }];

/** Every product of the menu with its switches, by category, and each option with its own. */
export async function availabilityBoard(db: ActionContext['db'], menuId: string, drops: AvailabilityBoard['drops']): Promise<AvailabilityBoard> {
  const menu = await db.menu.findUnique({ where: { id: menuId }, select: { locales: true, defaultLocale: true } });
  if (!menu) throw new StudioError('NOT_FOUND');
  const categories = await db.category.findMany({ where: { menuId }, orderBy: ORDER, select: { id: true, translations: true } });
  const products = await db.product.findMany({
    where: { menuId },
    orderBy: ORDER,
    select: {
      id: true,
      categoryId: true,
      translations: true,
      isAvailable: true,
      isHidden: true,
      stockCount: true,
      lowStockThreshold: true,
      dropStartsAt: true,
      dropEndsAt: true,
      groups: {
        orderBy: ORDER,
        select: { id: true, translations: true, options: { orderBy: ORDER, select: { id: true, translations: true, isAvailable: true } } },
      },
    },
  });
  return {
    drops,
    locales: menu.locales,
    defaultLocale: menu.defaultLocale,
    categories: categories.map((category) => ({
      id: category.id,
      names: textsOf(category.translations, 'name'),
      products: products
        .filter((product) => product.categoryId === category.id)
        .map((product) => ({
          id: product.id,
          names: textsOf(product.translations, 'name'),
          isAvailable: product.isAvailable,
          isHidden: product.isHidden,
          stockCount: product.stockCount,
          lowStockThreshold: product.lowStockThreshold,
          dropStartsAt: product.dropStartsAt?.toISOString() ?? null,
          dropEndsAt: product.dropEndsAt?.toISOString() ?? null,
          groups: product.groups.map((group) => ({
            id: group.id,
            names: textsOf(group.translations, 'name'),
            options: group.options.map((option) => ({ id: option.id, names: textsOf(option.translations, 'name'), isAvailable: option.isAvailable })),
          })),
        })),
    })),
  };
}
