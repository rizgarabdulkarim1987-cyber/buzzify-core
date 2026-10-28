import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import { expireMenu } from '@/server/data/cache';
import { aboutIsEmpty, offersLiveFor } from '@/server/domain/about';
import { defineAction } from '@/server/studio/framework/action';
import { StudioError } from '@/server/studio/framework/result';
import { cleanStoryByLocale, requireAboutImages, requireOfferTarget } from '@/server/studio/services/about';
import { requireWindow } from '@/server/studio/services/intro';
import { menuSlugs } from '@/server/studio/services/menus';

/** The restaurant's own page inside the menu ("Explore"). Read live by the guest pages, so no publish is needed; each write expires the menu's cached gate. */

const menuId = z.string().min(1).max(100);
const id = z.string().min(1).max(100);
const texts = (max: number) => z.object({ en: z.string().trim().max(max).optional(), ar: z.string().trim().max(max).optional(), ckb: z.string().trim().max(max).optional() });
const storyInput = z.object({ en: z.unknown().optional(), ar: z.unknown().optional(), ckb: z.unknown().optional() });
const when = z.coerce.date().nullable();
const target = (i: { menuId: string }) => ({ kind: 'menu', menuId: i.menuId }) as const;
const MAX_GALLERY = 24;

function restaurantOf(ctx: { restaurantId: string | null }): string {
  if (ctx.restaurantId === null) throw new Error('A menu action ran without a restaurant');
  return ctx.restaurantId;
}

export const setMenuAboutEnabled = defineAction({
  name: 'menus.setAboutEnabled',
  permission: 'content.edit',
  feature: 'menu.about',
  input: z.object({ menuId, enabled: z.boolean() }),
  target,
  run: (ctx, { menuId, enabled }) =>
    ctx.transaction(async (tx) => {
      const row = await tx.menu.findUnique({ where: { id: menuId }, select: { aboutEnabled: true } });
      if (!row) throw new StudioError('NOT_FOUND');
      if (row.aboutEnabled === enabled) return { enabled };
      if (enabled) {
        // The guest page is absent when empty, so a switch that would show nothing is refused with a reason.
        const [about, offers] = await Promise.all([tx.menuAbout.findUnique({ where: { menuId } }), tx.aboutOffer.findMany({ where: { menuId } })]);
        if (aboutIsEmpty(about, offersLiveFor(offers, new Date()))) throw new StudioError('INVALID', undefined, { enabled: 'Fill in the page before switching it on' });
      }
      await tx.menu.update({ where: { id: menuId }, data: { aboutEnabled: enabled } });
      ctx.audit({ action: 'menu.about_changed', entityType: 'MenuAbout', entityId: menuId, changes: { enabled: { before: row.aboutEnabled, after: enabled } } });
      const slugs = await menuSlugs(tx, menuId);
      ctx.afterCommit(() => expireMenu(slugs, menuId));
      return { enabled };
    }),
});

export const saveAbout = defineAction({
  name: 'menus.saveAbout',
  permission: 'content.edit',
  feature: 'menu.about',
  input: z.object({
    menuId,
    titles: texts(60),
    coverAssetId: id.nullable(),
    story: storyInput,
    galleryAssetIds: z.array(id).max(MAX_GALLERY),
    showHours: z.boolean(),
    showContact: z.boolean(),
  }),
  target,
  run: (ctx, input) =>
    ctx.transaction(async (tx) => {
      if (!(await tx.menu.findUnique({ where: { id: input.menuId }, select: { id: true } }))) throw new StudioError('NOT_FOUND');
      const story = cleanStoryByLocale(input.story) as unknown as Prisma.InputJsonObject;
      const gallery = [...new Set(input.galleryAssetIds)];
      if (input.coverAssetId) await requireAboutImages(tx, restaurantOf(ctx), [input.coverAssetId], 'coverAssetId');
      await requireAboutImages(tx, restaurantOf(ctx), gallery, 'galleryAssetIds');
      const data = { titles: input.titles, coverAssetId: input.coverAssetId, story, galleryAssetIds: gallery, showHours: input.showHours, showContact: input.showContact };
      await tx.menuAbout.upsert({ where: { menuId: input.menuId }, create: { menuId: input.menuId, ...data }, update: data });
      ctx.audit({ action: 'menu.about_changed', entityType: 'MenuAbout', entityId: input.menuId, changes: { coverAssetId: { before: null, after: input.coverAssetId } } });
      const slugs = await menuSlugs(tx, input.menuId);
      ctx.afterCommit(() => expireMenu(slugs, input.menuId));
      return { saved: true };
    }),
});

