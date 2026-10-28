import { z } from 'zod';
import { expireMenu } from '@/server/data/cache';
import { validateWheel } from '@/server/domain/wheel';
import { defineAction } from '@/server/studio/framework/action';
import { StudioError } from '@/server/studio/framework/result';
import { requireWindow } from '@/server/studio/services/intro';
import { menuSlugs } from '@/server/studio/services/menus';
import { requireWheelDishes } from '@/server/studio/services/wheel';

/** The wheel of fortune inside the Explore page. Read live by the guest pages, so no publish is needed; each write expires the menu's cached gate. */

const menuId = z.string().min(1).max(100);
const texts = (max: number) => z.object({ en: z.string().trim().max(max).optional(), ar: z.string().trim().max(max).optional(), ckb: z.string().trim().max(max).optional() });
const when = z.coerce.date().nullable();
const target = (i: { menuId: string }) => ({ kind: 'menu', menuId: i.menuId }) as const;

export const setMenuWheelEnabled = defineAction({
  name: 'menus.setWheelEnabled',
  permission: 'content.edit',
  feature: 'menu.wheel',
  input: z.object({ menuId, enabled: z.boolean() }),
  target,
  run: (ctx, { menuId, enabled }) =>
    ctx.transaction(async (tx) => {
      const row = await tx.menu.findUnique({ where: { id: menuId }, select: { wheelEnabled: true } });
      if (!row) throw new StudioError('NOT_FOUND');
      if (row.wheelEnabled === enabled) return { enabled };
      if (enabled && !(await tx.menuWheel.findUnique({ where: { menuId }, select: { id: true } }))) {
        throw new StudioError('INVALID', undefined, { enabled: 'Save the wheel before switching it on' });
      }
      await tx.menu.update({ where: { id: menuId }, data: { wheelEnabled: enabled } });
      ctx.audit({ action: 'menu.wheel_changed', entityType: 'MenuWheel', entityId: menuId, changes: { enabled: { before: row.wheelEnabled, after: enabled } } });
      const slugs = await menuSlugs(tx, menuId);
      ctx.afterCommit(() => expireMenu(slugs, menuId));
      return { enabled };
    }),
});

export const saveWheel = defineAction({
  name: 'menus.saveWheel',
  permission: 'content.edit',
  feature: 'menu.wheel',
  input: z.object({
    menuId,
    spinsPerDay: z.number(),
    startsAt: when,
    endsAt: when,
    title: texts(60),
    slices: z.array(z.object({ productId: z.string().min(1).max(100), label: texts(60), weight: z.number() })).max(50),
  }),
  target,
  run: (ctx, input) =>
    ctx.transaction(async (tx) => {
      if (!(await tx.menu.findUnique({ where: { id: input.menuId }, select: { id: true } }))) throw new StudioError('NOT_FOUND');
      const problem = validateWheel(input);
      if (problem === 'SLICE_COUNT') throw new StudioError('INVALID', undefined, { slices: 'A wheel needs 4 to 12 dishes' });
      if (problem === 'WEIGHT') throw new StudioError('INVALID', undefined, { slices: 'A weight is a whole number from 1 to 100' });
      if (problem === 'SPINS_PER_DAY') throw new StudioError('INVALID', undefined, { spinsPerDay: 'Spins a day: 1 to 10' });
      const ids = input.slices.map((slice) => slice.productId);
      if (new Set(ids).size !== ids.length) throw new StudioError('INVALID', undefined, { slices: 'A dish can be on the wheel once' });
      requireWindow(input.startsAt, input.endsAt);
      await requireWheelDishes(tx, input.menuId, ids);
      const data = { spinsPerDay: input.spinsPerDay, startsAt: input.startsAt, endsAt: input.endsAt, title: input.title };
      const wheel = await tx.menuWheel.upsert({ where: { menuId: input.menuId }, create: { menuId: input.menuId, ...data }, update: data, select: { id: true } });
      await tx.wheelSlice.deleteMany({ where: { wheelId: wheel.id } });
      await tx.wheelSlice.createMany({
        data: input.slices.map((slice, index) => ({ wheelId: wheel.id, menuId: input.menuId, productId: slice.productId, label: slice.label, weight: slice.weight, sortOrder: index })),
      });
      ctx.audit({ action: 'menu.wheel_changed', entityType: 'WheelSlice', entityId: wheel.id, changes: { slices: { before: null, after: ids.length } } });
      const slugs = await menuSlugs(tx, input.menuId);
      ctx.afterCommit(() => expireMenu(slugs, input.menuId));
      return { saved: true };
    }),
});
