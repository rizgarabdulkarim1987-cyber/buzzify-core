import { z } from 'zod';
import { listDrivers, listZones } from '@/server/pos/delivery-setup';
import { findRecentCustomerIn } from '@/server/pos/off-premise';
import { defineQuery, type QueryContext } from '@/server/studio/framework/query';

/** The delivery lists, read for the person's own restaurant. */

const TILL = { kind: 'pos' } as const;

function restaurantOf(ctx: QueryContext): string {
  if (ctx.restaurantId === null) throw new Error('A till query ran without a restaurant');
  return ctx.restaurantId;
}

/** Every zone and driver, inactive ones included, for the setup page. */
export const posDeliverySetup = defineQuery({
  name: 'pos.deliverySetup',
  permission: null,
  pos: 'settings.manage',
  input: z.object({}),
  target: () => TILL,
  run: async (ctx) => {
    const restaurantId = restaurantOf(ctx);
    const [zones, drivers] = await Promise.all([listZones(ctx.db, restaurantId), listDrivers(ctx.db, restaurantId)]);
    return { zones, drivers };
  },
});

/** The active zones and drivers a delivery order picks from. */
export const posDeliveryOptions = defineQuery({
  name: 'pos.deliveryOptions',
  permission: null,
  pos: 'order.handle',
  input: z.object({}),
  target: () => TILL,
  run: async (ctx) => {
    const restaurantId = restaurantOf(ctx);
    const [zones, drivers] = await Promise.all([listZones(ctx.db, restaurantId, { activeOnly: true }), listDrivers(ctx.db, restaurantId, { activeOnly: true })]);
    return { zones, drivers };
  },
});

/** The last delivery to this phone number, to fill in a returning customer's details. */
export const posRecentCustomer = defineQuery({
  name: 'pos.recentCustomer',
  permission: null,
  pos: 'order.handle',
  input: z.object({ phone: z.string().trim().max(40) }),
  target: () => TILL,
  run: (ctx, { phone }) => findRecentCustomerIn(ctx.db, restaurantOf(ctx), phone),
});
