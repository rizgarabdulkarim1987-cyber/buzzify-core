import { z } from 'zod';
import { listDevices } from '@/server/pos/pin';
import { defineQuery } from '@/server/studio/framework/query';

/** The shared devices a manager has registered for quick PIN sign-in (never their tokens). */
export const posDevices = defineQuery({
  name: 'pos.devices',
  permission: null,
  pos: 'settings.manage',
  input: z.object({}),
  target: () => ({ kind: 'pos' }) as const,
  run: (ctx) => {
    if (ctx.restaurantId === null) throw new Error('A till query ran without a restaurant');
    return listDevices(ctx.db, ctx.restaurantId);
  },
});
