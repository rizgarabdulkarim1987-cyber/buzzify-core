import { z } from 'zod';
import { listDrivers, listZones } from '@/server/pos/delivery-setup';
import { findRecentCustomerIn, readOffPremiseBoard } from '@/server/pos/off-premise';
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

/** The live takeaway and delivery orders, and the cash the drivers hold. */
export const posOffPremiseBoard = defineQuery({
  name: 'pos.offPremiseBoard',
  permission: null,
  pos: 'order.handle',
  input: z.object({}),
  target: () => TILL,
  run: (ctx) => readOffPremiseBoard(ctx.db, restaurantOf(ctx)),
});

/** Whether this restaurant takes takeaway and delivery orders, for the board's tabs. */
export const posOffPremiseFlags = defineQuery({
  name: 'pos.offPremiseFlags',
  permission: null,
  pos: 'order.handle',
  input: z.object({}),
  target: () => TILL,
  run: async (ctx) => {
    const settings = await ctx.db.posSettings.findFirst({ where: { restaurantId: restaurantOf(ctx) }, select: { takeawayEnabled: true, deliveryEnabled: true } });
    return { takeaway: settings?.takeawayEnabled === true, delivery: settings?.deliveryEnabled === true };
  },
});
