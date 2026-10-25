import { z } from 'zod';
import { delegates } from '@/server/data/tenant-db';
import { isUniqueViolation, refuse } from '@/server/pos/errors';
import { advanceFulfillmentIn, assignDriverIn, openOffPremiseIn, updateOffPremiseDetailsIn, type OpenOffPremiseInput } from '@/server/pos/off-premise';
import { phoneField } from '@/server/pos/phone-field';
import { createDriverIn, createZoneIn, deleteZoneIn, updateDriverIn, updateZoneIn } from '@/server/pos/delivery-setup';
import { defineAction, type ActionContext } from '@/server/studio/framework/action';
import { idField } from '@/server/studio/services/content';

/** Delivery zones and drivers: the lists a delivery order picks from. Managed by whoever owns the till's settings. */

const TILL = { kind: 'pos' } as const;

const name = z.string().trim().min(1, 'Enter a name').max(60, 'Use at most 60 characters');
const fee = z.number().int().min(0).max(100_000_000);

function till(ctx: ActionContext) {
  if (ctx.pos === null || ctx.restaurantId === null) throw new Error('A till action ran without a till');
  return { restaurantId: ctx.restaurantId };
}

export const createPosZone = defineAction({
  name: 'pos.createZone',
  permission: null,
  pos: 'settings.manage',
  input: z.object({ name, fee }),
  target: () => TILL,
  run: (ctx, input) => {
    const { restaurantId } = till(ctx);
    return ctx.transaction(async (tx) => {
      const created = await createZoneIn(tx, restaurantId, input);
      ctx.audit({ action: 'pos.zone.create', entityType: 'PosDeliveryZone', entityId: created.id, changes: { name: { before: null, after: input.name }, fee: { before: null, after: input.fee } } });
      return { zoneId: created.id };
    });
  },
});

export const updatePosZone = defineAction({
  name: 'pos.updateZone',
  permission: null,
  pos: 'settings.manage',
  input: z
    .object({ zoneId: idField, name: name.optional(), fee: fee.optional(), active: z.boolean().optional() })
    .refine((v) => v.name !== undefined || v.fee !== undefined || v.active !== undefined, { message: 'Nothing to change', path: ['name'] }),
  target: () => TILL,
  run: (ctx, { zoneId, ...fields }) => {
    till(ctx);
    return ctx.transaction(async (tx) => {
      const done = await updateZoneIn(tx, zoneId, fields);
      const changes: Record<string, { before: unknown; after: unknown }> = {};
      for (const key of ['name', 'fee', 'active'] as const) if (fields[key] !== undefined && done.before[key] !== fields[key]) changes[key] = { before: done.before[key], after: fields[key] };
      ctx.audit({ action: 'pos.zone.update', entityType: 'PosDeliveryZone', entityId: zoneId, changes });
      return { zoneId };
    });
  },
});

export const deletePosZone = defineAction({
  name: 'pos.deleteZone',
  permission: null,
  pos: 'settings.manage',
  input: z.object({ zoneId: idField }),
  target: () => TILL,
  run: (ctx, { zoneId }) => {
    till(ctx);
    return ctx.transaction(async (tx) => {
      const zone = await deleteZoneIn(tx, zoneId);
      ctx.audit({ action: 'pos.zone.delete', entityType: 'PosDeliveryZone', entityId: zoneId, changes: { name: { before: zone.name, after: null }, fee: { before: zone.fee, after: null } } });
      return { zoneId };
    });
  },
});

export const createPosDriver = defineAction({
  name: 'pos.createDriver',
  permission: null,
  pos: 'settings.manage',
  input: z.object({ name, phone: phoneField(true) }),
  target: () => TILL,
  run: (ctx, input) => {
    const { restaurantId } = till(ctx);
    return ctx.transaction(async (tx) => {
      const created = await createDriverIn(tx, restaurantId, input);
      ctx.audit({ action: 'pos.driver.create', entityType: 'PosDriver', entityId: created.id, changes: { name: { before: null, after: input.name }, hasPhone: { before: null, after: input.phone !== '' } } });
      return { driverId: created.id };
    });
  },
});

export const updatePosDriver = defineAction({
  name: 'pos.updateDriver',
  permission: null,
  pos: 'settings.manage',
  input: z
    .object({ driverId: idField, name: name.optional(), phone: phoneField(true).optional(), active: z.boolean().optional() })
    .refine((v) => v.name !== undefined || v.phone !== undefined || v.active !== undefined, { message: 'Nothing to change', path: ['name'] }),
  target: () => TILL,
  run: (ctx, { driverId, ...fields }) => {
    till(ctx);
    return ctx.transaction(async (tx) => {
      const done = await updateDriverIn(tx, driverId, fields);
      const changes: Record<string, { before: unknown; after: unknown }> = {};
      if (fields.name !== undefined && done.before.name !== fields.name) changes.name = { before: done.before.name, after: fields.name };
      if (fields.active !== undefined && done.before.active !== fields.active) changes.active = { before: done.before.active, after: fields.active };
      if (fields.phone !== undefined && done.before.phone !== fields.phone) changes.phone = { before: done.before.phone !== '', after: fields.phone !== '' };
      ctx.audit({ action: 'pos.driver.update', entityType: 'PosDriver', entityId: driverId, changes });
      return { driverId };
    });
  },
});

// Takeaway and delivery orders ------------------------------------------------------------------------------------------

