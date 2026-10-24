import { z } from 'zod';
import { POS_ROLES } from '@/server/domain/pos/permissions';
import { chooseCatalogMenu as choose, ensureCatalogMenu as ensure } from '@/server/pos/catalog-menu';
import { POS_PAYMENT_METHODS, savePosSettings, settingsChanges } from '@/server/pos/settings';
import {
  addPosStaff,
  changePosStaffRole as changeRole,
  deactivateIn,
  mayAssign,
  reactivateIn,
  refuseRole,
  staffRowRole,
} from '@/server/pos/staff';
import { emailField } from '@/server/studio/auth/fields';
import { passwordProblemMessage } from '@/server/studio/auth/password-policy';
import { createPasswordUser, EmailTakenError, PasswordPolicyError } from '@/server/studio/auth/users';
import { defineAction, type ActionContext } from '@/server/studio/framework/action';
import { StudioError } from '@/server/studio/framework/result';

/**
 * The cashier's own settings and staff, behind the same framework as the Studio: a till permission instead of a Studio
 * one, and the restaurant is the person's own (their staff row or OWNER membership), never read from the input.
 */

const TILL = { kind: 'pos' } as const;

const percent = z.number().int().min(0).max(100);

/** The restaurant and person the framework has resolved for a till action. */
function till(ctx: ActionContext) {
  if (ctx.pos === null || ctx.restaurantId === null) throw new Error('A till action ran without a till');
  return { pos: ctx.pos, restaurantId: ctx.restaurantId };
}

export const updatePosSettings = defineAction({
  name: 'pos.updateSettings',
  permission: null,
  pos: 'settings.manage',
  input: z.object({
    serviceRatePercent: percent,
    taxRatePercent: percent,
    enabledPaymentMethods: z.array(z.enum(POS_PAYMENT_METHODS)).min(1).max(POS_PAYMENT_METHODS.length),
    tableRingMinutes: z.number().int().min(1).max(1440),
    kitchenPrintEnabled: z.boolean(),
    kitchenScreenEnabled: z.boolean(),
    qrOrderingEnabled: z.boolean(),
    takeawayEnabled: z.boolean(),
    deliveryEnabled: z.boolean(),
    complaintsEnabled: z.boolean(),
    version: z.number().int().min(0),
  }),
  target: () => TILL,
  run: (ctx, input) => {
    const { restaurantId } = till(ctx);
    return ctx.transaction(async (tx) => {
      const { id, before, after } = await savePosSettings(tx, restaurantId, input);
      ctx.audit({ action: 'pos.settings.update', entityType: 'PosSettings', entityId: id, changes: settingsChanges(before, after) });
      return { version: after.version };
    });
  },
});

export const createPosStaff = defineAction({
  name: 'pos.createStaff',
  permission: null,
  pos: 'staff.manage',
  input: z.object({
    name: z.string().trim().min(1, 'Enter your name').max(120, 'Use at most 120 characters'),
    email: emailField,
    role: z.enum(POS_ROLES),
    // Only for a person who has no account yet; an existing account keeps its own password.
    password: z.string().max(1024, 'Use at most 128 characters').optional(),
  }),
  target: () => TILL,
  run: async (ctx, input) => {
    const { pos, restaurantId } = till(ctx);
    if (!mayAssign(pos.role, input.role, null)) throw refuseRole();

    const existing = await ctx.db.user.findUnique({ where: { email: input.email }, select: { id: true, isSuperAdmin: true, deactivatedAt: true } });
    let userId: string;
    if (existing) {
      // A Super Admin and a switched-off account never work a till.
      if (existing.isSuperAdmin || existing.deactivatedAt) throw new StudioError('CONFLICT', 'An account with this email already exists');
      userId = existing.id;
    } else {
      if (!input.password) throw new StudioError('INVALID', undefined, { password: 'Choose a password' });
      try {
        ({ userId } = await createPasswordUser(ctx.db, {
          email: input.email,
          name: input.name,
          password: input.password,
          locale: ctx.actor.locale,
        }));
      } catch (error) {
        if (error instanceof PasswordPolicyError) throw new StudioError('INVALID', undefined, { password: passwordProblemMessage(error.reason) });
        if (error instanceof EmailTakenError) throw new StudioError('CONFLICT', 'An account with this email already exists');
        throw error;
      }
    }

    return ctx.transaction(async (tx) => {
      const { id } = await addPosStaff(tx, { restaurantId, userId, role: input.role });
      ctx.audit({
        action: 'pos.staff.create',
        entityType: 'PosStaff',
        entityId: id,
        changes: { role: { before: null, after: input.role }, email: { before: null, after: input.email } },
      });
      return { staffId: id };
    });
  },
});

export const changePosStaffRole = defineAction({
  name: 'pos.changeStaffRole',
  permission: null,
  pos: 'staff.manage',
  input: z.object({ staffId: z.string().min(1).max(100), role: z.enum(POS_ROLES) }),
  target: () => TILL,
  run: (ctx, { staffId, role }) => {
    const { pos, restaurantId } = till(ctx);
    return ctx.transaction(async (tx) => {
      if (!mayAssign(pos.role, role, await staffRowRole(tx, staffId))) throw refuseRole();
      const result = await changeRole(tx, { restaurantId, actingUserId: pos.userId, staffId, role });
      ctx.audit({ action: 'pos.staff.role', entityType: 'PosStaff', entityId: result.id, changes: { role: { before: result.before, after: result.after } } });
      return { staffId: result.id };
    });
  },
});

export const setPosStaffActive = defineAction({
  name: 'pos.setStaffActive',
  permission: null,
  pos: 'staff.manage',
  input: z.object({ staffId: z.string().min(1).max(100), active: z.boolean() }),
  target: () => TILL,
  run: (ctx, { staffId, active }) => {
    const { pos, restaurantId } = till(ctx);
    return ctx.transaction(async (tx) => {
      const current = await staffRowRole(tx, staffId);
      if (!mayAssign(pos.role, current, current)) throw refuseRole();
      const args = { restaurantId, actingUserId: pos.userId, staffId };
      const result = active ? await reactivateIn(tx, args) : await deactivateIn(tx, args);
      ctx.audit({
        action: active ? 'pos.staff.reactivate' : 'pos.staff.deactivate',
        entityType: 'PosStaff',
        entityId: result.id,
        changes: { active: { before: !active, after: active } },
      });
      return { staffId: result.id };
    });
  },
});

export const ensureCatalogMenu = defineAction({
  name: 'pos.ensureCatalogMenu',
  permission: null,
  pos: 'catalog.manage',
  input: z.object({}),
  target: () => TILL,
  run: (ctx) => ensure(ctx),
});

export const chooseCatalogMenu = defineAction({
  name: 'pos.chooseCatalogMenu',
  permission: null,
  pos: 'catalog.manage',
  input: z.object({ menuId: z.string().min(1).max(100) }),
  target: () => TILL,
  run: (ctx, { menuId }) => choose(ctx, menuId),
});
