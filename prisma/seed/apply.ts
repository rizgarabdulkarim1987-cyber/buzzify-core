import type { PrismaClient } from '@/generated/prisma/client';
import { LOCALES } from '@/lib/locale';
import type { SeedData, Tri } from './atelier';

type TranslationJson = Record<string, Record<string, string>>;

function translations(fields: Record<string, Tri>): TranslationJson {
  const out: TranslationJson = {};
  for (const locale of LOCALES) {
    out[locale] = {};
    for (const [field, tri] of Object.entries(fields)) out[locale]![field] = tri[locale];
  }
  return out;
}

/**
 * Writes a menu's draft catalog under an existing restaurant, replacing any menu with the same slug. The menu is a
 * DRAFT: guests see it once it is published (`publishMenu`), as `prisma/seed.ts` does next.
 */
export async function seedMenu(prisma: PrismaClient, data: SeedData, restaurantId: string): Promise<{ menuId: string }> {
  await prisma.menu.deleteMany({ where: { slug: data.restaurant.slug } });

  const r = data.restaurant;
  const menu = await prisma.menu.create({
    data: {
      restaurantId,
      name: r.name,
      slug: r.slug,
      currency: r.currency,
      defaultLocale: r.defaultLocale,
      locales: r.locales,
      timezone: r.timezone,
      numeralSystem: r.numeralSystem,
      engineConfig: {},
      domains: { create: r.domains.map((host) => ({ host })) },
      brand: {
        create: {
          tokens: data.brand.tokens as unknown as Record<string, Record<string, string>>,
          typography: data.brand.typography,
          theme: data.brand.theme,
          motionIntensity: data.brand.motionIntensity,
          navStyle: data.brand.navStyle,
          railStyle: data.brand.railStyle,
          fontPairId: data.brand.fontPairId,
          logoText: data.brand.logoText,
        },
      },
    },
  });
  const menuId = menu.id;

  const categoryIds = new Map<string, string>();
  for (const [index, category] of data.categories.entries()) {
    const row = await prisma.category.create({
      data: { menuId, slug: category.slug, sortOrder: index, translations: translations({ name: category.name }) },
    });
    categoryIds.set(category.slug, row.id);
  }

  const productIds = new Map<string, string>();
  for (const [index, product] of data.products.entries()) {
    const row = await prisma.product.create({
      data: {
        menuId,
        categoryId: categoryIds.get(product.category) as string,
        slug: product.slug,
        basePrice: product.price,
        cost: product.cost,
        popularity: product.popularity,
        priority: product.priority,
        isSignature: product.signature ?? false,
        isFeatured: product.featured ?? false,
        stockCount: product.stock ?? null,
        lowStockThreshold: product.lowStock ?? null,
        dayparts: product.dayparts ?? [],
        hideOutsideDaypart: product.hideOutsideDaypart ?? false,
        slot: product.slot ?? null,
        allergens: product.allergens,
        dietary: product.dietary ?? [],
        badges: product.badges ?? [],
        ingredients: product.ingredients as unknown as Record<string, string[]>,
        media: [{ kind: 'art', art: product.art, tone: product.tone, ...(product.model ? { model: product.model } : {}) }],
        translations: translations({ name: product.name, description: product.description }),
        sortOrder: index,
        variants: {
          create: (product.variants ?? []).map((variant, order) => ({
            menuId,
            priceDelta: variant.priceDelta,
            costDelta: variant.costDelta,
            isDefault: variant.isDefault ?? false,
            translations: translations({ name: variant.name }),
            sortOrder: order,
          })),
        },
        groups: {
          create: (product.groups ?? []).map((group, order) => ({
            menuId,
            minSelect: group.min,
            maxSelect: group.max,
            translations: translations({ name: group.name }),
            sortOrder: order,
            options: {
              create: group.options.map((option, optionOrder) => ({
                menuId,
                priceDelta: option.priceDelta,
                costDelta: option.costDelta,
                isSuggested: option.suggested ?? false,
                suggestPriority: option.suggestPriority ?? 50,
                visualKey: option.visualKey ?? null,
                translations: translations({
                  name: option.name,
                  ...(option.effect ? { effect: option.effect } : {}),
                }),
                sortOrder: optionOrder,
              })),
            },
          })),
        },
      },
    });
    productIds.set(product.slug, row.id);
  }

  const productId = (slug: string) => productIds.get(slug) as string;

  for (const rule of data.pairingRules) {
    const bySource = rule.source;
    await prisma.pairingRule.create({
      data: {
        menuId,
        sourceType: 'product' in bySource ? 'PRODUCT' : 'CATEGORY',
        sourceProductId: 'product' in bySource ? productId(bySource.product) : null,
        sourceCategoryId: 'category' in bySource ? (categoryIds.get(bySource.category) as string) : null,
        targetProductId: productId(rule.target),
        weight: rule.weight,
        dayparts: rule.dayparts ?? [],
        translations: translations({ reason: rule.reason }),
      },
    });
  }

  for (const rule of data.upsellRules) {
    await prisma.upsellRule.create({
      data: {
        menuId,
        sourceProductId: productId(rule.source),
        targetProductId: productId(rule.target),
        priority: rule.priority,
        translations: translations({ pitch: rule.pitch, effect: rule.effect }),
      },
    });
  }

  for (const bundle of data.bundles) {
    await prisma.bundle.create({
      data: {
        menuId,
        slug: bundle.slug,
        price: bundle.price,
        dayparts: bundle.dayparts ?? [],
        translations: translations({ name: bundle.name, description: bundle.description }),
        items: {
          create: bundle.items.map((item) => ({
            menuId,
            productId: productId(item.product),
            variantId: null,
            quantity: item.quantity,
          })),
        },
      },
    });
  }

  await prisma.daypartSchedule.createMany({
    data: data.schedule.map((window) => ({ menuId, ...window })),
  });
  await prisma.table.createMany({
    data: data.tables.map((number) => ({
      menuId,
      number,
      label: `Table ${String(number).padStart(2, '0')}`,
    })),
  });

  return { menuId };
}
