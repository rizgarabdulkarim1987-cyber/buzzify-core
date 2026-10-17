import { z } from 'zod';
import { defineQuery } from '@/server/studio/framework/query';
import { idField } from '@/server/studio/services/content';
import { importJob } from '@/server/studio/services/imports';

/** An import job with its preview, for the tab after a reload. */
export const job = defineQuery({
  name: 'import.job',
  permission: 'import.run',
  input: z.object({ menuId: idField, importJobId: idField }),
  target: (i) => ({ kind: 'menu', menuId: i.menuId }),
  run: (ctx, input) => {
    if (ctx.menuId === null) throw new Error('A menu query ran without a menu');
    return importJob(ctx.db, ctx.menuId, input.importJobId);
  },
});
