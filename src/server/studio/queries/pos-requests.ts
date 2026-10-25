import { z } from 'zod';
import { listPendingDetails, readRequest } from '@/server/pos/customer-orders';
import { readQrFlags, readQrSheet } from '@/server/pos/qr-sheet';
import { hostEnv } from '@/server/env';
import { defineQuery, type QueryContext } from '@/server/studio/framework/query';
import { idField } from '@/server/studio/services/content';

/** The guests' QR orders, read for the person's own restaurant. */

const TILL = { kind: 'pos' } as const;

function restaurantOf(ctx: QueryContext): string {
  if (ctx.restaurantId === null) throw new Error('A till query ran without a restaurant');
  return ctx.restaurantId;
}

/** Requests waiting for the cashier, oldest first, with the time they were read at. */
export const posRequests = defineQuery({
  name: 'pos.requests',
  permission: null,
  pos: 'order.handle',
  input: z.object({}),
  target: () => TILL,
  run: async (ctx) => {
    const readAt = new Date();
    return { readAt, requests: await listPendingDetails(ctx.db, restaurantOf(ctx), readAt) };
  },
});

export const posRequest = defineQuery({
  name: 'pos.request',
  permission: null,
  pos: 'order.handle',
  input: z.object({ requestId: idField }),
  target: () => TILL,
  run: (ctx, { requestId }) => readRequest(ctx.db, restaurantOf(ctx), requestId),
});

/** The table codes to print, for the restaurant's catalog menu. Refused until a catalog menu exists. */
export const posQrSheet = defineQuery({
  name: 'pos.qrSheet',
  permission: null,
  pos: 'settings.manage',
  input: z.object({}),
  target: () => ({ kind: 'pos', catalog: true }) as const,
  run: (ctx) => readQrSheet(ctx.db, restaurantOf(ctx), ctx.menuId, hostEnv().publicOrigin),
});

/** Whether QR ordering is on and how many guest orders wait, for the till frame's navigation. */
export const posQrFlags = defineQuery({
  name: 'pos.qrFlags',
  permission: null,
  pos: 'order.handle',
  input: z.object({}),
  target: () => TILL,
  run: (ctx) => readQrFlags(ctx.db, restaurantOf(ctx)),
});
