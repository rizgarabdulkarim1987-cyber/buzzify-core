import type { PrismaClient } from '@/generated/prisma/client';
import type { ScopedTx } from '@/server/data/tenant-db';
import { assertAuditSafe } from '@/server/domain/pharmacy/audit-fields';
import { validateGrantRequest, type GrantRequestCode } from '@/server/domain/pharmacy/support-grant';
import { StudioError } from '@/server/studio/framework/result';
import type { PhActor } from './actor';

/**
 * Support access to a pharmacy: making a grant, and the audit row of every read a support actor makes. Who holds a grant
 * right now is resolved in `./actor.ts` on every request, never cached, so an expired or revoked grant stops at once.
 */

const HOUR_MS = 3_600_000;

/** Each refusal of the grant rules, on the field the person fixes. */
const REFUSALS: Record<GrantRequestCode, [field: string, message: string]> = {
  NO_SCOPE: ['scopes', 'Choose at least one kind of access'],
  UNKNOWN_SCOPE: ['scopes', 'Choose from the listed kinds of access'],
  REASON_REQUIRED: ['reason', 'Give a reason of at least 10 characters'],
  TOO_LONG: ['hours', 'Grant access for at most 72 hours'],
  PAST: ['hours', 'Grant access for at least one hour'],
  SENSITIVE_NOT_CONFIRMED: ['sensitiveConfirmed', 'Confirm that support may see prescriptions or patients'],
};

export interface GrantRequest {
  /** Already normalized (`normalizeEmail`). */
  granteeEmail: string;
  scopes: string[];
  reason: string;
  hours: number;
  sensitiveConfirmed: boolean;
}

/**
 * Creates a grant in `restaurantId` through `tx` (a transaction scoped to that pharmacy), starting `now`. The grantee is
 * named by email and must be an active Super Admin. `approvedByUserId` is the owner who granted it, or null when platform
 * staff record the owner's written consent (`consentRef`).
 */
export async function createGrant(
  tx: ScopedTx,
  restaurantId: string,
  request: GrantRequest,
  approval: { approvedByUserId: string; consentRef: null } | { approvedByUserId: null; consentRef: string },
  now: Date,
  /** The person recording an owner's consent: they may not be the grantee (by user id, the canonical guard). */
  recorderUserId?: string,
): Promise<{ id: string; granteeUserId: string; expiresAt: Date }> {
  const expiresAt = new Date(now.getTime() + request.hours * HOUR_MS);
  const verdict = validateGrantRequest({ ...request, startsAt: now, expiresAt, now });
  if (!verdict.ok) {
    const [field, message] = REFUSALS[verdict.code];
    throw new StudioError('INVALID', message, { [field]: message });
  }
  const grantee = await tx.user.findUnique({
    where: { email: request.granteeEmail },
    select: { id: true, isSuperAdmin: true, deactivatedAt: true },
  });
  if (!grantee || !grantee.isSuperAdmin || grantee.deactivatedAt) {
    const message = 'Name a member of Buzzify support';
    throw new StudioError('INVALID', message, { granteeEmail: message });
  }
  if (recorderUserId !== undefined && grantee.id === recorderUserId) {
    const message = 'CONSENT_SELF: name another member of Buzzify support, not yourself';
    throw new StudioError('INVALID', message, { granteeEmail: message });
  }
  return tx.supportAccessGrant.create({
    data: {
      restaurantId,
      granteeUserId: grantee.id,
      scopes: [...new Set(request.scopes)],
      reason: request.reason.trim(),
      approvedByUserId: approval.approvedByUserId,
      consentRef: approval.consentRef,
      startsAt: now,
      expiresAt,
    },
    select: { id: true, granteeUserId: true, expiresAt: true },
  });
}

/**
 * The audit row of one read by a support actor: who, which grant, and which query (`entity`), never what it returned.
 * The framework calls it for every admitted support query before the handler runs (`runQueryForPage`), so a read whose
 * row cannot be written does not happen.
 */
export async function auditSupportRead(prisma: PrismaClient, ph: PhActor, entity: string): Promise<void> {
  if (!ph.support) return;
  const changes = { query: { before: null, after: entity } };
  assertAuditSafe('SupportAccessGrant', changes);
  await prisma.auditLog.create({
    data: {
      actorId: ph.userId,
      restaurantId: ph.restaurantId,
      action: 'support.read',
      entityType: 'SupportAccessGrant',
      entityId: ph.support.grantId,
      changes,
    },
  });
}
