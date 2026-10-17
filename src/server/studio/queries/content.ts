import { z } from 'zod';
import type { MediaKind } from '@/generated/prisma/client';
import { isLocale, type Locale } from '@/lib/locale';
import type { DraftMediaItem } from '@/lib/media';
import type { Allergen, Badge, DietaryTag } from '@/lib/product-tags';
import type { AssetVariants } from '@/server/media/process';
import { mediaAssetIds } from '@/server/media/resolve';
import { getStorage } from '@/server/storage/storage';
import { defineQuery, type QueryContext } from '@/server/studio/framework/query';
import { StudioError } from '@/server/studio/framework/result';
import { idField, missingIn, textsOf, type ContentTree, type ProductEditing } from '@/server/studio/services/content';
import { thumbKey } from '@/server/studio/services/media';

/**
 * What the Content tab reads: the menu's categories with their products, and one product as its drawer edits it. Both
 * read the draft, keyed by the target menu's id.
 */

const atMenu = (menuId: string) => ({ kind: 'menu', menuId }) as const;

function menuOf(ctx: QueryContext): string {
  if (ctx.menuId === null) throw new Error('A menu query ran without a menu');
  return ctx.menuId;
}

async function menuLanguages(ctx: QueryContext, menuId: string) {
  const menu = await ctx.db.menu.findUnique({
    where: { id: menuId },
    select: { locales: true, defaultLocale: true, currency: true, numeralSystem: true, restaurantId: true },
  });
  if (!menu) throw new StudioError('NOT_FOUND');
  return { ...menu, locales: menu.locales.filter(isLocale), defaultLocale: isLocale(menu.defaultLocale) ? menu.defaultLocale : 'en' };
}

/**
 * The address of a small picture for each media entry: a library asset's narrowest WebP, an image's own URL, nothing for
 * drawings and 3D models. Assets are looked up in the restaurant's library and the shared one only.
 */
async function thumbnails(ctx: QueryContext, restaurantId: string, lists: readonly unknown[][]): Promise<(entry: unknown) => string | null> {
  const ids = [...new Set(lists.flatMap((media) => mediaAssetIds(media)))];
  const rows =
    ids.length === 0
      ? []
      : await ctx.db.mediaAsset.findMany({
          where: { id: { in: ids }, OR: [{ restaurantId }, { restaurantId: null }] },
          select: { id: true, kind: true, variants: true },
        });
  const storage = rows.length > 0 ? getStorage() : null;
  const urls = new Map(rows.map((row) => [row.id, storage!.publicUrl(thumbKey(row.kind as MediaKind, row.variants as unknown as AssetVariants))]));
  return (entry) => {
    const value = entry as { kind?: unknown; assetId?: unknown; url?: unknown } | null;
    if (value?.kind === 'asset' && typeof value.assetId === 'string') return urls.get(value.assetId) ?? null;
    if (value?.kind === 'image' && typeof value.url === 'string') return value.url;
    return null;
  };
}

const asList = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export const tree = defineQuery({
  name: 'content.tree',
  permission: 'content.edit',
  input: z.object({ menuId: idField }),
  target: (i) => atMenu(i.menuId),
  run: async (ctx): Promise<ContentTree> => {
    const menuId = menuOf(ctx);
    const menu = await menuLanguages(ctx, menuId);
    const order = [{ sortOrder: 'asc' as const }, { id: 'asc' as const }];
    const categories = await ctx.db.category.findMany({ where: { menuId }, orderBy: order });
    const products = await ctx.db.product.findMany({
      where: { menuId },
      orderBy: order,
      select: {
        id: true,
        categoryId: true,
        slug: true,
        version: true,
        translations: true,
        basePrice: true,
        isAvailable: true,
        isHidden: true,
        isSignature: true,
        isFeatured: true,
        badges: true,
        media: true,
      },
    });
    const thumb = await thumbnails(ctx, menu.restaurantId, products.map((product) => asList(product.media).slice(0, 1)));

    return {
      locales: menu.locales,
      defaultLocale: menu.defaultLocale,
      currency: menu.currency,
      numeralSystem: menu.numeralSystem,
      categories: categories.map((category) => {
        const names = textsOf(category.translations, 'name');
        return {
          id: category.id,
          slug: category.slug,
          version: category.version,
          names,
          isActive: category.isActive,
          missing: missingIn(menu.locales, names),
          products: products
            .filter((product) => product.categoryId === category.id)
            .map((product) => {
              const productNames = textsOf(product.translations, 'name');
              const first = asList(product.media)[0];
              return {
                id: product.id,
                slug: product.slug,
                version: product.version,
                names: productNames,
                price: product.basePrice,
                isAvailable: product.isAvailable,
                isHidden: product.isHidden,
                isSignature: product.isSignature,
                isFeatured: product.isFeatured,
                badges: product.badges as Badge[],
                thumbUrl: first === undefined ? null : thumb(first),
                missing: missingIn(menu.locales, productNames),
              };
            }),
        };
      }),
    };
  },
});

export const product = defineQuery({
  name: 'content.product',
  permission: 'content.edit',
  input: z.object({ menuId: idField, productId: idField }),
  target: (i) => atMenu(i.menuId),
  run: async (ctx, input): Promise<ProductEditing> => {
    const menuId = menuOf(ctx);
    const menu = await menuLanguages(ctx, menuId);
    const row = await ctx.db.product.findFirst({
      where: { id: input.productId, menuId },
      include: {
        variants: { orderBy: { sortOrder: 'asc' } },
        groups: { orderBy: { sortOrder: 'asc' }, include: { options: { orderBy: { sortOrder: 'asc' } } } },
      },
    });
    if (!row) throw new StudioError('NOT_FOUND');
    const media = asList(row.media) as DraftMediaItem[];
    const thumb = await thumbnails(ctx, menu.restaurantId, [media]);
    const names = textsOf(row.translations, 'name');
    const descriptions = textsOf(row.translations, 'description');

    const ingredients: Partial<Record<Locale, string[]>> = {};
    for (const [locale, list] of Object.entries((row.ingredients ?? {}) as Record<string, unknown>)) {
      if (isLocale(locale) && Array.isArray(list)) ingredients[locale] = list.filter((entry): entry is string => typeof entry === 'string');
    }

    return {
      id: row.id,
      version: row.version,
      slug: row.slug,
      categoryId: row.categoryId,
      names,
      descriptions,
      ingredients,
      price: row.basePrice,
      isSignature: row.isSignature,
      isFeatured: row.isFeatured,
      allergens: row.allergens as Allergen[],
      dietary: row.dietary as DietaryTag[],
      badges: row.badges as Badge[],
      calories: row.calories,
      media: media.map((value) => ({ value, thumbUrl: thumb(value) })),
      variants: row.variants.map((variant) => ({
        id: variant.id,
        version: variant.version,
        names: textsOf(variant.translations, 'name'),
        priceDelta: variant.priceDelta,
        isDefault: variant.isDefault,
      })),
      groups: row.groups.map((group) => ({
        id: group.id,
        version: group.version,
        names: textsOf(group.translations, 'name'),
        minSelect: group.minSelect,
        maxSelect: group.maxSelect,
        options: group.options.map((option) => ({
          id: option.id,
          version: option.version,
          names: textsOf(option.translations, 'name'),
          priceDelta: option.priceDelta,
          isSuggested: option.isSuggested,
        })),
      })),
      missing: { names: missingIn(menu.locales, names), descriptions: missingIn(menu.locales, descriptions) },
    };
  },
});
