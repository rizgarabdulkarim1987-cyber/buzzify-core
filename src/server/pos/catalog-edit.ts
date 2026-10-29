import type { DraftMediaItem } from '@/lib/media';
import type { ActionContext } from '@/server/studio/framework/action';
import { StudioError } from '@/server/studio/framework/result';
import { saveProduct, textsOf, type ProductSave, type Texts } from '@/server/studio/services/content';

/**
 * What the till's catalog page changes about a product: its name, price and category. It is the Studio's own `saveProduct`
 * (versions, slugs, audit, draft hash), fed the product as it already is with these three replaced, so sizes, option
 * groups, pictures and tags are carried through untouched. Their editing stays in the Studio's product editor.
 */
async function productSave(ctx: ActionContext, productId: string, version: number): Promise<ProductSave> {
  const row = await ctx.db.product.findFirst({
    where: { id: productId },
    include: {
      variants: { orderBy: { sortOrder: 'asc' } },
      groups: { orderBy: { sortOrder: 'asc' }, include: { options: { orderBy: { sortOrder: 'asc' } } } },
    },
  });
  if (!row) throw new StudioError('NOT_FOUND');
  const save: ProductSave = {
    productId: row.id,
    version,
    slug: row.slug,
    categoryId: row.categoryId,
    names: textsOf(row.translations, 'name'),
    descriptions: textsOf(row.translations, 'description'),
    price: row.basePrice,
    isSignature: row.isSignature,
    isFeatured: row.isFeatured,
    allergens: row.allergens as ProductSave['allergens'],
    dietary: row.dietary as ProductSave['dietary'],
    badges: row.badges as ProductSave['badges'],
    calories: row.calories,
    media: (Array.isArray(row.media) ? row.media : []) as DraftMediaItem[],
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
  };
  return save;
}

export async function saveProductBasics(
  ctx: ActionContext,
  input: { productId: string; version: number; names: Texts; price: number; categoryId: string },
): Promise<{ version: number }> {
  const save = await productSave(ctx, input.productId, input.version);
  const saved = await saveProduct(ctx, { ...save, categoryId: input.categoryId, names: input.names, price: input.price });
  return { version: saved.version };
}

/**
 * Makes a library picture the product's main one (the first, which the menu and the till show). A main picture it had
 * before is replaced; drawings, videos and any further pictures stay behind it.
 */
export async function setProductPicture(ctx: ActionContext, input: { productId: string; version: number; assetId: string }): Promise<{ version: number }> {
  const save = await productSave(ctx, input.productId, input.version);
  const first = save.media[0];
  const rest = first && (first.kind === 'asset' || first.kind === 'image') ? save.media.slice(1) : save.media;
  const saved = await saveProduct(ctx, { ...save, media: [{ kind: 'asset', assetId: input.assetId }, ...rest] });
  return { version: saved.version };
}
