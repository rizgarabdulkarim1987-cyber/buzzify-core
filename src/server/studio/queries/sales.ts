import { z } from 'zod';
import { defineQuery, type QueryContext } from '@/server/studio/framework/query';
import { idField } from '@/server/studio/services/content';
import { salesRules, salesSettingsView } from '@/server/studio/services/sales';

/** What the Sales tab reads (docs/superpowers/specs/2026-10-18-sales-tools-design.md, 6.4). */

const atMenu = (menuId: string) => ({ kind: 'menu', menuId }) as const;

function menuOf(ctx: QueryContext): string {
  if (ctx.menuId === null) throw new Error('A menu query ran without a menu');
  return ctx.menuId;
}

/** The menu's dishes and categories, with every upgrade, pairing, set and offer it has. */
export const rules = defineQuery({
  name: 'sales.rules',
  permission: 'content.edit',
  input: z.object({ menuId: idField }),
  target: (i) => atMenu(i.menuId),
  run: (ctx) => salesRules(ctx.db, menuOf(ctx)),
});

/** The menu's sales settings and its categories, marked when they complete a meal. */
export const settings = defineQuery({
  name: 'sales.settings',
  permission: 'content.edit',
  input: z.object({ menuId: idField }),
  target: (i) => atMenu(i.menuId),
  run: (ctx) => salesSettingsView(ctx.db, menuOf(ctx)),
});
