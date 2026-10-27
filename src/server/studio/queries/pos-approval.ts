import { z } from 'zod';
import { approversFor } from '@/server/pos/approval';
import { defineQuery } from '@/server/studio/framework/query';

const TILL = { kind: 'pos' } as const;

/** Who can approve a discount or cancel at this till; null when the person needs no approval. */
export const posApprovers = defineQuery({
  name: 'pos.approvers',
  permission: null,
  pos: 'order.handle',
  input: z.object({}),
  target: () => TILL,
  run: async (ctx) => {
    if (ctx.restaurantId === null || ctx.pos === null) throw new Error('A till query ran without a restaurant');
    return approversFor(ctx.db, ctx.restaurantId, ctx.pos.role);
  },
});
