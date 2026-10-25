import { z } from 'zod';
import { listPendingRequests, readRequest } from '@/server/pos/customer-orders';
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
    return { readAt, requests: await listPendingRequests(ctx.db, restaurantOf(ctx), readAt) };
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
