import { createHash } from 'node:crypto';
import type { Locale } from '@/lib/locale';
import { LOCALES } from '@/lib/locale';
import type { Catalog, TranslationMap } from '@/server/domain/types';

/**
 * The published catalog as the cashier reads it (contract 5.2): the live revision with today's availability laid over
 * it, reshaped, with nothing the cashier has no business seeing (cost, stock counters, media, descriptions, sales tools).
 * Hidden products are already gone from a served catalog; sold-out ones stay and say so.
 */

export const MAX_FEED_CATEGORIES = 200;
export const MAX_FEED_PRODUCTS = 2000;

export type FeedNames = Partial<Record<Locale, string>>;

export interface CatalogFeed {
  contractVersion: 1;
  etag: string;
  link: { status: 'ACTIVE'; menuPlanActive: boolean };
  menu: { id: string; slug: string; publicBaseUrl: string; currency: 'IQD'; defaultLocale: Locale; locales: Locale[] };
  revision: { number: number; hash: string; wentLiveAt: string };
  categories: { id: string; sortOrder: number; name: FeedNames }[];
  products: {
    id: string;
    categoryId: string;
    sortOrder: number;
    price: number;
    name: FeedNames;
    state: 'ACTIVE' | 'SOLD_OUT';
    variants: { id: string; priceDelta: number; isDefault: boolean; sortOrder: number; name: FeedNames }[];
    groups: {
      id: string;
      sortOrder: number;
      minSelect: number;
      maxSelect: number;
      name: FeedNames;
      options: { id: string; priceDelta: number; available: boolean; sortOrder: number; name: FeedNames }[];
    }[];
  }[];
}

export class CatalogFeedError extends Error {
  constructor(readonly code: 'currencyMismatch' | 'catalogTooLarge') {
    super(code === 'currencyMismatch' ? 'The menu is not in IQD' : 'The catalog is too large for the link');
    this.name = 'CatalogFeedError';
  }
}

function names(map: TranslationMap | null | undefined, field = 'name'): FeedNames {
  const out: FeedNames = {};
  for (const locale of LOCALES) {
    const value = map?.[locale]?.[field];
    if (typeof value === 'string' && value.trim() !== '') out[locale] = value;
  }
  return out;
}

/**
 * Changes on a publish (the snapshot hash) and on any sold-out change (the availability of every product and option
 * in the served catalog), and on nothing else.
 */
export function catalogEtag(snapshotHash: string, catalog: Catalog): string {
  const products = catalog.products.map((p) => [p.id, p.isAvailable, p.groups.flatMap((g) => g.options.map((o) => [o.id, o.isAvailable]))]);
  return createHash('sha256').update(`${snapshotHash}|${JSON.stringify(products)}`).digest('hex');
}

export interface FeedInput {
  catalog: Catalog;
  menu: { id: string; slug: string; publicBaseUrl: string; defaultLocale: Locale; locales: Locale[] };
  revision: { number: number; hash: string; wentLiveAt: Date };
  menuPlanActive: boolean;
}

export function buildCatalogFeed({ catalog, menu, revision, menuPlanActive }: FeedInput): CatalogFeed {
  if (catalog.currency !== 'IQD') throw new CatalogFeedError('currencyMismatch');
  if (catalog.categories.length > MAX_FEED_CATEGORIES || catalog.products.length > MAX_FEED_PRODUCTS) {
    throw new CatalogFeedError('catalogTooLarge');
  }
  return {
    contractVersion: 1,
    etag: catalogEtag(revision.hash, catalog),
    link: { status: 'ACTIVE', menuPlanActive },
    menu: { id: menu.id, slug: menu.slug, publicBaseUrl: menu.publicBaseUrl, currency: 'IQD', defaultLocale: menu.defaultLocale, locales: menu.locales },
    revision: { number: revision.number, hash: revision.hash, wentLiveAt: revision.wentLiveAt.toISOString() },
    categories: catalog.categories.map((c) => ({ id: c.id, sortOrder: c.sortOrder, name: names(c.translations) })),
    products: catalog.products.map((p) => {
      const name = names(p.translations);
      return {
        id: p.id,
        categoryId: p.categoryId,
        sortOrder: p.sortOrder,
        price: p.basePrice,
        // A product always has a name; the slug is the last resort so the cashier never meets an empty one.
        name: Object.keys(name).length > 0 ? name : { en: p.slug },
        state: p.isAvailable ? ('ACTIVE' as const) : ('SOLD_OUT' as const),
        variants: p.variants.map((v, index) => ({ id: v.id, priceDelta: v.priceDelta, isDefault: v.isDefault, sortOrder: index, name: names(v.translations) })),
        groups: p.groups.map((g, gi) => ({
          id: g.id,
          sortOrder: gi,
          minSelect: g.minSelect,
          maxSelect: Math.max(1, g.maxSelect),
          name: names(g.translations),
          options: g.options.map((o, oi) => ({ id: o.id, priceDelta: o.priceDelta, available: o.isAvailable, sortOrder: oi, name: names(o.translations) })),
        })),
      };
    }),
  };
}
