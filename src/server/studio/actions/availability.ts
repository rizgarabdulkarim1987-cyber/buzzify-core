import { z } from 'zod';
import { defineAction } from '@/server/studio/framework/action';
import { setOptionAvailability, setProductAvailability } from '@/server/studio/services/availability';
import { idField } from '@/server/studio/services/content';

/**
 * The Availability tab's switches (spec 10.3): sold out and hidden for a product, sold out for an option. They change
 * what guests see at once, without a publish, so they need `content.availability` rather than `content.edit`.
 */

const atMenu = (menuId: string) => ({ kind: 'menu', menuId }) as const;

export const setProduct = defineAction({
  name: 'availability.setProduct',
  permission: 'content.availability',
  input: z
    .object({ menuId: idField, productId: idField, isAvailable: z.boolean().optional(), isHidden: z.boolean().optional() })
    .refine((input) => input.isAvailable !== undefined || input.isHidden !== undefined, 'Choose what to change'),
  target: (i) => atMenu(i.menuId),
  run: (ctx, input) => setProductAvailability(ctx, input),
});

export const setOption = defineAction({
  name: 'availability.setOption',
  permission: 'content.availability',
  input: z.object({ menuId: idField, optionId: idField, isAvailable: z.boolean() }),
  target: (i) => atMenu(i.menuId),
  run: (ctx, input) => setOptionAvailability(ctx, input),
});
