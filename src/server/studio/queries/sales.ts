import { z } from 'zod';
import { defineQuery, type QueryContext } from '@/server/studio/framework/query';
import { idField } from '@/server/studio/services/content';
import { allows } from '@/server/domain/entitlements';
import { salesOverview, type SalesOverview } from '@/server/studio/services/insights';
import { upgradeInfo, type UpgradeInfo } from '@/server/studio/services/plans';
import { salesRules, salesSettingsView, type SalesRules, type SalesSettingsView } from '@/server/studio/services/sales';

/**
 * What the Sales tab reads (docs/superpowers/specs/2026-10-18-sales-tools-design.md, 6.4). Each answer carries what the
 * restaurant's plan includes, so a page shows the way to upgrade beside a tool the plan leaves out.
 */

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
  run: async (ctx): Promise<SalesRules & { upgrade: UpgradeInfo }> => {
    // The same gate `servedCatalog` applies for guests, so a card the plan keeps from them is marked as hidden.
    const plan = { offers: ctx.plan !== null && allows(ctx.plan.entitlements, 'selling.offers'), smartSelling: ctx.plan !== null && allows(ctx.plan.entitlements, 'selling.smart') };
    const [read, upgrade] = await Promise.all([salesRules(ctx.db, menuOf(ctx), new Date(), plan), upgradeInfo(ctx.db, ctx)]);
    return { ...read, upgrade };
  },
});

/** The menu's sales settings and its categories, marked when they complete a meal. */
export const settings = defineQuery({
  name: 'sales.settings',
  permission: 'content.edit',
  input: z.object({ menuId: idField }),
  target: (i) => atMenu(i.menuId),
  run: async (ctx): Promise<SalesSettingsView & { upgrade: UpgradeInfo }> => {
    const [read, upgrade] = await Promise.all([salesSettingsView(ctx.db, menuOf(ctx)), upgradeInfo(ctx.db, ctx)]);
    return { ...read, upgrade };
  },
});

/**
 * The Overview: the advisor for every plan, and the menu engineering classes and suggestion results when the plan
 * includes the insights.
 */
export const overview = defineQuery({
  name: 'sales.overview',
  permission: 'content.edit',
  input: z.object({ menuId: idField }),
  target: (i) => atMenu(i.menuId),
  run: async (ctx): Promise<SalesOverview & { upgrade: UpgradeInfo }> => {
    const allowed = ctx.plan !== null && allows(ctx.plan.entitlements, 'selling.insights');
    const [read, upgrade] = await Promise.all([salesOverview(ctx.db, menuOf(ctx), new Date(), allowed), upgradeInfo(ctx.db, ctx)]);
    return { ...read, upgrade };
  },
});
