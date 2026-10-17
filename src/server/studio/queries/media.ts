import { z } from 'zod';
import { assetUsage, type AssetUsage } from '@/server/media/usage';
import { defineQuery } from '@/server/studio/framework/query';
import { StudioError } from '@/server/studio/framework/result';
import { assetIdField, listLibrary } from '@/server/studio/services/media';
import { permissionsIn } from '@/server/studio/services/menus';

/**
 * Reading the media library. A member of a restaurant sees its library with the shared one beside it (to pick photos
 * from either); anyone signed in may browse the shared library. Where the shared library's assets are used spans every
 * restaurant, so that is the platform's to read.
 */

const idField = z.string().min(1).max(100);
const pageField = z.number().int().min(1).max(100_000).default(1);

export const listMedia = defineQuery({
  name: 'media.list',
  permission: 'view',
  input: z.object({
    restaurantId: idField.optional(),
    folder: z.string().trim().max(60).optional(),
    tag: z.string().trim().max(40).optional(),
    q: z.string().trim().max(100).optional(),
    page: pageField,
    /** The restaurant's own assets only, without the shared ones beside them. */
    own: z.boolean().optional(),
  }),
  target: (i) => (i.restaurantId ? ({ kind: 'restaurant', restaurantId: i.restaurantId } as const) : ({ kind: 'platform' } as const)),
  run: (ctx, input) => listLibrary(ctx.db, { restaurantId: ctx.restaurantId }, input),
});

/**
 * The libraries a person may manage: the restaurants where they hold `media.manage`, and whether they may change the
 * shared one (Super Admins). The Media page offers these.
 */
export const libraries = defineQuery({
  name: 'media.libraries',
  permission: 'view',
  input: z.object({}),
  target: () => ({ kind: 'platform' }),
  run: async (ctx) => {
    const found = await ctx.db.restaurant.findMany({
      where: ctx.scope.kind === 'all' ? {} : { id: { in: ctx.scope.ids } },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true, permissionPolicy: true },
    });
    return {
      restaurants: found.filter((row) => permissionsIn(ctx.actor, row).has('media.manage')).map((row) => ({ id: row.id, name: row.name })),
      sharedEditable: ctx.actor.isSuperAdmin,
    };
  },
});

export const usage = defineQuery({
  name: 'media.usage',
  permission: 'view',
  input: z.object({ restaurantId: idField, assetId: assetIdField }),
  target: (i) => ({ kind: 'restaurant', restaurantId: i.restaurantId }),
  run: async (ctx, input): Promise<AssetUsage> => {
    const row = await ctx.db.mediaAsset.findFirst({ where: { id: input.assetId, restaurantId: ctx.restaurantId }, select: { id: true, restaurantId: true } });
    if (!row) throw new StudioError('NOT_FOUND');
    return assetUsage(ctx.db, row);
  },
});

export const sharedUsage = defineQuery({
  name: 'media.sharedUsage',
  permission: 'media.manage',
  input: z.object({ assetId: assetIdField }),
  target: () => ({ kind: 'platform' }),
  run: async (ctx, input): Promise<AssetUsage> => {
    const row = await ctx.db.mediaAsset.findFirst({ where: { id: input.assetId, restaurantId: null }, select: { id: true, restaurantId: true } });
    if (!row) throw new StudioError('NOT_FOUND');
    return assetUsage(ctx.db, row);
  },
});
