import { z } from 'zod';
import { ownedRetailShops } from '@/server/retail/handoff';
import { defineQuery } from '@/server/studio/framework/query';

/**
 * The retail shops the signed-in person owns, for the handoff's chooser (`/studio/retail/choose`): name and whether
 * Buzzify Retail has provisioned it. Keyed by the actor's own OWNER memberships, never by an id from the input.
 */
export const myRetailShops = defineQuery({
  name: 'retail.myShops',
  permission: null,
  input: z.unknown(),
  target: () => ({ kind: 'self' }),
  run: async ({ actor, db }) => ownedRetailShops(db, actor.userId),
});
