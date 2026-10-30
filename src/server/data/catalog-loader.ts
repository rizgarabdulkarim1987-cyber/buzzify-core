import { isLocale, type Locale } from '@/lib/locale';
import { menuPriceStep } from '@/server/domain/bulk-prices';
import { toVisualKey } from '@/server/domain/types';
import type {
  Catalog,
  CatalogGroup,
  CatalogProduct,
  Daypart,
  TranslationMap,
} from '@/server/domain/types';
import { delegates, type AnyDb, type ScopedDb } from './tenant-db';

function translationMap(value: unknown): TranslationMap {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as TranslationMap) : {};
}

function ingredientMap(value: unknown): Partial<Record<Locale, string[]>> {
  const result: Partial<Record<Locale, string[]>> = {};
  if (!value || typeof value !== 'object') return result;
  for (const [key, entry] of Object.entries(value)) {
    if (isLocale(key) && Array.isArray(entry)) result[key] = entry.filter((v): v is string => typeof v === 'string');
  }
  return result;
}

/**
 * Reads a menu's draft rows into the domain catalog: what publishing freezes into a revision. Guests never see this
 * directly; they see the live revision (`src/server/data/public-menu.ts`).
 *
 * Every query names the menu itself, so this works on any client, including a transaction (which cannot be scoped
 * after the fact). The queries run one after another because a transaction has a single connection. Rows that share a
 * sort order fall back to id order, so the same draft always loads, and hashes, the same way.
 */
