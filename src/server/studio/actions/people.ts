import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import type { ScopedTx } from '@/server/data/tenant-db';
import { parsePolicy } from '@/server/domain/permissions';
import { sendAfterResponse } from '@/server/studio/auth/auth';
import { emailField } from '@/server/studio/auth/fields';
import { defineAction, type ActionContext } from '@/server/studio/framework/action';
import { updateWithVersion } from '@/server/studio/framework/concurrency';
import { StudioError } from '@/server/studio/framework/result';
import { createInvitation, reissueInvitation, revokeInvitation as revoke } from '@/server/studio/services/invitations';
import { assignDesigner as assign, changeEmail, deactivatePerson, reactivatePerson, unassignMember as unassign } from '@/server/studio/services/people';

/**
 * People, invitations and per-client permissions. Platform-wide changes (staff, accounts, who is assigned where) are
 * `people.manage`, which only Super Admins hold; an owner invites other owners only where the client's policy grants
 * `people.invite`, and only into their own restaurant. A link is only ever mailed to the invited address: no action
 * returns it, since whoever holds it can accept it. Nothing here writes a token, a hash or a password to the audit log.
 */

const idField = z.string().min(1).max(100);

const PLATFORM = { kind: 'platform' } as const;
const atRestaurant = (restaurantId: string) => ({ kind: 'restaurant', restaurantId }) as const;

/** The restaurant a restaurant-target action works on. The framework has already resolved it. */
function restaurantOf(ctx: ActionContext): string {
  if (ctx.restaurantId === null) throw new Error('A restaurant action ran without a restaurant');
  return ctx.restaurantId;
}

// Invitations ---------------------------------------------------------------------------------------------------------

export const inviteStaff = defineAction({
  name: 'people.inviteStaff',
  permission: 'people.manage',
  input: z.object({ email: emailField, asSuperAdmin: z.boolean() }),
  target: () => PLATFORM,
  run: (ctx, { email, asSuperAdmin }) =>
    ctx.transaction(async (tx) => {
      const { invitationId } = await createInvitation(
        tx,
        { email, restaurantId: null, role: null, asSuperAdmin, invitedById: ctx.actor.userId, now: new Date() },
        { afterCommit: ctx.afterCommit },
      );
      ctx.audit({
        action: 'invitation.created',
        entityType: 'Invitation',
        entityId: invitationId,
        changes: { email: { before: null, after: email }, asSuperAdmin: { before: null, after: asSuperAdmin } },
      });
      return { invitationId };
    }),
});

export const inviteOwner = defineAction({
  name: 'people.inviteOwner',
  permission: 'people.invite',
  input: z.object({ restaurantId: idField, email: emailField }),
  target: (i) => atRestaurant(i.restaurantId),
  run: (ctx, { email }) =>
    ctx.transaction(async (tx) => {
      const { invitationId } = await createInvitation(
        tx,
        { email, restaurantId: restaurantOf(ctx), role: 'OWNER', asSuperAdmin: false, invitedById: ctx.actor.userId, now: new Date() },
        { afterCommit: ctx.afterCommit },
      );
      ctx.audit({
        action: 'invitation.created',
        entityType: 'Invitation',
        entityId: invitationId,
        changes: { email: { before: null, after: email }, role: { before: null, after: 'OWNER' } },
      });
      return { invitationId };
    }),
});

/**
 * The invitation to revoke or resend, if the actor may touch it. A restaurant target reaches that restaurant's
 * invitations, the platform target (Super Admins only) reaches every one, and a staff invitation also needs
 * `people.manage`, the permission that creates it. Everything else is simply not found. The invitation table is not
 * scoped to a restaurant, so this is where its restaurant is checked against the target's.
 */
async function reachableInvitation(tx: ScopedTx, ctx: ActionContext, invitationId: string) {
  const row = await tx.invitation.findUnique({ where: { id: invitationId }, select: { id: true, email: true, restaurantId: true, expiresAt: true } });
  if (!row || (ctx.restaurantId !== null && row.restaurantId !== ctx.restaurantId)) throw new StudioError('NOT_FOUND');
  if (row.restaurantId === null && !ctx.permissions.has('people.manage')) throw new StudioError('FORBIDDEN');
  return row;
}

// For an owner's invitation, name its restaurant: the audit row is filed under it. Without one the action is the
// platform's, which is for staff invitations (and lets a Super Admin act on any other).
const invitationTarget = z.object({ invitationId: idField, restaurantId: idField.optional() });
const invitationTargetOf = (i: { restaurantId?: string | undefined }) => (i.restaurantId === undefined ? PLATFORM : atRestaurant(i.restaurantId));

export const revokeInvitation = defineAction({
  name: 'people.revokeInvitation',
  permission: 'people.invite',
  input: invitationTarget,
  target: invitationTargetOf,
  run: (ctx, { invitationId }) =>
    ctx.transaction(async (tx) => {
      const row = await reachableInvitation(tx, ctx, invitationId);
      const now = new Date();
      await revoke(tx, { invitationId: row.id, now });
      ctx.audit({
        action: 'invitation.revoked',
        entityType: 'Invitation',
        entityId: row.id,
        changes: { revokedAt: { before: null, after: now.toISOString() } },
      });
      return { revoked: true as const };
    }),
});

