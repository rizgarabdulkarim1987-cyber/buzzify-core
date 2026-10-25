import { z } from 'zod';
import { delegates } from '@/server/data/tenant-db';
import { mayAssign, refuseRole } from '@/server/pos/staff';
import {
  assertAcceptablePin,
  assertPinAllowed,
  ELIGIBILITY_SELECT,
  hashPin,
  passwordMatches,
  pinEligible,
  registerDeviceIn,
  revokeDeviceIn,
} from '@/server/pos/pin';
import { defineAction, type ActionContext } from '@/server/studio/framework/action';
import { StudioError } from '@/server/studio/framework/result';
import { checkRateLimit, RATE_RULES } from '@/server/studio/auth/rate-limit';
import { idField } from '@/server/studio/services/content';

/** Quick sign-in by PIN: each person's own PIN, a manager clearing one, and the shared devices a PIN works on. */

const TILL = { kind: 'pos' } as const;

function till(ctx: ActionContext) {
  if (ctx.pos === null || ctx.restaurantId === null) throw new Error('A till action ran without a till');
  return { pos: ctx.pos, restaurantId: ctx.restaurantId };
}

export const setOwnPosPin = defineAction({
  name: 'pos.setOwnPin',
  permission: null,
  pos: 'pin.own',
  input: z.object({ pin: z.string().max(16), password: z.string().max(1024) }),
  target: () => TILL,
  run: async (ctx, { pin, password }) => {
    const { pos, restaurantId } = till(ctx);
    assertAcceptablePin(pin);
    const staff = await ctx.db.posStaff.findFirst({
      where: { restaurantId, userId: pos.userId, deactivatedAt: null },
      select: { id: true, user: { select: ELIGIBILITY_SELECT } },
    });
    assertPinAllowed(staff !== null && pinEligible(staff.user));
    const verdict = await checkRateLimit(ctx.db, `reauth:user:${pos.userId}`, RATE_RULES['reauth:user'], new Date());
    if (!verdict.allowed) throw new StudioError('RATE_LIMITED', undefined, { retryAfterSec: String(verdict.retryAfterSec) });
    if (!(await passwordMatches(ctx.db, pos.userId, password))) throw new StudioError('INVALID', undefined, { password: 'That password is not correct' });
    const pinHash = await hashPin(pin);
    return ctx.transaction(async (tx) => {
      await tx.posStaff.updateMany({ where: { id: staff!.id, restaurantId }, data: { pinHash, pinSetAt: new Date(), pinFailedCount: 0, pinLockedUntil: null } });
      ctx.audit({ action: 'pos.staff.pin.set', entityType: 'PosStaff', entityId: staff!.id });
      return { staffId: staff!.id };
    });
  },
});

export const clearPosStaffPin = defineAction({
  name: 'pos.clearStaffPin',
  permission: null,
  pos: 'staff.manage',
  input: z.object({ staffId: idField }),
  target: () => TILL,
  run: (ctx, { staffId }) => {
    const { pos, restaurantId } = till(ctx);
    return ctx.transaction(async (tx) => {
      const row = await tx.posStaff.findFirst({ where: { id: staffId }, select: { id: true, userId: true, role: true } });
      if (!row) throw new StudioError('NOT_FOUND');
      if (row.userId === pos.userId) throw new StudioError('FORBIDDEN', 'You cannot change your own role or access');
      if (!mayAssign(pos.role, row.role, row.role)) throw refuseRole();
      await tx.posStaff.updateMany({ where: { id: row.id, restaurantId }, data: { pinHash: null, pinSetAt: null, pinFailedCount: 0, pinLockedUntil: null } });
      ctx.audit({ action: 'pos.staff.pin.clear', entityType: 'PosStaff', entityId: row.id });
      return { staffId: row.id };
    });
  },
});

export const registerPosDevice = defineAction({
  name: 'pos.registerDevice',
  permission: null,
  pos: 'settings.manage',
  input: z.object({ name: z.string().trim().min(1, 'Enter a device name').max(60, 'Use at most 60 characters') }),
  target: () => TILL,
  run: (ctx, { name }) => {
    const { pos, restaurantId } = till(ctx);
    return ctx.transaction(async (tx) => {
      const done = await registerDeviceIn(delegates(tx), restaurantId, { name, userId: pos.userId });
      ctx.audit({ action: 'pos.device.register', entityType: 'PosSharedDevice', entityId: done.deviceId, changes: { name: { before: null, after: name } } });
      return done;
    });
  },
});

export const revokePosDevice = defineAction({
  name: 'pos.revokeDevice',
  permission: null,
  pos: 'settings.manage',
  input: z.object({ deviceId: idField }),
  target: () => TILL,
  run: (ctx, { deviceId }) => {
    const { restaurantId } = till(ctx);
    return ctx.transaction(async (tx) => {
      await revokeDeviceIn(delegates(tx), restaurantId, deviceId);
      ctx.audit({ action: 'pos.device.revoke', entityType: 'PosSharedDevice', entityId: deviceId });
      return { deviceId };
    });
  },
});
