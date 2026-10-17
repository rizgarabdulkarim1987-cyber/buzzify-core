import { z } from 'zod';
import { defineAction } from '@/server/studio/framework/action';
import { brandFields, updateBrand } from '@/server/studio/services/brand';
import { idField } from '@/server/studio/services/content';

/** The Brand tab's save (spec 12): the whole kit at its version, through the draft. */
export const update = defineAction({
  name: 'brand.update',
  permission: 'brand.edit',
  input: z.object({ menuId: idField, ...brandFields }),
  target: (i) => ({ kind: 'menu', menuId: i.menuId }),
  run: (ctx, input) => updateBrand(ctx, input),
});
