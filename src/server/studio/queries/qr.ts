import { z } from 'zod';
import { defineQuery } from '@/server/studio/framework/query';
import { idField } from '@/server/studio/services/content';
import { listQrCodes, previewQrCode, qrStyleField } from '@/server/studio/services/qr';

/** What the QR tab reads: the menu's codes, drawn, with their scans of the last 30 days. */
export const list = defineQuery({
  name: 'qr.list',
  permission: 'qr.manage',
  input: z.object({ menuId: idField }),
  target: (i) => ({ kind: 'menu', menuId: i.menuId }),
  run: (ctx) => {
    if (ctx.menuId === null || ctx.restaurantId === null) throw new Error('A menu query ran without a menu');
    return listQrCodes(ctx.db, ctx.menuId, ctx.restaurantId);
  },
});

/** A code in a style that is not saved yet, drawn as the QR tab's style controls change. */
export const preview = defineQuery({
  name: 'qr.preview',
  permission: 'qr.manage',
  input: z.object({ menuId: idField, qrCodeId: idField, style: qrStyleField }),
  target: (i) => ({ kind: 'menu', menuId: i.menuId }),
  run: (ctx, input) => {
    if (ctx.menuId === null || ctx.restaurantId === null) throw new Error('A menu query ran without a menu');
    return previewQrCode(ctx.db, ctx.menuId, ctx.restaurantId, input);
  },
});
