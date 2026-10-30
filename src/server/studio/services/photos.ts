import { z } from 'zod';
import { loadAssets } from '@/server/media/resolve';
import type { ActionContext } from '@/server/studio/framework/action';
import { StudioError } from '@/server/studio/framework/result';
import { editDraft } from './draft-edit';

/**
 * Pictures for many dishes at once (Import and export tab): each uploaded photo is matched to the dish whose address is
 * the file's name without its extension (`adana-kebab.jpg` is for `adana-kebab`) and becomes that dish's picture. A dish
 * that already has a picture keeps it unless the person asked to replace them.
 */

export const MAX_PHOTOS_PER_CALL = 50;

export const attachPhotosFields = {
  photos: z
    .array(z.object({ fileName: z.string().trim().min(1).max(200), assetId: z.string().min(1).max(100) }))
    .min(1)
    .max(MAX_PHOTOS_PER_CALL),
  replace: z.boolean().default(false),
};

export interface AttachedPhotos {
  attached: string[];
  /** Dishes that already had a picture. */
  kept: string[];
  /** File names that match no dish of the menu. */
  unmatched: string[];
}

/** A file name's dish address: the name without its extension, in lower case. */
export function addressOfFile(fileName: string): string {
  const name = fileName.split(/[\\/]/).pop() ?? fileName;
  const dot = name.lastIndexOf('.');
  return (dot > 0 ? name.slice(0, dot) : name).trim().toLowerCase();
}

export function attachPhotos(ctx: ActionContext, input: { photos: Array<{ fileName: string; assetId: string }>; replace: boolean }): Promise<AttachedPhotos> {
  const restaurantId = ctx.restaurantId;
  if (restaurantId === null) throw new Error('A menu action ran without a restaurant');

  return editDraft(ctx, async (tx, menuId) => {
    const assetIds = [...new Set(input.photos.map((photo) => photo.assetId))];
    const found = await loadAssets(tx, restaurantId, assetIds, ['IMAGE']);
    if (assetIds.some((id) => !found.has(id))) throw new StudioError('NOT_FOUND');

    const products = await tx.product.findMany({ where: { menuId }, select: { id: true, slug: true, media: true } });
    const bySlug = new Map(products.map((product) => [product.slug.toLowerCase(), product]));
    const result: AttachedPhotos = { attached: [], kept: [], unmatched: [] };
    for (const photo of input.photos) {
      const product = bySlug.get(addressOfFile(photo.fileName));
      if (!product) {
        result.unmatched.push(photo.fileName);
        continue;
      }
      if (!input.replace && Array.isArray(product.media) && product.media.length > 0) {
        result.kept.push(product.slug);
        continue;
      }
      await tx.product.update({ where: { id: product.id }, data: { media: [{ kind: 'asset', assetId: photo.assetId }], version: { increment: 1 } } });
      product.media = [{ kind: 'asset', assetId: photo.assetId }];
      result.attached.push(product.slug);
      ctx.audit({ action: 'product.updated', entityType: 'Product', entityId: product.id, changes: { media: { before: null, after: photo.assetId } } });
    }
    return result;
  });
}
