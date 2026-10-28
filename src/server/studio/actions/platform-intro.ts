import { z } from 'zod';
import { defineAction } from '@/server/studio/framework/action';
import { StudioError } from '@/server/studio/framework/result';
import { advertHref, requireIntroAsset, requireWindow } from '@/server/studio/services/intro';

/**
 * What the Buzzify team shows on menus' intro pages: a default background, and adverts for every menu or the listed restaurants and menus.
 * Only Super Admins hold `platform.settings`. The pages read all of it per request, so nothing needs expiring.
 */

const PLATFORM = { kind: 'platform' } as const;
const id = z.string().min(1).max(100);
const alts = z.object({ en: z.string().trim().max(200).optional(), ar: z.string().trim().max(200).optional(), ckb: z.string().trim().max(200).optional() });
const when = z.coerce.date().nullable();

/** An asset of the shared library only (restaurant id '' matches no restaurant): a platform advert never points into one restaurant's library. */
const SHARED = '';

export const savePlatformIntroDefault = defineAction({
  name: 'platform.saveIntroDefault',
  permission: 'platform.settings',
  input: z.object({ backgroundAssetId: id.nullable() }),
  target: () => PLATFORM,
  run: (ctx, { backgroundAssetId }) =>
    ctx.transaction(async (tx) => {
      if (backgroundAssetId) await requireIntroAsset(tx, SHARED, backgroundAssetId, ['IMAGE', 'VIDEO'], 'backgroundAssetId');
      const before = await tx.platformIntro.findUnique({ where: { id: 'singleton' }, select: { backgroundAssetId: true } });
      await tx.platformIntro.upsert({ where: { id: 'singleton' }, create: { id: 'singleton', backgroundAssetId }, update: { backgroundAssetId } });
      ctx.audit({ action: 'platform.intro_changed', entityType: 'PlatformAdvert', entityId: 'singleton', changes: { backgroundAssetId: { before: before?.backgroundAssetId ?? null, after: backgroundAssetId } } });
      return { saved: true };
    }),
});

export const savePlatformAdvert = defineAction({
  name: 'platform.savePlatformAdvert',
  permission: 'platform.settings',
  input: z.object({
    advertId: id.optional(),
    imageAssetId: id,
    alts,
    href: z.string().max(500),
    startsAt: when,
    endsAt: when,
    active: z.boolean(),
    restaurantIds: z.array(id).max(500),
    menuIds: z.array(id).max(500),
  }),
  target: () => PLATFORM,
  run: (ctx, input) =>
    ctx.transaction(async (tx) => {
      await requireIntroAsset(tx, SHARED, input.imageAssetId, ['IMAGE'], 'imageAssetId');
      const href = advertHref(input.href);
      requireWindow(input.startsAt, input.endsAt);
      const restaurantIds = [...new Set(input.restaurantIds)];
      if (restaurantIds.length > 0 && (await tx.restaurant.count({ where: { id: { in: restaurantIds } } })) !== restaurantIds.length) {
        throw new StudioError('INVALID', undefined, { restaurantIds: 'Choose restaurants that exist' });
      }
      const menuIds = [...new Set(input.menuIds)];
      if (menuIds.length > 0 && (await tx.menu.count({ where: { id: { in: menuIds } } })) !== menuIds.length) {
        throw new StudioError('INVALID', undefined, { menuIds: 'Choose menus that exist' });
      }
      const data = { imageAssetId: input.imageAssetId, alts: input.alts, href, startsAt: input.startsAt, endsAt: input.endsAt, active: input.active, restaurantIds, menuIds };
      let advertId = input.advertId;
      if (advertId) {
        if (!(await tx.platformAdvert.findUnique({ where: { id: advertId }, select: { id: true } }))) throw new StudioError('NOT_FOUND');
        await tx.platformAdvert.update({ where: { id: advertId }, data });
      } else {
        const last = await tx.platformAdvert.aggregate({ _max: { sortOrder: true } });
        advertId = (await tx.platformAdvert.create({ data: { sortOrder: (last._max.sortOrder ?? -1) + 1, ...data }, select: { id: true } })).id;
      }
      ctx.audit({ action: 'platform.intro_changed', entityType: 'PlatformAdvert', entityId: advertId, changes: { href: { before: null, after: href } } });
      return { advertId };
    }),
});

export const reorderPlatformAdverts = defineAction({
  name: 'platform.reorderPlatformAdverts',
  permission: 'platform.settings',
  input: z.object({ ids: z.array(id).max(200) }),
  target: () => PLATFORM,
  run: (ctx, { ids }) =>
    ctx.transaction(async (tx) => {
      const known = new Set((await tx.platformAdvert.findMany({ select: { id: true } })).map((row) => row.id));
      if (ids.length !== known.size || new Set(ids).size !== ids.length || ids.some((advertId) => !known.has(advertId))) throw new StudioError('INVALID', 'Reload the list and try again');
      for (const [index, advertId] of ids.entries()) await tx.platformAdvert.update({ where: { id: advertId }, data: { sortOrder: index } });
      ctx.audit({ action: 'platform.intro_changed', entityType: 'PlatformAdvert', entityId: 'order', changes: { order: { before: null, after: ids.join(',') } } });
      return { saved: true };
    }),
});

export const deletePlatformAdvert = defineAction({
  name: 'platform.deletePlatformAdvert',
  permission: 'platform.settings',
  input: z.object({ advertId: id }),
  target: () => PLATFORM,
  run: (ctx, { advertId }) =>
    ctx.transaction(async (tx) => {
      if (!(await tx.platformAdvert.findUnique({ where: { id: advertId }, select: { id: true } }))) throw new StudioError('NOT_FOUND');
      await tx.platformAdvert.delete({ where: { id: advertId } });
      ctx.audit({ action: 'platform.intro_changed', entityType: 'PlatformAdvert', entityId: advertId, changes: { removed: { before: false, after: true } } });
      return { deleted: true };
    }),
});
