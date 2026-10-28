import { z } from 'zod';
import { expireMenu } from '@/server/data/cache';
import { defineAction } from '@/server/studio/framework/action';
import { StudioError } from '@/server/studio/framework/result';
import { menuSlugs } from '@/server/studio/services/menus';
import { advertHref, requireIntroAsset, requireWindow } from '@/server/studio/services/intro';
import { validOverlay } from '@/server/domain/intro';

/** The intro page before the menu. Read live by the guest pages, so no publish is needed; each write expires the menu's cached gate. */

const menuId = z.string().min(1).max(100);
const alts = z.object({ en: z.string().trim().max(200).optional(), ar: z.string().trim().max(200).optional(), ckb: z.string().trim().max(200).optional() });
const when = z.coerce.date().nullable();
const target = (i: { menuId: string }) => ({ kind: 'menu', menuId: i.menuId }) as const;

function restaurantOf(ctx: { restaurantId: string | null }): string {
  if (ctx.restaurantId === null) throw new Error('A menu action ran without a restaurant');
  return ctx.restaurantId;
}

export const setMenuIntroEnabled = defineAction({
  name: 'menus.setIntroEnabled',
  permission: 'content.edit',
  feature: 'menu.intro',
  input: z.object({ menuId, enabled: z.boolean() }),
  target,
  run: (ctx, { menuId, enabled }) =>
    ctx.transaction(async (tx) => {
      const row = await tx.menu.findUnique({ where: { id: menuId }, select: { introEnabled: true } });
      if (!row) throw new StudioError('NOT_FOUND');
      if (row.introEnabled === enabled) return { enabled };
      await tx.menu.update({ where: { id: menuId }, data: { introEnabled: enabled } });
      ctx.audit({ action: 'menu.intro_changed', entityType: 'MenuIntro', entityId: menuId, changes: { enabled: { before: row.introEnabled, after: enabled } } });
      const slugs = await menuSlugs(tx, menuId);
      ctx.afterCommit(() => expireMenu(slugs, menuId));
      return { enabled };
    }),
});

export const saveMenuIntro = defineAction({
  name: 'menus.saveIntro',
  permission: 'content.edit',
  feature: 'menu.intro',
  input: z.object({
    menuId,
    backgroundAssetId: z.string().min(1).max(100).nullable(),
    overlay: z.number().refine(validOverlay, 'Use a whole number from 0 to 100'),
    showLogo: z.boolean(),
    showContact: z.boolean(),
  }),
  target,
  run: (ctx, input) =>
    ctx.transaction(async (tx) => {
      if (!(await tx.menu.findUnique({ where: { id: input.menuId }, select: { id: true } }))) throw new StudioError('NOT_FOUND');
      if (input.backgroundAssetId) await requireIntroAsset(tx, restaurantOf(ctx), input.backgroundAssetId, ['IMAGE', 'VIDEO'], 'backgroundAssetId');
      const data = { backgroundAssetId: input.backgroundAssetId, overlay: input.overlay, showLogo: input.showLogo, showContact: input.showContact };
      await tx.menuIntro.upsert({ where: { menuId: input.menuId }, create: { menuId: input.menuId, ...data }, update: data });
      ctx.audit({ action: 'menu.intro_changed', entityType: 'MenuIntro', entityId: input.menuId, changes: { backgroundAssetId: { before: null, after: input.backgroundAssetId } } });
      const slugs = await menuSlugs(tx, input.menuId);
      ctx.afterCommit(() => expireMenu(slugs, input.menuId));
      return { saved: true };
    }),
});

export const saveIntroAdvert = defineAction({
  name: 'menus.saveIntroAdvert',
  permission: 'content.edit',
  feature: 'menu.intro',
  input: z.object({
    menuId,
    advertId: z.string().min(1).max(100).optional(),
    imageAssetId: z.string().min(1).max(100),
    alts,
    href: z.string().max(500),
    startsAt: when,
    endsAt: when,
    active: z.boolean(),
  }),
  target,
  run: (ctx, input) =>
    ctx.transaction(async (tx) => {
      if (!(await tx.menu.findUnique({ where: { id: input.menuId }, select: { id: true } }))) throw new StudioError('NOT_FOUND');
      await requireIntroAsset(tx, restaurantOf(ctx), input.imageAssetId, ['IMAGE'], 'imageAssetId');
      const href = advertHref(input.href);
      requireWindow(input.startsAt, input.endsAt);
      const data = { imageAssetId: input.imageAssetId, alts: input.alts, href, startsAt: input.startsAt, endsAt: input.endsAt, active: input.active };
      let advertId = input.advertId;
      if (advertId) {
        const own = await tx.introAdvert.findFirst({ where: { id: advertId, menuId: input.menuId }, select: { id: true } });
        if (!own) throw new StudioError('NOT_FOUND');
        await tx.introAdvert.update({ where: { id: advertId }, data });
      } else {
        const last = await tx.introAdvert.aggregate({ where: { menuId: input.menuId }, _max: { sortOrder: true } });
        advertId = (await tx.introAdvert.create({ data: { menuId: input.menuId, sortOrder: (last._max.sortOrder ?? -1) + 1, ...data }, select: { id: true } })).id;
      }
      ctx.audit({ action: 'menu.intro_advert_changed', entityType: 'IntroAdvert', entityId: advertId, changes: { href: { before: null, after: href } } });
      const slugs = await menuSlugs(tx, input.menuId);
      ctx.afterCommit(() => expireMenu(slugs, input.menuId));
      return { advertId };
    }),
});

export const reorderIntroAdverts = defineAction({
  name: 'menus.reorderIntroAdverts',
  permission: 'content.edit',
  feature: 'menu.intro',
  input: z.object({ menuId, ids: z.array(z.string().min(1).max(100)).max(100) }),
  target,
  run: (ctx, { menuId, ids }) =>
    ctx.transaction(async (tx) => {
      const own = await tx.introAdvert.findMany({ where: { menuId }, select: { id: true } });
      const known = new Set(own.map((row) => row.id));
      if (ids.length !== known.size || new Set(ids).size !== ids.length || ids.some((id) => !known.has(id))) throw new StudioError('INVALID', 'Reload the list and try again');
      for (const [index, id] of ids.entries()) await tx.introAdvert.update({ where: { id }, data: { sortOrder: index } });
      ctx.audit({ action: 'menu.intro_advert_changed', entityType: 'IntroAdvert', entityId: menuId, changes: { order: { before: null, after: ids.join(',') } } });
      const slugs = await menuSlugs(tx, menuId);
      ctx.afterCommit(() => expireMenu(slugs, menuId));
      return { saved: true };
    }),
});

export const deleteIntroAdvert = defineAction({
  name: 'menus.deleteIntroAdvert',
  permission: 'content.edit',
  input: z.object({ menuId, advertId: z.string().min(1).max(100) }),
  target,
  run: (ctx, { menuId, advertId }) =>
    ctx.transaction(async (tx) => {
      const own = await tx.introAdvert.findFirst({ where: { id: advertId, menuId }, select: { id: true } });
      if (!own) throw new StudioError('NOT_FOUND');
      await tx.introAdvert.delete({ where: { id: advertId } });
      ctx.audit({ action: 'menu.intro_advert_changed', entityType: 'IntroAdvert', entityId: advertId, changes: { removed: { before: false, after: true } } });
      const slugs = await menuSlugs(tx, menuId);
      ctx.afterCommit(() => expireMenu(slugs, menuId));
      return { deleted: true };
    }),
});
