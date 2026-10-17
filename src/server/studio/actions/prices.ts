import { z } from 'zod';
import { defineAction } from '@/server/studio/framework/action';
import { idField, priceField } from '@/server/studio/services/content';
import { applyBulk as applyBulkChange, bulkFields, setPrice } from '@/server/studio/services/prices';

/**
 * The Prices tab's changes (spec 10.3, 13.4): one price (`content.prices`), or a bulk change from its preview
 * (`prices.bulk`). Both write the draft; guests see the new prices after a publish.
 */

const atMenu = (menuId: string) => ({ kind: 'menu', menuId }) as const;

export const set = defineAction({
  name: 'prices.set',
  permission: 'content.prices',
  input: z.object({
    menuId: idField,
    target: z.object({ kind: z.enum(['product', 'variant']), id: idField, version: z.number().int().min(1) }),
    price: priceField,
  }),
  target: (i) => atMenu(i.menuId),
  run: (ctx, input) => setPrice(ctx, input),
});

export const applyBulk = defineAction({
  name: 'prices.applyBulk',
  permission: 'prices.bulk',
  input: z.object({ menuId: idField, ...bulkFields, expectedDraftHash: z.string().max(128) }),
  target: (i) => atMenu(i.menuId),
  run: (ctx, input) => applyBulkChange(ctx, input),
});
