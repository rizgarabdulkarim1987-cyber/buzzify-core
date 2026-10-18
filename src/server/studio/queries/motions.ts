import { z } from 'zod';
import { defineQuery } from '@/server/studio/framework/query';
import { idField } from '@/server/studio/services/content';
import { motionPlaces } from '@/server/studio/services/menu-motions';

/** What the Motion tab reads: the menu's places and the motion at each. */
export const list = defineQuery({
  name: 'motions.list',
  permission: 'brand.edit',
  input: z.object({ menuId: idField }),
  target: (i) => ({ kind: 'menu', menuId: i.menuId }),
  run: (ctx) => motionPlaces(ctx.db, ctx),
});
