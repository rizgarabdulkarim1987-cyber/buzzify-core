import { z } from 'zod';
import { defineQuery } from '@/server/studio/framework/query';

/** After how many idle minutes the till signs out (0: never). Every till role may read it (`pin.own` is held by all four). */
export const posIdleMinutes = defineQuery({
  name: 'pos.idleMinutes',
  permission: null,
  pos: 'pin.own',
  input: z.object({}),
  target: () => ({ kind: 'pos' }),
  run: async (ctx): Promise<number> => {
    if (ctx.restaurantId === null) throw new Error('A till query ran without a restaurant');
    const row = await ctx.db.posSettings.findFirst({ where: { restaurantId: ctx.restaurantId }, select: { idleMinutes: true } });
    return row?.idleMinutes ?? 15;
  },
});
