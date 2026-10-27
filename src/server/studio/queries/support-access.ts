import { z } from 'zod';
import { grantStatus } from '@/server/domain/pharmacy/support-grant';
import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { defineQuery } from '@/server/studio/framework/query';

/** The pharmacy's support grants, newest first, for its owner: who holds each, what it covers and whether it is live. */
export const listGrants = defineQuery({
  name: 'support.listGrants',
  permission: null,
  ph: 'support.grant',
  input: z.object({ restaurantId: phPlaceInput.shape.restaurantId }),
  target: phTargetOf,
  async run(ctx) {
    const now = new Date();
    const rows = await ctx.scoped!.supportAccessGrant.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        scopes: true,
        reason: true,
        consentRef: true,
        startsAt: true,
        expiresAt: true,
        revokedAt: true,
        grantee: { select: { name: true, email: true } },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      granteeName: row.grantee.name,
      granteeEmail: row.grantee.email,
      scopes: row.scopes,
      reason: row.reason,
      consentRef: row.consentRef,
      startsAt: row.startsAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      status: grantStatus(row, now),
    }));
  },
});
