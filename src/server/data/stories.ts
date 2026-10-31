import type { Locale } from '@/lib/locale';
import type { ImageItem } from '@/lib/media';
import { cachedStoryRows } from '@/server/data/cache';
import { getPrisma } from '@/server/data/prisma';
import { menuDb } from '@/server/data/tenant-db';
import type { TenantInfo } from '@/server/data/tenant';
import { liveStories, MAX_LIVE_STORIES, type StoryRow } from '@/server/domain/stories';
import type { Catalog } from '@/server/domain/types';
import { loadAssets, resolveDraftMedia } from '@/server/media/resolve';
import { getStorage } from '@/server/storage/storage';

/**
 * A story as the guest's rail shows it. Read live by the menu page (never part of a published snapshot, so a new story
 * shows without a publish); the rows come from a cache of at most a minute that saving a story expires.
 */
export interface StoryView {
  id: string;
  image: ImageItem;
  caption: string;
  /** The slug of the dish the story opens, when it has one that is still on the menu. */
  productSlug: string | null;
}

interface CachedRow extends Omit<StoryRow, 'expiresAt' | 'createdAt'> {
  expiresAt: string;
  createdAt: string;
}

async function readRows(menuId: string): Promise<CachedRow[]> {
  const rows = await menuDb(getPrisma(), menuId).menuStory.findMany({
    where: { isActive: true, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
    take: MAX_LIVE_STORIES * 2,
  });
  return rows.map((row) => ({
    id: row.id,
    assetId: row.assetId,
    productId: row.productId,
    captions: (row.captions ?? {}) as StoryRow['captions'],
    isActive: row.isActive,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  }));
}

function captionOf(captions: StoryRow['captions'], locale: Locale, defaultLocale: Locale): string {
  for (const candidate of [locale, defaultLocale, 'en', 'ar', 'ckb'] as const) {
    const value = captions[candidate];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return '';
}

export async function loadStories(tenant: TenantInfo, locale: Locale, catalog: Catalog, now: Date): Promise<StoryView[]> {
  const cachedRows = await cachedStoryRows(tenant.id, () => readRows(tenant.id));
  const rows = liveStories(
    cachedRows.map((row) => ({ ...row, expiresAt: new Date(row.expiresAt), createdAt: new Date(row.createdAt) })),
    now,
  );
  if (rows.length === 0) return [];

  const assets = await loadAssets(getPrisma(), tenant.restaurantId, rows.map((row) => row.assetId), ['IMAGE']);
  const mediaUrl = (key: string) => getStorage().publicUrl(key);
  const slugs = new Map(catalog.products.filter((product) => !product.isHidden).map((product) => [product.id, product.slug]));

  const views: StoryView[] = [];
  for (const row of rows) {
    const [item] = resolveDraftMedia([{ kind: 'asset', assetId: row.assetId }], assets, tenant.defaultLocale, mediaUrl);
    // A picture gone from the library is a story with nothing to show: it is left out rather than drawn empty.
    if ((item as { kind?: string } | undefined)?.kind !== 'image') continue;
    views.push({
      id: row.id,
      image: item as ImageItem,
      caption: captionOf(row.captions, locale, tenant.defaultLocale),
      productSlug: row.productId ? (slugs.get(row.productId) ?? null) : null,
    });
  }
  return views;
}