export const resendInvitation = defineAction({
  name: 'people.resendInvitation',
  permission: 'people.invite',
  input: invitationTarget,
  target: invitationTargetOf,
  run: (ctx, { invitationId }) =>
    ctx.transaction(async (tx) => {
      const row = await reachableInvitation(tx, ctx, invitationId);
      const issued = await reissueInvitation(tx, { invitationId: row.id, now: new Date() }, { afterCommit: ctx.afterCommit });
      ctx.audit({
        action: 'invitation.resent',
        entityType: 'Invitation',
        entityId: row.id,
        changes: { expiresAt: { before: issued.previousExpiresAt.toISOString(), after: issued.expiresAt.toISOString() } },
      });
      return { invitationId: row.id };
    }),
});

// Memberships ---------------------------------------------------------------------------------------------------------

export const assignDesigner = defineAction({
  name: 'people.assignDesigner',
  permission: 'people.manage',
  input: z.object({ userId: idField, restaurantId: idField }),
  target: (i) => atRestaurant(i.restaurantId),
  run: (ctx, { userId }) =>
    ctx.transaction(async (tx) => {
      await assign(tx, { restaurantId: restaurantOf(ctx), userId });
      ctx.audit({
        action: 'membership.assigned',
        entityType: 'User',
        entityId: userId,
        changes: { role: { before: null, after: 'DESIGNER' } },
      });
      return { assigned: true as const };
    }),
});

export const unassignMember = defineAction({
  name: 'people.unassignMember',
  permission: 'people.manage',
  input: z.object({ userId: idField, restaurantId: idField }),
  target: (i) => atRestaurant(i.restaurantId),
  run: (ctx, { userId }) =>
    ctx.transaction(async (tx) => {
      const { role } = await unassign(tx, { restaurantId: restaurantOf(ctx), userId });
      ctx.audit({
        action: 'membership.removed',
        entityType: 'User',
        entityId: userId,
        changes: { role: { before: role, after: null } },
      });
      return { unassigned: true as const };
    }),
});

// Accounts ------------------------------------------------------------------------------------------------------------

export const deactivateUser = defineAction({
  name: 'people.deactivateUser',
  permission: 'people.manage',
  input: z.object({ userId: idField }),
  target: () => PLATFORM,
  run: (ctx, { userId }) =>
    ctx.transaction(async (tx) => {
      const { revokedInvitations } = await deactivatePerson(tx, { actor: ctx.actor, userId, now: new Date() });
      ctx.audit({
        action: 'user.deactivated',
        entityType: 'User',
        entityId: userId,
        changes: {
          active: { before: true, after: false },
          ...(revokedInvitations > 0 ? { invitationsRevoked: { before: 0, after: revokedInvitations } } : {}),
        },
      });
      return { deactivated: true as const };
    }),
});

export const reactivateUser = defineAction({
  name: 'people.reactivateUser',
  permission: 'people.manage',
  input: z.object({ userId: idField }),
  target: () => PLATFORM,
  run: (ctx, { userId }) =>
    ctx.transaction(async (tx) => {
      await reactivatePerson(tx, { userId });
      ctx.audit({ action: 'user.reactivated', entityType: 'User', entityId: userId, changes: { active: { before: false, after: true } } });
      return { reactivated: true as const };
    }),
});

export const changeUserEmail = defineAction({
  name: 'people.changeUserEmail',
  permission: 'people.manage',
  input: z.object({ userId: idField, email: emailField }),
  target: () => PLATFORM,
  run: (ctx, { userId, email }) =>
    ctx.transaction(async (tx) => {
      const change = await changeEmail(tx, { actor: ctx.actor, userId, email });
      ctx.audit({
        action: 'user.email_changed',
        entityType: 'User',
        entityId: userId,
        changes: { email: { before: change.before, after: change.after } },
      });
      // The old address learns of it, in the person's language: it is the one signal that reaches them if this is a mistake.
      ctx.afterCommit(() =>
        sendAfterResponse({ email: change.before, name: change.name, locale: change.locale }, 'emailChanged', { newEmail: change.after }),
      );
      return { email: change.after };
    }),
});

// Permission policy ---------------------------------------------------------------------------------------------------

const keyList = z.array(z.string().max(64)).max(100).default([]);
const roleEntry = z.object({ grant: keyList, revoke: keyList });

export const setPermissionPolicy = defineAction({
  name: 'people.setPermissionPolicy',
  permission: 'permissions.manage',
  input: z.object({
    restaurantId: idField,
    version: z.number().int().positive(),
    // What the client's designers and owners may do beyond (grant) or short of (revoke) the role's defaults. Anything
    // that is not a known key, or is never grantable, is dropped by `parsePolicy` when it is saved.
    policy: z.object({ DESIGNER: roleEntry.optional(), OWNER: roleEntry.optional() }),
  }),
  target: (i) => atRestaurant(i.restaurantId),
  run: (ctx, { version, policy }) =>
    ctx.transaction(async (tx) => {
      const restaurantId = restaurantOf(ctx);
      const current = await tx.restaurant.findUnique({ where: { id: restaurantId }, select: { permissionPolicy: true } });
      if (!current) throw new StudioError('NOT_FOUND');
      const next = parsePolicy(policy);
      await updateWithVersion(
        tx.restaurant,
        { id: restaurantId, version, data: { permissionPolicy: next as Prisma.InputJsonObject }, entityType: 'Restaurant' },
        tx,
      );
      ctx.audit({
        action: 'restaurant.permission_policy_changed',
        entityType: 'Restaurant',
        entityId: restaurantId,
        changes: { permissionPolicy: { before: parsePolicy(current.permissionPolicy), after: next } },
      });
      return { policy: next, version: version + 1 };
    }),
});
