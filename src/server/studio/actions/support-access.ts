import { z } from 'zod';
import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { createGrant } from '@/server/pharmacy/support';
import { normalizeEmail } from '@/server/studio/auth/users';
import { defineAction } from '@/server/studio/framework/action';
import { StudioError } from '@/server/studio/framework/result';

/**
 * Support access to a pharmacy (spec 4.6). The pharmacy's owner grants a named Super Admin time-limited read access
 * (`grant`) and ends it at any time (`revoke`); both run on the owner's own pharmacy (`ph`, permission `support.grant`,
 * which only the owner holds). Platform staff may instead record the owner's written consent (`recordConsent`), which
 * makes the same grant with the consent's reference and no approving owner. A support actor runs queries only, so none
 * of these is open to it. The rules of a grant (scopes, reason, at most 72 hours, confirming patient data) are
 * `validateGrantRequest`'s.
 */

const PLATFORM = { kind: 'platform' } as const;

const grantFields = z.object({
  granteeEmail: z.string().trim().min(1, 'Name a member of Buzzify support').max(320).transform(normalizeEmail),
  scopes: z.array(z.string()).max(10),
  reason: z.string().max(500, 'Use at most 500 characters'),
  hours: z.number('Enter a whole number').int('Enter a whole number'),
  sensitiveConfirmed: z.boolean().default(false),
});

const changesOf = (granted: { granteeUserId: string; expiresAt: Date }, scopes: string[]) => ({
  granteeUserId: { before: null, after: granted.granteeUserId },
  scopes: { before: null, after: [...new Set(scopes)] },
  expiresAt: { before: null, after: granted.expiresAt.toISOString() },
});

export const grant = defineAction({
  name: 'support.grant',
  permission: null,
  ph: 'support.grant',
  input: grantFields.extend({ restaurantId: phPlaceInput.shape.restaurantId }),
  target: phTargetOf,
  run: (ctx, input) =>
    ctx.transaction(async (tx) => {
      const granted = await createGrant(
        tx,
        ctx.restaurantId as string,
        input,
        { approvedByUserId: ctx.actor.userId, consentRef: null },
        new Date(),
      );
      ctx.audit({ action: 'support.grant', entityType: 'SupportAccessGrant', entityId: granted.id, changes: changesOf(granted, input.scopes) });
      return { id: granted.id, expiresAt: granted.expiresAt.toISOString() };
    }),
});

export const revoke = defineAction({
  name: 'support.revoke',
  permission: null,
  ph: 'support.grant',
  input: z.object({ restaurantId: phPlaceInput.shape.restaurantId, grantId: z.string().min(1) }),
  target: phTargetOf,
  run: (ctx, input) =>
    ctx.transaction(async (tx) => {
      // The client finds grants of this pharmacy only: another's id is not found.
      const row = await tx.supportAccessGrant.findFirst({ where: { id: input.grantId }, select: { id: true, revokedAt: true } });
      if (!row) throw new StudioError('NOT_FOUND');
      if (row.revokedAt) return { id: row.id, revokedAt: row.revokedAt.toISOString() };
      const revokedAt = new Date();
      const { count } = await tx.supportAccessGrant.updateMany({ where: { id: row.id, revokedAt: null }, data: { revokedAt } });
      // Revoked by someone else a moment ago: it has ended either way, and their row records it.
      if (count === 0) return { id: row.id, revokedAt: revokedAt.toISOString() };
      ctx.audit({
        action: 'support.revoke',
        entityType: 'SupportAccessGrant',
        entityId: row.id,
        changes: { revokedAt: { before: null, after: revokedAt.toISOString() } },
      });
      return { id: row.id, revokedAt: revokedAt.toISOString() };
    }),
});

export const recordConsent = defineAction({
  name: 'support.recordConsent',
  // A platform key: only Super Admins hold it.
  permission: 'people.manage',
  input: grantFields.extend({
    restaurantId: z.string().min(1),
    consentRef: z
      .string('Enter a reference of at least 10 characters')
      .trim()
      .min(10, 'Enter a reference of at least 10 characters')
      .max(200),
  }),
  target: () => PLATFORM,
  async run(ctx, input) {
    if (!ctx.actor.isSuperAdmin) throw new StudioError('FORBIDDEN');
    const pharmacy = await ctx.db.restaurant.findUnique({ where: { id: input.restaurantId }, select: { sector: true } });
    if (pharmacy?.sector !== 'PHARMACY') throw new StudioError('NOT_FOUND');
    return ctx.transactionIn({ restaurantId: input.restaurantId }, async (tx) => {
      const granted = await createGrant(
        tx,
        input.restaurantId,
        input,
        { approvedByUserId: null, consentRef: input.consentRef },
        new Date(),
      );
      ctx.audit({
        action: 'support.grant',
        entityType: 'SupportAccessGrant',
        entityId: granted.id,
        changes: {
          ...changesOf(granted, input.scopes),
          approval: { before: null, after: 'consent recorded by platform' },
          consentRef: { before: null, after: input.consentRef },
        },
      });
      return { id: granted.id, expiresAt: granted.expiresAt.toISOString() };
    });
  },
});
