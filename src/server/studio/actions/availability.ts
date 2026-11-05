import { z } from 'zod';
import { defineAction } from '@/server/studio/framework/action';
import { setOptionAvailability, setProductAvailability, setProductDrop, setProductStock } from '@/server/studio/services/availability';
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

export const setStock = defineAction({
  name: 'availability.setStock',
  permission: 'content.availability',
  input: z.object({
    menuId: idField,
    productId: idField,
    stockCount: z.number().int().min(0, 'Enter a number from 0 to 9,999').max(9999, 'Enter a number from 0 to 9,999').nullable(),
  }),
  target: (i) => atMenu(i.menuId),
  run: (ctx, input) => setProductStock(ctx, input),
});

const instant = z.iso.datetime({ offset: true }).transform((text) => new Date(text));

/** A limited drop's window, or both null to take it away. Setting one needs the plan feature, checked in the service. */
export const setDrop = defineAction({
  name: 'availability.setDrop',
  permission: 'content.availability',
  input: z
    .object({ menuId: idField, productId: idField, startsAt: instant.nullable(), endsAt: instant.nullable() })
    .refine((input) => (input.startsAt === null) === (input.endsAt === null), { message: 'Choose when the drop starts and ends', path: ['endsAt'] })
    .refine((input) => input.startsAt === null || input.endsAt === null || input.endsAt > input.startsAt, { message: 'The drop must end after it starts', path: ['endsAt'] }),
  target: (i) => atMenu(i.menuId),
  run: (ctx, input) => setProductDrop(ctx, input),
});

export const setOption = defineAction({
  name: 'availability.setOption',
  permission: 'content.availability',
  input: z.object({ menuId: idField, optionId: idField, isAvailable: z.boolean() }),
  target: (i) => atMenu(i.menuId),
  run: (ctx, input) => setOptionAvailability(ctx, input),
});
