/** Rules for a pharmacy owner's time-limited grant of access to Buzzify support, as pure functions. */

import type { PhPermission } from './permissions';

export const SUPPORT_SCOPES = ['catalog.read', 'stock.read', 'sales.read', 'rx.read', 'patients.read'] as const;
export type SupportScope = (typeof SUPPORT_SCOPES)[number];

/** Scopes that expose patient information: the owner must confirm them explicitly. */
export const SENSITIVE_SUPPORT_SCOPES: readonly SupportScope[] = ['rx.read', 'patients.read'];

export const MAX_GRANT_HOURS = 72;
const MIN_REASON_LENGTH = 10;

export type GrantRequestCode =
  | 'NO_SCOPE'
  | 'UNKNOWN_SCOPE'
  | 'REASON_REQUIRED'
  | 'TOO_LONG'
  | 'PAST'
  | 'SENSITIVE_NOT_CONFIRMED';

export function validateGrantRequest(input: {
  scopes: string[];
  reason: string;
  startsAt: Date;
  expiresAt: Date;
  now: Date;
  sensitiveConfirmed: boolean;
}): { ok: true } | { ok: false; code: GrantRequestCode } {
  if (input.scopes.length === 0) return { ok: false, code: 'NO_SCOPE' };
  if (input.scopes.some((s) => !(SUPPORT_SCOPES as readonly string[]).includes(s))) {
    return { ok: false, code: 'UNKNOWN_SCOPE' };
  }
  if (input.reason.trim().length < MIN_REASON_LENGTH) return { ok: false, code: 'REASON_REQUIRED' };
  if (input.expiresAt.getTime() <= input.now.getTime()) return { ok: false, code: 'PAST' };
  // A window that ends at or before it starts can never be active.
  if (input.expiresAt.getTime() <= input.startsAt.getTime()) return { ok: false, code: 'PAST' };
  if (input.expiresAt.getTime() - input.startsAt.getTime() > MAX_GRANT_HOURS * 3_600_000) {
    return { ok: false, code: 'TOO_LONG' };
  }
  const sensitive = input.scopes.some((s) => (SENSITIVE_SUPPORT_SCOPES as readonly string[]).includes(s));
  if (sensitive && !input.sensitiveConfirmed) return { ok: false, code: 'SENSITIVE_NOT_CONFIRMED' };
  return { ok: true };
}

export type GrantStatus = 'pending' | 'active' | 'expired' | 'revoked';

/** `expiresAt` itself is already expired; `startsAt` itself is already active. */
export function grantStatus(
  grant: { startsAt: Date; expiresAt: Date; revokedAt: Date | null },
  now: Date,
): GrantStatus {
  if (grant.revokedAt) return 'revoked';
  if (now.getTime() >= grant.expiresAt.getTime()) return 'expired';
  if (now.getTime() < grant.startsAt.getTime()) return 'pending';
  return 'active';
}

/**
 * The one table of what a support actor may read: each pharmacy permission that only reads, and the grant scope that
 * covers it. A permission missing here writes (or is the owner's own, such as `support.grant`), so no grant covers it.
 * Costs, margins and prescription attachments are missing on purpose: a `stock.read` or `sales.read` grant must never
 * unlock them; they need their own explicitly confirmed scopes.
 *
 * A support actor has `role: null`. A handler that a support actor may reach (a report, say) must hide cost and profit
 * for it, and must never call `canPh` with a null role: check `actor.support` first.
 */
export const SUPPORT_READ_SCOPE: Readonly<Partial<Record<PhPermission, SupportScope>>> = Object.freeze({
  'catalog.view': 'catalog.read',
  'report.view': 'sales.read',
});

/** The grant scope a support actor needs for `permission`, or null when no grant can cover it. */
export function supportReadScope(permission: PhPermission): SupportScope | null {
  return SUPPORT_READ_SCOPE[permission] ?? null;
}

export function grantAllows(
  grant: { startsAt: Date; expiresAt: Date; revokedAt: Date | null; scopes: readonly string[] },
  scope: string,
  now: Date,
): boolean {
  return grantStatus(grant, now) === 'active' && grant.scopes.includes(scope);
}
