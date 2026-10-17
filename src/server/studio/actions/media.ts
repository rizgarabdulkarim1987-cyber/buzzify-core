import { z } from 'zod';
import { defineAction, type ActionContext } from '@/server/studio/framework/action';
import {
  assetIdField,
  deleteAssetRow,
  finalizeFields,
  finalizeUpload,
  requestUploadSlot,
  updateAssetRow,
  updateFields,
  uploadRequestFields,
} from '@/server/studio/services/media';

/**
 * The media library (spec 11). A restaurant's library: anyone who may add photos to its menus (`content.media`, which
 * owners hold) may upload; organizing and deleting needs `media.manage`. The shared library is the platform's, so all of
 * its actions need `media.manage` at platform level, which only Super Admins hold.
 */

const idField = z.string().min(1).max(100);
const atRestaurant = (restaurantId: string) => ({ kind: 'restaurant', restaurantId }) as const;
const PLATFORM = { kind: 'platform' } as const;
const SHARED = { restaurantId: null };

/** The library of a restaurant-target action. The framework has already resolved the restaurant. */
function libraryOf(ctx: ActionContext) {
  if (ctx.restaurantId === null) throw new Error('A media action ran without a restaurant');
  return { restaurantId: ctx.restaurantId };
}

// A restaurant's library ----------------------------------------------------------------------------------------------

export const requestUpload = defineAction({
  name: 'media.requestUpload',
  permission: 'content.media',
  input: z.object({ restaurantId: idField, ...uploadRequestFields }),
  target: (i) => atRestaurant(i.restaurantId),
  run: (ctx, input) => requestUploadSlot(libraryOf(ctx), input),
});

export const finalize = defineAction({
  name: 'media.finalize',
  permission: 'content.media',
  input: z.object({ restaurantId: idField, ...finalizeFields }),
  target: (i) => atRestaurant(i.restaurantId),
  run: (ctx, input) => finalizeUpload(ctx, libraryOf(ctx), input),
});

export const updateAsset = defineAction({
  name: 'media.update',
  permission: 'media.manage',
  input: z.object({ restaurantId: idField, ...updateFields }),
  target: (i) => atRestaurant(i.restaurantId),
  run: (ctx, input) => updateAssetRow(ctx, libraryOf(ctx), input),
});

export const deleteAsset = defineAction({
  name: 'media.delete',
  permission: 'media.manage',
  input: z.object({ restaurantId: idField, assetId: assetIdField }),
  target: (i) => atRestaurant(i.restaurantId),
  run: (ctx, input) => deleteAssetRow(ctx, libraryOf(ctx), input.assetId),
});

// The shared library --------------------------------------------------------------------------------------------------

export const requestSharedUpload = defineAction({
  name: 'media.requestSharedUpload',
  permission: 'media.manage',
  input: z.object(uploadRequestFields),
  target: () => PLATFORM,
  run: (_ctx, input) => requestUploadSlot(SHARED, input),
});

export const finalizeShared = defineAction({
  name: 'media.finalizeShared',
  permission: 'media.manage',
  input: z.object(finalizeFields),
  target: () => PLATFORM,
  run: (ctx, input) => finalizeUpload(ctx, SHARED, input),
});

export const updateSharedAsset = defineAction({
  name: 'media.updateShared',
  permission: 'media.manage',
  input: z.object(updateFields),
  target: () => PLATFORM,
  run: (ctx, input) => updateAssetRow(ctx, SHARED, input),
});

export const deleteSharedAsset = defineAction({
  name: 'media.deleteShared',
  permission: 'media.manage',
  input: z.object({ assetId: assetIdField }),
  target: () => PLATFORM,
  run: (ctx, input) => deleteAssetRow(ctx, SHARED, input.assetId),
});