export function loadDraftCatalog(db: AnyDb, menuId: string): Promise<Catalog>;
export function loadDraftCatalog(db: ScopedDb, menuId: string): Promise<Catalog>;
export async function loadDraftCatalog(client: AnyDb | ScopedDb, menuId: string): Promise<Catalog> {
  const db = delegates(client);
  const menu = await db.menu.findUniqueOrThrow({ where: { id: menuId } });
  const bySortOrder = [{ sortOrder: 'asc' as const }, { id: 'asc' as const }];

  const categories = await db.category.findMany({ where: { menuId, isActive: true }, orderBy: { sortOrder: 'asc' } });
  const products = await db.product.findMany({
    // Deactivating a category pulls its products from sale, not just from the headings.
    where: { menuId, category: { isActive: true } },
    orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }],
    include: {
      variants: { orderBy: bySortOrder },
      groups: { orderBy: bySortOrder, include: { options: { orderBy: bySortOrder } } },
    },
  });
  const upsellRules = await db.upsellRule.findMany({ where: { menuId, isActive: true } });
  const pairingRules = await db.pairingRule.findMany({ where: { menuId, isActive: true } });
  const bundles = await db.bundle.findMany({
    where: { menuId, isActive: true },
    include: { items: { orderBy: { id: 'asc' } } },
    orderBy: { slug: 'asc' },
  });
  const promotions = await db.promotion.findMany({ where: { menuId, isActive: true }, orderBy: bySortOrder });
  // Occasions load switched off too: whether one is on is part of what decides its cards (`isOccasionLive`).
  const occasions = await db.occasion.findMany({ where: { menuId }, orderBy: bySortOrder });
  // A card is loaded only with what it points at: one on an offer or set that is switched off (or an occasion that is
  // gone) could never show, and a snapshot holding it without its offer or set could not be restored.
  const ids = (rows: Array<{ id: string }>) => new Set(rows.map((row) => row.id));
  const [promotionIds, bundleIds, occasionIds] = [ids(promotions), ids(bundles), ids(occasions)];
  const holds = (set: Set<string>, id: string | null) => id === null || set.has(id);
  const showcaseCards = (await db.showcaseCard.findMany({ where: { menuId, isActive: true }, orderBy: bySortOrder })).filter(
    (card) => holds(promotionIds, card.promotionId) && holds(bundleIds, card.bundleId) && holds(occasionIds, card.occasionId),
  );
  const schedule = await db.daypartSchedule.findMany({ where: { menuId }, orderBy: { startMinute: 'asc' } });
  const roundTo = menuPriceStep(menu);

  return {
    menuId,
    currency: menu.currency,
    timeZone: menu.timezone,
    defaultLocale: isLocale(menu.defaultLocale) ? menu.defaultLocale : 'en',
    categories: categories.map((c) => ({
      id: c.id,
      slug: c.slug,
      sortOrder: c.sortOrder,
      translations: translationMap(c.translations),
      completesMeal: c.completesMeal,
    })),
    products: products.map<CatalogProduct>((p) => ({
      id: p.id,
      categoryId: p.categoryId,
      slug: p.slug,
      basePrice: p.basePrice,
      cost: p.cost,
      popularity: p.popularity,
      priority: p.priority,
      isSignature: p.isSignature,
      isFeatured: p.isFeatured,
      isAvailable: p.isAvailable,
      isHidden: p.isHidden,
      stockCount: p.stockCount,
      lowStockThreshold: p.lowStockThreshold,
      dayparts: p.dayparts as Daypart[],
      hideOutsideDaypart: p.hideOutsideDaypart,
      slot: p.slot,
      translations: translationMap(p.translations),
      media: Array.isArray(p.media) ? (p.media as unknown[]) : [],
      allergens: p.allergens,
      dietary: p.dietary,
      calories: p.calories,
      serves: p.serves,
      badges: p.badges,
      ingredients: ingredientMap(p.ingredients),
      sortOrder: p.sortOrder,
      variants: p.variants.map((v) => ({
        id: v.id,
        productId: v.productId,
        priceDelta: v.priceDelta,
        costDelta: v.costDelta,
        isDefault: v.isDefault,
        translations: translationMap(v.translations),
      })),
      groups: p.groups.map<CatalogGroup>((g) => ({
        id: g.id,
        productId: g.productId,
        minSelect: g.minSelect,
        maxSelect: g.maxSelect,
        translations: translationMap(g.translations),
        options: g.options.map((o) => ({
          id: o.id,
          groupId: o.groupId,
          priceDelta: o.priceDelta,
          costDelta: o.costDelta,
          isSuggested: o.isSuggested,
          suggestPriority: o.suggestPriority,
          isAvailable: o.isAvailable,
          visualKey: toVisualKey(o.visualKey),
          translations: translationMap(o.translations),
        })),
      })),
    })),
    upsellRules: upsellRules.map((r) => ({
      id: r.id,
      sourceProductId: r.sourceProductId,
      targetProductId: r.targetProductId,
      priority: r.priority,
      dayparts: r.dayparts as Daypart[],
      translations: translationMap(r.translations),
    })),
    pairingRules: pairingRules.map((r) => ({
      id: r.id,
      sourceType: r.sourceType,
      sourceProductId: r.sourceProductId,
      sourceCategoryId: r.sourceCategoryId,
      targetProductId: r.targetProductId,
      weight: r.weight,
      dayparts: r.dayparts as Daypart[],
      translations: translationMap(r.translations),
    })),
    bundles: bundles.map((b) => ({
      id: b.id,
      slug: b.slug,
      price: b.price,
      dayparts: b.dayparts as Daypart[],
      translations: translationMap(b.translations),
      items: b.items.map((i) => ({ productId: i.productId, variantId: i.variantId, quantity: i.quantity })),
      people: b.people,
    })),
    promotions: promotions.map((p) => ({
      id: p.id,
      kind: p.kind,
      percentOff: p.percentOff,
      productIds: p.productIds,
      categoryIds: p.categoryIds,
      startsOn: p.startsOn,
      endsOn: p.endsOn,
      startMinute: p.startMinute,
      endMinute: p.endMinute,
      daysOfWeek: p.daysOfWeek,
      roundTo,
      translations: translationMap(p.translations),
      sortOrder: p.sortOrder,
    })),
    occasions: occasions.map((o) => ({
      id: o.id,
      startsOn: o.startsOn,
      endsOn: o.endsOn,
      isActive: o.isActive,
      translations: translationMap(o.translations),
    })),
    showcaseCards: showcaseCards.map((c) => ({
      id: c.id,
      slot: c.slot,
      kind: c.kind,
      sortOrder: c.sortOrder,
      occasionId: c.occasionId,
      promotionId: c.promotionId,
      bundleId: c.bundleId,
      price: c.price,
      startMinute: c.startMinute,
      endMinute: c.endMinute,
      daysOfWeek: c.daysOfWeek,
      translations: translationMap(c.translations),
    })),
    schedule: schedule.map((s) => ({
      daypart: s.daypart as Daypart,
      startMinute: s.startMinute,
      endMinute: s.endMinute,
      daysOfWeek: s.daysOfWeek,
    })),
  };
}
