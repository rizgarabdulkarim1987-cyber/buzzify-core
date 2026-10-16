import type { PrismaClient } from '@/generated/prisma/client';
import { isLocale, type Locale } from '@/lib/locale';
import { toVisualKey } from '@/server/domain/types';
import type {
  Catalog,
  CatalogGroup,
  CatalogProduct,
  Daypart,
  TranslationMap,
} from '@/server/domain/types';
import { cached } from './cache';
import { getPrisma } from './prisma';
import { menuDb } from './tenant-db';

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

/** Reads a menu's draft rows into the domain catalog. What guests see until publishing exists. */
export async function loadDraftCatalog(prisma: PrismaClient, menuId: string): Promise<Catalog> {
  const menu = await prisma.menu.findUniqueOrThrow({ where: { id: menuId } });
  const db = menuDb(prisma, menuId);

  const [categories, products, upsellRules, pairingRules, bundles, schedule] = await Promise.all([
    db.category.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
    db.product.findMany({
      // Deactivating a category pulls its products from sale, not just from the headings.
      where: { category: { isActive: true } },
      orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }],
      include: {
        variants: { orderBy: { sortOrder: 'asc' } },
        groups: { orderBy: { sortOrder: 'asc' }, include: { options: { orderBy: { sortOrder: 'asc' } } } },
      },
    }),
    db.upsellRule.findMany({ where: { isActive: true } }),
    db.pairingRule.findMany({ where: { isActive: true } }),
    db.bundle.findMany({ where: { isActive: true }, include: { items: true }, orderBy: { slug: 'asc' } }),
    db.daypartSchedule.findMany({ orderBy: { startMinute: 'asc' } }),
  ]);

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
      stockCount: p.stockCount,
      lowStockThreshold: p.lowStockThreshold,
      dayparts: p.dayparts as Daypart[],
      hideOutsideDaypart: p.hideOutsideDaypart,
      slot: p.slot,
      translations: translationMap(p.translations),
      media: Array.isArray(p.media) ? (p.media as unknown[]) : [],
      allergens: p.allergens,
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
    })),
    schedule: schedule.map((s) => ({
      daypart: s.daypart as Daypart,
      startMinute: s.startMinute,
      endMinute: s.endMinute,
      daysOfWeek: s.daysOfWeek,
    })),
  };
}

export function getCatalog(menuId: string): Promise<Catalog> {
  return cached(() => loadDraftCatalog(getPrisma(), menuId), ['catalog', menuId], {
    revalidate: 300,
    tags: [`catalog:${menuId}`],
  })();
}
