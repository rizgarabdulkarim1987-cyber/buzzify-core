import { z } from 'zod';
import { TEMPLATE_IDS } from '@/lib/templates';
import { defineAction } from '@/server/studio/framework/action';
import { idField } from '@/server/studio/services/content';
import {
  applyDesign,
  applyField,
  deleteDesign,
  designFields,
  resetDesign,
  saveDesign,
  setPoweredBy,
  templateName,
  updateDesign,
} from '@/server/studio/services/design';

/** The Design tab's changes (spec 2026-10-18-template-studio-design.md, section 7), all through the draft. */

export const apply = defineAction({
  name: 'design.apply',
  permission: 'brand.edit',
  input: z.object({ menuId: idField, version: designFields.version, choice: applyField }),
  target: (i) => ({ kind: 'menu', menuId: i.menuId }),
  run: (ctx, input) => applyDesign(ctx, input),
});

export const update = defineAction({
  name: 'design.update',
  permission: 'brand.edit',
  input: z.object({ menuId: idField, ...designFields }),
  target: (i) => ({ kind: 'menu', menuId: i.menuId }),
  run: (ctx, input) => updateDesign(ctx, input),
});

export const reset = defineAction({
  name: 'design.reset',
  permission: 'brand.edit',
  input: z.object({ menuId: idField, version: designFields.version }),
  target: (i) => ({ kind: 'menu', menuId: i.menuId }),
  run: (ctx, input) => resetDesign(ctx, input),
});

export const save = defineAction({
  name: 'design.save',
  permission: 'brand.edit',
  input: z.object({ menuId: idField, name: templateName, shared: z.boolean(), from: z.union([z.literal('menu'), z.enum(TEMPLATE_IDS)]) }),
  target: (i) => ({ kind: 'menu', menuId: i.menuId }),
  run: (ctx, input) => saveDesign(ctx, input),
});

export const remove = defineAction({
  name: 'design.delete',
  permission: 'brand.edit',
  input: z.object({ menuId: idField, id: idField }),
  target: (i) => ({ kind: 'menu', menuId: i.menuId }),
  run: (ctx, input) => deleteDesign(ctx, input),
});

/** "Powered by Buzzify" on a restaurant's template menus: a platform setting, which only a Super Admin holds. */
export const poweredBy = defineAction({
  name: 'design.poweredBy',
  permission: 'platform.settings',
  input: z.object({ restaurantId: idField, show: z.boolean() }),
  target: (i) => ({ kind: 'restaurant', restaurantId: i.restaurantId }),
  run: (ctx, input) => setPoweredBy(ctx, input),
});
