import { expireLive } from '@/server/data/cache';
import type { ActionContext } from '@/server/studio/framework/action';
import { StudioError } from '@/server/studio/framework/result';
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
      groups: Array<{ id: string; names: Names; options: Array<{ id: string; names: Names; isAvailable: boolean }> }>;
    }>;
  }>;
}

const ORDER = [{ sortOrder: 'asc' as const }, { id: 'asc' as const }];

/** Every product of the menu with its switches, by category, and each option with its own. */
export async function availabilityBoard(db: ActionContext['db'], menuId: string): Promise<AvailabilityBoard> {
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
      groups: {
        orderBy: ORDER,
        select: { id: true, translations: true, options: { orderBy: ORDER, select: { id: true, translations: true, isAvailable: true } } },
      },
    },
  });
  return {
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
          groups: product.groups.map((group) => ({
            id: group.id,
            names: textsOf(group.translations, 'name'),
            options: group.options.map((option) => ({ id: option.id, names: textsOf(option.translations, 'name'), isAvailable: option.isAvailable })),
          })),
        })),
    })),
  };
}
