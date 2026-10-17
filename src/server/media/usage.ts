import type { Prisma } from '@/generated/prisma/client';
import { isLocale } from '@/lib/locale';
import type { AnyDb } from '@/server/data/tenant-db';

/** Where an asset is used: menus whose draft shows it, and revisions that show it to guests (or once did). */
export interface AssetUsage {
  drafts: Array<{ menuId: string; menuName: string; where: 'product' | 'logo' | 'logoDark' | 'favicon' | 'seo' | 'restaurant'; label: string }>;
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
  const revisions = await db.menuRevision.findMany({
    where: { menu: menuFilter, assetIds: { has: asset.id } },
    select: { number: true, menuId: true, menu: { select: { name: true } } },
    orderBy: [{ menu: { name: 'asc' } }, { number: 'asc' }],
  });

  return {
    drafts: products.map((product) => ({
      menuId: product.menuId,
      menuName: product.menu.name,
      where: 'product' as const,
      label: productLabel(product),
    })),
    revisions: revisions.map((revision) => ({ menuId: revision.menuId, menuName: revision.menu.name, number: revision.number })),
  };
}

/** The menus whose draft shows an asset: their draft hash changes when the asset's alt text or files do. */
export function menusUsingInDraft(usage: AssetUsage): string[] {
  return [...new Set(usage.drafts.map((use) => use.menuId))];
}
