import { z } from 'zod';
import { allows } from '@/server/domain/entitlements';
import { defineQuery, type QueryContext } from '@/server/studio/framework/query';
import { idField } from '@/server/studio/services/content';
import { upgradeInfo } from '@/server/studio/services/plans';
import { listQrCodes, previewQrCode, qrStyleField } from '@/server/studio/services/qr';

function placeOf(ctx: QueryContext) {
  if (ctx.menuId === null || ctx.restaurantId === null || ctx.plan === null) throw new Error('A menu query ran without a menu');
  return { menuId: ctx.menuId, restaurantId: ctx.restaurantId, plan: ctx.plan };
}

/**
 * What the QR tab reads: the menu's codes, drawn as the plan allows, with their scans of the last 30 days; whether the
 * plan includes brand colours and the logo, and the upgrade hint's data when it does not.
 */
export const list = defineQuery({
  name: 'qr.list',
  permission: 'qr.manage',
  input: z.object({ menuId: idField }),
  target: (i) => ({ kind: 'menu', menuId: i.menuId }),
  run: async (ctx) => {
    const { menuId, restaurantId, plan } = placeOf(ctx);
    const [view, upgrade] = await Promise.all([listQrCodes(ctx.db, menuId, restaurantId, plan.entitlements), upgradeInfo(ctx.db, ctx)]);
    return { ...view, branded: allows(plan.entitlements, 'qr.branded'), upgrade };
  },
});

/** A code in a style that is not saved yet, drawn as the QR tab's style controls change. */
export const preview = defineQuery({
  name: 'qr.preview',
  permission: 'qr.manage',
  input: z.object({ menuId: idField, qrCodeId: idField, style: qrStyleField }),
  target: (i) => ({ kind: 'menu', menuId: i.menuId }),
  run: (ctx, input) => {
    const { menuId, restaurantId, plan } = placeOf(ctx);
    return previewQrCode(ctx.db, menuId, restaurantId, plan.entitlements, input);
  },
});
