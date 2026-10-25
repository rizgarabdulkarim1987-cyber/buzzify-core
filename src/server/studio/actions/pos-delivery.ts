import { z } from 'zod';
import { delegates } from '@/server/data/tenant-db';
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
