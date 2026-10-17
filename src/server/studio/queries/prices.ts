import { z } from 'zod';
import { defineQuery, type QueryContext } from '@/server/studio/framework/query';
import { idField } from '@/server/studio/services/content';
import { bulkFields, previewBulk as preview, priceGrid } from '@/server/studio/services/prices';

/** What the Prices tab reads: every price of the menu, and what a bulk change would do before it is applied. */

const atMenu = (menuId: string) => ({ kind: 'menu', menuId }) as const;

function menuOf(ctx: QueryContext): string {
  if (ctx.menuId === null) throw new Error('A menu query ran without a menu');
  return ctx.menuId;
}

export const grid = defineQuery({
  name: 'prices.grid',
  permission: 'content.prices',
  input: z.object({ menuId: idField }),
  target: (i) => atMenu(i.menuId),
  run: (ctx) => priceGrid(ctx.db, menuOf(ctx)),
});

export const previewBulk = defineQuery({
  name: 'prices.previewBulk',
  permission: 'prices.bulk',
  input: z.object({ menuId: idField, ...bulkFields }),
  target: (i) => atMenu(i.menuId),
  run: (ctx, input) => preview(ctx.db, menuOf(ctx), input),
});
