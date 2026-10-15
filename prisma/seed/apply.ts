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

export async function seedRestaurant(prisma: PrismaClient, data: SeedData): Promise<{ restaurantId: string }> {
  await prisma.restaurant.deleteMany({ where: { slug: data.restaurant.slug } });

  const r = data.restaurant;
  const restaurant = await prisma.restaurant.create({
    data: {
      slug: r.slug,
      name: r.name,
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
          logoText: data.brand.logoText,
        },
      },
    },
  });
  const restaurantId = restaurant.id;

  const categoryIds = new Map<string, string>();
  for (const [index, category] of data.categories.entries()) {
    const row = await prisma.category.create({
      data: { restaurantId, slug: category.slug, sortOrder: index, translations: translations({ name: category.name }) },
    });
    categoryIds.set(category.slug, row.id);
  }

  const productIds = new Map<string, string>();
  for (const [index, product] of data.products.entries()) {
    const row = await prisma.product.create({
      data: {
        restaurantId,
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
        ingredients: product.ingredients as unknown as Record<string, string[]>,
        media: [{ kind: 'art', art: product.art, tone: product.tone }],
        translations: translations({ name: product.name, description: product.description }),
        sortOrder: index,
        variants: {
          create: (product.variants ?? []).map((variant, order) => ({
            restaurantId,
            priceDelta: variant.priceDelta,
            costDelta: variant.costDelta,
            isDefault: variant.isDefault ?? false,
            translations: translations({ name: variant.name }),
            sortOrder: order,
          })),
        },
        groups: {
          create: (product.groups ?? []).map((group, order) => ({
            restaurantId,
            minSelect: group.min,
            maxSelect: group.max,
            translations: translations({ name: group.name }),
            sortOrder: order,
            options: {
              create: group.options.map((option, optionOrder) => ({
                restaurantId,
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
        restaurantId,
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
        restaurantId,
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
        restaurantId,
        slug: bundle.slug,
        price: bundle.price,
        dayparts: bundle.dayparts ?? [],
        translations: translations({ name: bundle.name, description: bundle.description }),
        items: {
          create: bundle.items.map((item) => ({
            restaurantId,
            productId: productId(item.product),
            variantId: null,
            quantity: item.quantity,
          })),
        },
      },
    });
  }

  await prisma.daypartSchedule.createMany({
    data: data.schedule.map((window) => ({ restaurantId, ...window })),
  });
  await prisma.table.createMany({
    data: data.tables.map((number) => ({
      restaurantId,
      number,
      label: `Table ${String(number).padStart(2, '0')}`,
    })),
  });

  return { restaurantId };
}
