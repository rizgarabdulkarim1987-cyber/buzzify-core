import { z } from 'zod';
import { restaurantLogoOf, type RestaurantLogo } from '@/server/pos/brand';
import { defineQuery } from '@/server/studio/framework/query';

/** The restaurant's own logo for the till header. Every till role may see it (`pin.own` is held by all four). */
export const posRestaurantLogo = defineQuery({
  name: 'pos.restaurantLogo',
  permission: null,
  pos: 'pin.own',
  input: z.object({}),
  target: () => ({ kind: 'pos' }),
  run: async (ctx): Promise<RestaurantLogo | null> => {
    if (ctx.restaurantId === null) throw new Error('A till query ran without a restaurant');
    return restaurantLogoOf(ctx.db, ctx.restaurantId);
  },
});
