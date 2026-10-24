import type { PrismaClient } from '@/generated/prisma/client';
import type { ScopedTx } from '@/server/data/tenant-db';
import { bestRail } from '@/server/domain/plan-choices';
import { suggestSlug } from '@/server/domain/slug';
import { refreshDraftHash } from '@/server/publish/draft';
import type { ActionContext } from '@/server/studio/framework/action';
import { StudioError } from '@/server/studio/framework/result';
import { checkSlugAvailable, claimSlug, DEFAULT_SCHEDULE, defaultBrand } from '@/server/studio/services/menus';

/**
 * Each restaurant's product list is one `Menu` of its own, named by `PosSettings.catalogMenuId`: the menu's categories,
 * products, options and prices are the till's catalog, so there is one place to edit them. A restaurant that only sells at
 * the till gets a DRAFT menu that is never published, so it resolves to nothing publicly. Prices are whole Iraqi dinar.
 */

const CHOICE_REQUIRED = 'Choose which menu is the product list';
const MUST_BE_DINAR = 'The product list must be priced in Iraqi dinar';

export const CatalogMenuChoiceRequired = (): StudioError => new StudioError('CONFLICT', CHOICE_REQUIRED);
export const CatalogMenuCurrency = (): StudioError => new StudioError('INVALID', MUST_BE_DINAR, { menuId: MUST_BE_DINAR });

/** The restaurant's product-list menu, or null when none is chosen (or the chosen one is gone). */
export async function catalogMenuOf(db: PrismaClient, restaurantId: string): Promise<{ id: string; currency: string } | null> {
  const settings = await db.posSettings.findUnique({ where: { restaurantId }, select: { catalogMenuId: true } });
  if (!settings?.catalogMenuId) return null;
  return db.menu.findFirst({ where: { id: settings.catalogMenuId, restaurantId }, select: { id: true, currency: true } });
}

/** Points the restaurant's settings at the menu, making the settings row if the restaurant has none yet. */
async function linkIn(tx: ScopedTx, restaurantId: string, menuId: string, audit: ActionContext['audit']): Promise<void> {
  const existing = await tx.posSettings.findFirst({ where: { restaurantId } });
  let id: string;
  let before: string | null = null;
  if (existing) {
    id = existing.id;
    before = existing.catalogMenuId;
    await tx.posSettings.update({ where: { id }, data: { catalogMenuId: menuId } });
  } else {
    id = (await tx.posSettings.create({ data: { restaurantId, catalogMenuId: menuId } })).id;
  }
  audit({ action: 'pos.catalog.chosen', entityType: 'PosSettings', entityId: id, changes: { catalogMenuId: { before, after: menuId } } });
}

function restaurantOf(ctx: ActionContext): string {
  if (ctx.restaurantId === null) throw new Error('A till action ran without a till');
  return ctx.restaurantId;
}

/**
 * The restaurant's product list, set up if need be: the chosen menu; else its only menu; else a new DRAFT menu (Iraqi
 * dinar, Arabic first, Baghdad time, Arabic-Indic numerals). With several menus and none chosen the owner must choose.
 */
export async function ensureCatalogMenu(ctx: ActionContext): Promise<{ menuId: string; created: boolean }> {
  const restaurantId = restaurantOf(ctx);
  const chosen = await catalogMenuOf(ctx.db, restaurantId);
  if (chosen) return { menuId: chosen.id, created: false };

  const menus = await ctx.db.menu.findMany({ where: { restaurantId, status: { not: 'ARCHIVED' } }, select: { id: true, currency: true } });
  if (menus.length > 1) throw CatalogMenuChoiceRequired();
  if (menus.length === 1) {
    const only = menus[0]!;
    if (only.currency !== 'IQD') throw CatalogMenuCurrency();
    await ctx.transaction((tx) => linkIn(tx, restaurantId, only.id, ctx.audit));
    return { menuId: only.id, created: false };
  }

  const menuId = ctx.newId();
  await ctx.transactionIn({ restaurantId, menuId }, async (tx) => {
    const restaurant = await tx.restaurant.findUnique({ where: { id: restaurantId }, select: { name: true, logoAssetId: true } });
    if (!restaurant) throw new StudioError('NOT_FOUND');

    const base = `${suggestSlug(restaurant.name, 'till')}-till`.slice(0, 60);
    let slug = base;
    for (let n = 2; (await checkSlugAvailable(tx, slug, null)) !== 'ok'; n += 1) {
      if (n > 50) throw new StudioError('CONFLICT', 'Could not find a free address for the product list');
      slug = `${base}-${n}`;
    }

    await tx.menu.create({
      data: {
        id: menuId,
        restaurantId,
        name: `${restaurant.name} · till`.slice(0, 120),
        slug,
        locales: ['ar', 'ckb', 'en'],
        defaultLocale: 'ar',
        currency: 'IQD',
        timezone: 'Asia/Baghdad',
        numeralSystem: 'ARAB',
      },
    });
    await claimSlug(tx, slug, menuId);
    const railStyle = ctx.plan ? bestRail(ctx.plan.entitlements) : undefined;
    await tx.brandConfig.create({
      data: { menuId, ...defaultBrand(restaurant.name), logoAssetId: restaurant.logoAssetId, ...(railStyle ? { railStyle } : {}) },
    });
    await tx.daypartSchedule.createMany({ data: DEFAULT_SCHEDULE.map((window) => ({ menuId, ...window })) });
    await refreshDraftHash(tx, menuId);
    ctx.audit({
      action: 'menu.created',
      entityType: 'Menu',
      entityId: menuId,
      changes: { name: { before: null, after: `${restaurant.name} · till` }, slug: { before: null, after: slug }, currency: { before: null, after: 'IQD' } },
    });
    await linkIn(tx, restaurantId, menuId, ctx.audit);
  });
  return { menuId, created: true };
}

/** Makes one of the restaurant's own menus its product list. It must be priced in Iraqi dinar. */
export async function chooseCatalogMenu(ctx: ActionContext, menuId: string): Promise<{ menuId: string }> {
  const restaurantId = restaurantOf(ctx);
  const menu = await ctx.db.menu.findFirst({ where: { id: menuId, restaurantId }, select: { id: true, currency: true } });
  if (!menu) throw new StudioError('NOT_FOUND');
  if (menu.currency !== 'IQD') throw CatalogMenuCurrency();
  await ctx.transaction((tx) => linkIn(tx, restaurantId, menu.id, ctx.audit));
  return { menuId: menu.id };
}
