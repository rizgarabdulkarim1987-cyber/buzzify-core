import { z } from 'zod';
import { allowedFontPairs, allowedMotions, allowedRails, clampBrandChoices, hiddenChoices } from '@/server/domain/plan-choices';
import { defineQuery, type QueryContext } from '@/server/studio/framework/query';
import { brandKit, paletteSuggestions, type BrandPlanView } from '@/server/studio/services/brand';
import { upgradeInfo } from '@/server/studio/services/plans';
import { idField } from '@/server/studio/services/content';

/** What the Brand tab reads: the kit, and palettes suggested from a logo. */

const atMenu = (menuId: string) => ({ kind: 'menu', menuId }) as const;

function placeOf(ctx: QueryContext): { menuId: string; restaurantId: string } {
  if (ctx.menuId === null || ctx.restaurantId === null) throw new Error('A menu query ran without a menu');
  return { menuId: ctx.menuId, restaurantId: ctx.restaurantId };
}

export const get = defineQuery({
  name: 'brand.get',
  permission: 'brand.edit',
  input: z.object({ menuId: idField }),
  target: (i) => atMenu(i.menuId),
  run: async (ctx) => {
    const { menuId, restaurantId } = placeOf(ctx);
    if (ctx.plan === null) throw new Error('brand.get ran without a plan');
    const [kit, upgrade] = await Promise.all([brandKit(ctx.db, menuId, restaurantId), upgradeInfo(ctx.db, ctx)]);
    const { entitlements } = ctx.plan;
    const chosen = { fontPairId: kit.fontPairId, railStyle: kit.railStyle, motionIntensity: kit.motionIntensity };
    return {
      ...kit,
      // What the plan offers, and which of the kit's choices guests do not see on it (kept, never lost).
      plan: {
        fontPairs: allowedFontPairs(entitlements),
        rails: allowedRails(entitlements),
        motions: allowedMotions(entitlements),
        hidden: hiddenChoices(chosen, entitlements),
        guestSees: clampBrandChoices(chosen, entitlements),
        upgrade,
      } satisfies BrandPlanView,
    };
  },
});

export const suggestFromLogo = defineQuery({
  name: 'brand.suggestFromLogo',
  permission: 'brand.edit',
  input: z.object({ menuId: idField, assetId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), theme: z.enum(['light', 'dark']) }),
  target: (i) => atMenu(i.menuId),
  run: (ctx, input) => paletteSuggestions(ctx.db, placeOf(ctx).restaurantId, input),
});