const INT32 = 2_147_483_647;
const OPEN_ATTEMPTS = 10;
const customerName = z.string().trim().max(120, 'Use at most 120 characters');
const addressText = z.string().trim().min(1, 'Enter an address').max(300, 'Use at most 300 characters');
const addressNote = z.string().trim().max(300, 'Use at most 300 characters');

const openInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('TAKEAWAY'), customerName: customerName.default(''), customerPhone: phoneField(true).default('') }),
  z.object({
    kind: z.literal('DELIVERY'),
    customerName: customerName.default(''),
    customerPhone: phoneField(false),
    address: addressText,
    addressNote: addressNote.default(''),
    zoneId: idField.nullable().default(null),
    deliveryFee: fee.nullable().default(null),
  }),
]);

export const openPosOffPremiseOrder = defineAction({
  name: 'pos.openOffPremiseOrder',
  permission: null,
  pos: 'order.handle',
  input: openInput,
  target: () => TILL,
  run: async (ctx, input) => {
    const { restaurantId } = till(ctx);
    const value: OpenOffPremiseInput =
      input.kind === 'TAKEAWAY'
        ? input
        : { kind: 'DELIVERY', customerName: input.customerName, customerPhone: input.customerPhone, address: input.address, addressNote: input.addressNote, zoneId: input.zoneId, deliveryFee: input.deliveryFee };
    // A lost race for the order number or the queue number is a unique violation; a failed transaction cannot go on, so retry.
    for (let attempt = 1; attempt <= OPEN_ATTEMPTS; attempt++) {
      try {
        return await ctx.transaction(async (tx) => {
          const opened = await openOffPremiseIn(delegates(tx), restaurantId, value);
          ctx.audit({
            action: 'pos.order.open',
            entityType: 'PosOrder',
            entityId: opened.orderId,
            changes: {
              number: { before: null, after: opened.number },
              kind: { before: null, after: input.kind },
              queueNumber: { before: null, after: opened.queueNumber },
              zoneId: { before: null, after: opened.zoneId },
              deliveryFee: { before: null, after: opened.deliveryFee },
              hasPhone: { before: null, after: input.customerPhone !== '' },
            },
          });
          return { orderId: opened.orderId, number: opened.number, queueNumber: opened.queueNumber, version: opened.version };
        });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 40));
      }
    }
    throw refuse('CONFLICT', 'Could not open the order. Try again.');
  },
});

export const updatePosOffPremiseDetails = defineAction({
  name: 'pos.updateOffPremiseDetails',
  permission: null,
  pos: 'order.handle',
  input: z
    .object({
      orderId: idField,
      expectedVersion: z.number().int().min(1).max(INT32),
      customerName: customerName.optional(),
      customerPhone: phoneField(true).optional(),
      address: z.string().trim().max(300, 'Use at most 300 characters').optional(),
      addressNote: addressNote.optional(),
      zoneId: idField.nullable().optional(),
      deliveryFee: fee.optional(),
    })
    .refine((v) => v.customerName !== undefined || v.customerPhone !== undefined || v.address !== undefined || v.addressNote !== undefined || v.zoneId !== undefined || v.deliveryFee !== undefined, {
      message: 'Nothing to change',
      path: ['customerName'],
    }),
  target: () => TILL,
  run: (ctx, input) => {
    const { restaurantId } = till(ctx);
    return ctx.transaction(async (tx) => {
      const done = await updateOffPremiseDetailsIn(delegates(tx), restaurantId, input);
      ctx.audit({
        action: 'pos.order.details',
        entityType: 'PosOrder',
        entityId: done.orderId,
        changes: { fields: { before: null, after: done.changed.join(',') }, deliveryFee: { before: done.fee.before, after: done.fee.after } },
      });
      return { orderId: done.orderId, version: done.version };
    });
  },
});

export const advancePosFulfillment = defineAction({
  name: 'pos.advanceFulfillment',
  permission: null,
  pos: 'order.handle',
  input: z.object({ orderId: idField, expectedVersion: z.number().int().min(1).max(INT32), to: z.enum(['PREPARING', 'READY', 'OUT', 'DELIVERED', 'PICKED_UP']) }),
  target: () => TILL,
  run: (ctx, input) => {
    const { restaurantId } = till(ctx);
    return ctx.transaction(async (tx) => {
      const done = await advanceFulfillmentIn(delegates(tx), restaurantId, input);
      ctx.audit({ action: 'pos.order.fulfillment', entityType: 'PosOrder', entityId: done.orderId, changes: { fulfillment: { before: done.from, after: done.to } } });
      return { orderId: done.orderId, version: done.version };
    });
  },
});

export const assignPosDriver = defineAction({
  name: 'pos.assignDriver',
  permission: null,
  pos: 'order.handle',
  input: z.object({ orderId: idField, expectedVersion: z.number().int().min(1).max(INT32), driverId: idField.nullable() }),
  target: () => TILL,
  run: (ctx, input) => {
    const { restaurantId } = till(ctx);
    return ctx.transaction(async (tx) => {
      const done = await assignDriverIn(delegates(tx), restaurantId, input);
      ctx.audit({ action: 'pos.order.driver', entityType: 'PosOrder', entityId: done.orderId, changes: { driverId: { before: done.before, after: done.after } } });
      return { orderId: done.orderId, version: done.version };
    });
  },
});
