import type { Prisma } from '@/generated/prisma/client';
import { isLocale, LOCALES } from '@/lib/locale';
import type { AnyDb } from '@/server/data/tenant-db';

/**
 * Where an asset is used: menus whose draft shows it, saved designs that would bring it back, and revisions that show it
 * to guests (or once did).
 */
export interface AssetUsage {
  drafts: Array<{
    menuId: string;
    menuName: string;
    where: 'product' | 'logo' | 'logoDark' | 'favicon' | 'seo' | 'restaurant' | 'scene' | 'savedDesign';
    label: string;
  }>;
  revisions: Array<{ menuId: string; menuName: string; number: number }>;
}

export const usageCount = (usage: AssetUsage) => usage.drafts.length + usage.revisions.length;

/** A product's name for the usage list: its English name, else its first name, else its slug. */
function productLabel(product: { slug: string; translations: unknown }): string {
  const translations = (product.translations ?? {}) as Record<string, { name?: unknown } | undefined>;
  const english = translations.en?.name;
  if (typeof english === 'string' && english.trim() !== '') return english;
  for (const [locale, entry] of Object.entries(translations)) {
    if (isLocale(locale) && typeof entry?.name === 'string' && entry.name.trim() !== '') return entry.name;
  }
  return product.slug;
}

/**
 * Every use of an asset. A restaurant's asset can only be used by its own menus (another restaurant gets a copy of it),
 * so only those are searched; a shared asset is searched for everywhere. Run on the application's client: a draft's
 * rows belong to menus, which a restaurant's client does not read.
 */
export async function assetUsage(db: AnyDb, asset: { id: string; restaurantId: string | null }): Promise<AssetUsage> {
  const menuFilter: Prisma.MenuWhereInput = asset.restaurantId === null ? {} : { restaurantId: asset.restaurantId };

  const products = await db.product.findMany({
    where: { menu: menuFilter, media: { array_contains: [{ kind: 'asset', assetId: asset.id }] } },
    select: { slug: true, translations: true, menuId: true, menu: { select: { name: true } } },
    orderBy: [{ menu: { name: 'asc' } }, { sortOrder: 'asc' }, { slug: 'asc' }],
  });
  // A menu's search image, in any of its languages.
  const seoMenus = await db.menu.findMany({
    where: { ...menuFilter, OR: LOCALES.map((locale) => ({ seo: { path: [locale, 'imageAssetId'], equals: asset.id } })) },
    select: { id: true, name: true },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
  });
  // Brand kits: a logo, a dark-theme logo, or the file a favicon is drawn from.
  const kits = await db.brandConfig.findMany({
    where: { menu: menuFilter, OR: [{ logoAssetId: asset.id }, { logoDarkAssetId: asset.id }, { faviconAssetId: asset.id }] },
    select: { menuId: true, logoAssetId: true, logoDarkAssetId: true, faviconAssetId: true, menu: { select: { name: true } } },
    orderBy: [{ menu: { name: 'asc' } }],
  });
  // Restaurants that show it as their logo (and give it to each new menu).
  const restaurants = await db.restaurant.findMany({
    where: { logoAssetId: asset.id, ...(asset.restaurantId === null ? {} : { id: asset.restaurantId }) },
    select: { name: true },
    orderBy: [{ name: 'asc' }],
  });
  // A template menu's background, and the saved designs that carry it (a restaurant's own, or shared ones).
  const sceneKits = await db.brandConfig.findMany({
    where: { menu: menuFilter, design: { path: ['sceneAsset', 'assetId'], equals: asset.id } },
    select: { menuId: true, menu: { select: { name: true } } },
    orderBy: [{ menu: { name: 'asc' } }],
  });
  const savedDesigns = await db.designTemplate.findMany({
    where: {
      overrides: { path: ['sceneAsset', 'assetId'], equals: asset.id },
      ...(asset.restaurantId === null ? {} : { restaurantId: asset.restaurantId }),
    },
    select: { name: true },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
  });
  const revisions = await db.menuRevision.findMany({
    where: { menu: menuFilter, assetIds: { has: asset.id } },
    select: { number: true, menuId: true, menu: { select: { name: true } } },
    orderBy: [{ menu: { name: 'asc' } }, { number: 'asc' }],
  });

  return {
    drafts: [
      ...products.map((product) => ({
        menuId: product.menuId,
        menuName: product.menu.name,
        where: 'product' as const,
        label: productLabel(product),
      })),
      ...seoMenus.map((menu) => ({ menuId: menu.id, menuName: menu.name, where: 'seo' as const, label: menu.name })),
      ...kits.flatMap((kit) =>
        ([
          [kit.logoAssetId, 'logo'],
          [kit.logoDarkAssetId, 'logoDark'],
          [kit.faviconAssetId, 'favicon'],
        ] as const)
          .filter(([id]) => id === asset.id)
          .map(([, where]) => ({ menuId: kit.menuId, menuName: kit.menu.name, where, label: kit.menu.name })),
      ),
      ...sceneKits.map((kit) => ({ menuId: kit.menuId, menuName: kit.menu.name, where: 'scene' as const, label: kit.menu.name })),
      // A restaurant or a saved design is not a menu: their entries have no menu id.
      ...restaurants.map((restaurant) => ({ menuId: '', menuName: restaurant.name, where: 'restaurant' as const, label: restaurant.name })),
      ...savedDesigns.map((saved) => ({ menuId: '', menuName: saved.name, where: 'savedDesign' as const, label: saved.name })),
    ],
    revisions: revisions.map((revision) => ({ menuId: revision.menuId, menuName: revision.menu.name, number: revision.number })),
  };
}

/** The menus whose draft shows an asset: their draft hash changes when the asset's alt text or files do. */
export function menusUsingInDraft(usage: AssetUsage): string[] {
  return [...new Set(usage.drafts.filter((use) => use.menuId !== '').map((use) => use.menuId))];
}