export const saveAboutOffer = defineAction({
  name: 'menus.saveAboutOffer',
  permission: 'content.edit',
  feature: 'menu.about',
  input: z.object({
    menuId,
    offerId: id.optional(),
    titles: texts(120),
    bodies: texts(500),
    label: texts(40),
    imageAssetId: id.nullable(),
    startsAt: when,
    endsAt: when,
    active: z.boolean(),
    productId: id.nullable(),
    categoryId: id.nullable(),
  }),
  target,
  run: (ctx, input) =>
    ctx.transaction(async (tx) => {
      if (!(await tx.menu.findUnique({ where: { id: input.menuId }, select: { id: true } }))) throw new StudioError('NOT_FOUND');
      if (input.imageAssetId) await requireAboutImages(tx, restaurantOf(ctx), [input.imageAssetId], 'imageAssetId');
      await requireOfferTarget(tx, input.menuId, input.productId, input.categoryId);
      requireWindow(input.startsAt, input.endsAt);
      const data = {
        titles: input.titles,
        bodies: input.bodies,
        label: input.label,
        imageAssetId: input.imageAssetId,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        active: input.active,
        productId: input.productId,
        categoryId: input.categoryId,
      };
      let offerId = input.offerId;
      if (offerId) {
        const own = await tx.aboutOffer.findFirst({ where: { id: offerId, menuId: input.menuId }, select: { id: true } });
        if (!own) throw new StudioError('NOT_FOUND');
        await tx.aboutOffer.update({ where: { id: offerId }, data });
      } else {
        const last = await tx.aboutOffer.aggregate({ where: { menuId: input.menuId }, _max: { sortOrder: true } });
        offerId = (await tx.aboutOffer.create({ data: { menuId: input.menuId, sortOrder: (last._max.sortOrder ?? -1) + 1, ...data }, select: { id: true } })).id;
      }
      ctx.audit({ action: 'menu.about_offer_changed', entityType: 'AboutOffer', entityId: offerId, changes: { active: { before: null, after: input.active } } });
      const slugs = await menuSlugs(tx, input.menuId);
      ctx.afterCommit(() => expireMenu(slugs, input.menuId));
      return { offerId };
    }),
});

export const reorderAboutOffers = defineAction({
  name: 'menus.reorderAboutOffers',
  permission: 'content.edit',
  feature: 'menu.about',
  input: z.object({ menuId, ids: z.array(id).max(100) }),
  target,
  run: (ctx, { menuId, ids }) =>
    ctx.transaction(async (tx) => {
      const own = await tx.aboutOffer.findMany({ where: { menuId }, select: { id: true } });
      const known = new Set(own.map((row) => row.id));
      if (ids.length !== known.size || new Set(ids).size !== ids.length || ids.some((one) => !known.has(one))) throw new StudioError('INVALID', 'Reload the list and try again');
      for (const [index, one] of ids.entries()) await tx.aboutOffer.update({ where: { id: one }, data: { sortOrder: index } });
      ctx.audit({ action: 'menu.about_offer_changed', entityType: 'AboutOffer', entityId: menuId, changes: { order: { before: null, after: ids.join(',') } } });
      const slugs = await menuSlugs(tx, menuId);
      ctx.afterCommit(() => expireMenu(slugs, menuId));
      return { saved: true };
    }),
});

export const deleteAboutOffer = defineAction({
  name: 'menus.deleteAboutOffer',
  permission: 'content.edit',
  input: z.object({ menuId, offerId: id }),
  target,
  run: (ctx, { menuId, offerId }) =>
    ctx.transaction(async (tx) => {
      const own = await tx.aboutOffer.findFirst({ where: { id: offerId, menuId }, select: { id: true } });
      if (!own) throw new StudioError('NOT_FOUND');
      await tx.aboutOffer.delete({ where: { id: offerId } });
      ctx.audit({ action: 'menu.about_offer_changed', entityType: 'AboutOffer', entityId: offerId, changes: { removed: { before: false, after: true } } });
      const slugs = await menuSlugs(tx, menuId);
      ctx.afterCommit(() => expireMenu(slugs, menuId));
      return { deleted: true };
    }),
});
