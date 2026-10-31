import { z } from 'zod';
import { expireLive } from '@/server/data/cache';
import { DEFAULT_STORY_HOURS, MAX_LIVE_STORIES, STORY_HOURS, storyExpiry } from '@/server/domain/stories';
import { defineAction } from '@/server/studio/framework/action';
import { StudioError } from '@/server/studio/framework/result';
import { requireAboutImages } from '@/server/studio/services/about';

/**
 * Restaurant stories (plan feature `guest.stories`): a library picture, a caption and an end time. Read live by the
 * guest pages, so no publish is needed; each write expires the menu's cached stories. A story is the restaurant's own
 * content: saving needs the plan, deleting never does (a downgrade must be able to clear them).
 */

const menuId = z.string().min(1).max(100);
const id = z.string().min(1).max(100);
const caption = z.string().trim().max(140).optional();
const target = (i: { menuId: string }) => ({ kind: 'menu', menuId: i.menuId }) as const;
const hours = z.number().int().refine((value) => (STORY_HOURS as readonly number[]).includes(value), 'Choose how long the story runs');

function restaurantOf(ctx: { restaurantId: string | null }): string {
  if (ctx.restaurantId === null) throw new Error('A menu action ran without a restaurant');
  return ctx.restaurantId;
}

export const saveStory = defineAction({
  name: 'menus.saveStory',
  permission: 'content.edit',
  feature: 'guest.stories',
  input: z.object({
    menuId,
    storyId: id.optional(),
    assetId: id,
    productId: id.nullable(),
    captions: z.object({ en: caption, ar: caption, ckb: caption }),
    /** On a new story, how long it runs (a day when left out). On an edit, set only to start the clock again. */
    hours: hours.optional(),
    isActive: z.boolean(),
  }),
  target,
  run: (ctx, input) =>
    ctx.transaction(async (tx) => {
      if (!(await tx.menu.findUnique({ where: { id: input.menuId }, select: { id: true } }))) throw new StudioError('NOT_FOUND');
      await requireAboutImages(tx, restaurantOf(ctx), [input.assetId], 'assetId');
      if (input.productId && !(await tx.product.findFirst({ where: { id: input.productId, menuId: input.menuId }, select: { id: true } }))) {
        throw new StudioError('NOT_FOUND', undefined, { productId: 'Choose a dish of this menu' });
      }
      const captions = Object.fromEntries(Object.entries(input.captions).filter(([, value]) => typeof value === 'string' && value !== ''));
      const data = { assetId: input.assetId, productId: input.productId, captions, isActive: input.isActive };

      let storyId = input.storyId;
      if (storyId) {
        const own = await tx.menuStory.findFirst({ where: { id: storyId, menuId: input.menuId }, select: { id: true } });
        if (!own) throw new StudioError('NOT_FOUND');
        await tx.menuStory.update({ where: { id: storyId }, data: { ...data, ...(input.hours ? { expiresAt: storyExpiry(new Date(), input.hours) } : {}) } });
      } else {
        const running = await tx.menuStory.count({ where: { menuId: input.menuId, isActive: true, expiresAt: { gt: new Date() } } });
        if (input.isActive && running >= MAX_LIVE_STORIES) throw new StudioError('INVALID', undefined, { assetId: `A menu shows at most ${MAX_LIVE_STORIES} stories at a time` });
        storyId = (await tx.menuStory.create({ data: { menuId: input.menuId, ...data, expiresAt: storyExpiry(new Date(), input.hours ?? DEFAULT_STORY_HOURS) }, select: { id: true } })).id;
      }
      ctx.audit({ action: 'menu.story_changed', entityType: 'MenuStory', entityId: storyId, changes: { isActive: { before: null, after: input.isActive } } });
      ctx.afterCommit(() => expireLive(input.menuId));
      return { storyId };
    }),
});

export const deleteStory = defineAction({
  name: 'menus.deleteStory',
  permission: 'content.edit',
  input: z.object({ menuId, storyId: id }),
  target,
  run: (ctx, { menuId, storyId }) =>
    ctx.transaction(async (tx) => {
      const own = await tx.menuStory.findFirst({ where: { id: storyId, menuId }, select: { id: true } });
      if (!own) throw new StudioError('NOT_FOUND');
      await tx.menuStory.delete({ where: { id: storyId } });
      ctx.audit({ action: 'menu.story_changed', entityType: 'MenuStory', entityId: storyId, changes: { removed: { before: false, after: true } } });
      ctx.afterCommit(() => expireLive(menuId));
      return { deleted: true };
    }),
});
