import { z } from 'zod';
import { defineAction } from '@/server/studio/framework/action';
import { placeFields, removeMotion, saveFields, saveMotion } from '@/server/studio/services/menu-motions';

/**
 * The Motion tab's saves (spec: 2026-10-18-menu-motions-design.md, section 10). The plan is checked in the service: a
 * motion already at its place is kept on any plan, so the definitions name no feature.
 */
export const save = defineAction({
  name: 'motions.save',
  permission: 'brand.edit',
  input: z.object(saveFields),
  target: (i) => ({ kind: 'menu', menuId: i.menuId }),
  run: (ctx, input) => saveMotion(ctx, input),
});

export const remove = defineAction({
  name: 'motions.remove',
  permission: 'brand.edit',
  input: z.object({ ...placeFields, version: z.number().int().min(1) }),
  target: (i) => ({ kind: 'menu', menuId: i.menuId }),
  run: (ctx, input) => removeMotion(ctx, input),
});
