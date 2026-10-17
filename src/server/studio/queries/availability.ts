import { z } from 'zod';
import { defineQuery } from '@/server/studio/framework/query';
import { availabilityBoard } from '@/server/studio/services/availability';
import { idField } from '@/server/studio/services/content';

/** What the Availability tab reads: every product and option of the menu with its live switches. */
export const board = defineQuery({
  name: 'availability.board',
  permission: 'content.availability',
  input: z.object({ menuId: idField }),
  target: (i) => ({ kind: 'menu', menuId: i.menuId }),
  run: (ctx) => {
    if (ctx.menuId === null) throw new Error('A menu query ran without a menu');
    return availabilityBoard(ctx.db, ctx.menuId);
  },
});
