import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z, type ZodType } from 'zod';

/*
 * The contract oracle: a verbatim copy of what Retails checks, so every Studio-side test that produces a request, a token
 * or a body is judged by Retails' own code and not by Studio's reading of it. A helper, not a test.
 *
 * Copied from buzzify-retails, branch core-link-a, commit e0ced1063f4b9d6b29ecbd8f4a77e82ed470e79c:
 * - `mac`, `verifyRequest`, `MAX_SKEW_SECONDS`: src/server/core/signing.ts (the accepted secrets are passed in instead
 *   of read from `coreConfig().syncSecrets`);
 * - `verifyHandoff`, `handoffNonce`, `HandoffClaims`: src/server/core/handoff.ts (secrets passed in instead of
 *   `coreConfig().handoffSecrets`);
 * - `coreStateSchema`: src/server/core/state.ts (the Prisma enum types inlined);
 * - `coreProvisionInput`: src/server/admin/core-provision.ts (`ACTIVITY_TYPES`, `CAPABILITIES` from
 *   src/server/domain/profiles.ts and `MAX_BRANCHES` from src/server/admin/provision.ts inlined).
 * Re-copy when Retails changes any of them. Only the quote style differs from the source.
 */

// ---- src/server/core/signing.ts -------------------------------------------------------------------------------------

export const MAX_SKEW_SECONDS = 120;

const sha256Hex = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

export function mac(method: string, path: string, timestamp: string, body: string, secret: string): string {
  const text = `${method.toUpperCase()}\n${path}\n${timestamp}\n${sha256Hex(body)}`;
  return createHmac('sha256', secret).update(text, 'utf8').digest('hex');
}

/** Constant-time compare of two hex strings; false on any length or format mismatch. */
function hexEqual(a: string, b: string): boolean {
  if (!/^[0-9a-f]+$/.test(a) || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

export type VerifyResult = { ok: true } | { ok: false; reason: 'MISSING' | 'SKEW' | 'BAD_SIGNATURE' };

export function verifyRequest(
  req: { method: string; path: string; body: string; headers: Headers },
  syncSecrets: readonly string[],
  now: Date = new Date(),
): VerifyResult {
  const timestamp = req.headers.get('x-bz-timestamp');
  const signature = req.headers.get('x-bz-signature');
  if (!timestamp || !signature) return { ok: false, reason: 'MISSING' };
  if (!/^\d{1,12}$/.test(timestamp)) return { ok: false, reason: 'BAD_SIGNATURE' };
  if (Math.abs(now.getTime() / 1000 - Number(timestamp)) > MAX_SKEW_SECONDS) return { ok: false, reason: 'SKEW' };

  // Try every accepted secret without short-circuiting, so timing does not reveal which matched.
  let match = false;
  for (const secret of syncSecrets) {
    if (hexEqual(signature, mac(req.method, req.path, timestamp, req.body, secret))) match = true;
  }
  return match ? { ok: true } : { ok: false, reason: 'BAD_SIGNATURE' };
}

// ---- src/server/core/handoff.ts -------------------------------------------------------------------------------------

export const HANDOFF_MAX_AGE_SECONDS = 60;
const MAX_TOKEN_LENGTH = 4096;
const FUTURE_IAT_LEEWAY_SECONDS = 5;

export type HandoffClaims = {
  aud: 'retail';
  iat: number;
  exp: number;
  nonce: string;
  jti: string;
  coreUserId: string;
  email: string;
  emailVerified: boolean;
  name: string;
  /** Absent/null/"" for staff who have no Studio business membership; then no business is resolved. */
  coreBusinessId?: string | null;
};

export type HandoffResult =
  | { ok: true; claims: HandoffClaims }
  | { ok: false; reason: 'FORMAT' | 'SIGNATURE' | 'EXPIRED' | 'AUDIENCE' };

const macOf = (payload: string, secret: string) => createHmac('sha256', secret).update(payload, 'utf8').digest();

function isClaims(c: unknown): c is HandoffClaims {
  if (!c || typeof c !== 'object') return false;
  const o = c as Record<string, unknown>;
  return (
    typeof o.aud === 'string' &&
    Number.isFinite(o.iat) &&
    Number.isFinite(o.exp) &&
    ['nonce', 'jti', 'coreUserId', 'email', 'name'].every((k) => typeof o[k] === 'string') &&
    (o.coreBusinessId === undefined || o.coreBusinessId === null || typeof o.coreBusinessId === 'string') &&
    typeof o.emailVerified === 'boolean'
  );
}

export function verifyHandoff(token: string, handoffSecrets: readonly string[], now: Date = new Date()): HandoffResult {
  if (token.length > MAX_TOKEN_LENGTH) return { ok: false, reason: 'FORMAT' };
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: 'FORMAT' };
  const [payload, sig] = parts;
  if (!/^[A-Za-z0-9_-]+$/.test(payload) || !/^[A-Za-z0-9_-]+$/.test(sig)) return { ok: false, reason: 'FORMAT' };

  // Authenticate the raw payload part before decoding or parsing it.
  const given = Buffer.from(sig, 'base64url');
  let match = false;
  for (const secret of handoffSecrets) {
    const expected = macOf(payload, secret);
    if (given.length === expected.length && timingSafeEqual(given, expected)) match = true;
  }
  if (!match) return { ok: false, reason: 'SIGNATURE' };

  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'FORMAT' };
  }
  if (!isClaims(claims)) return { ok: false, reason: 'FORMAT' };

  if (claims.aud !== 'retail') return { ok: false, reason: 'AUDIENCE' };

  const nowS = now.getTime() / 1000;
  if (claims.exp <= claims.iat || claims.exp - claims.iat > HANDOFF_MAX_AGE_SECONDS) return { ok: false, reason: 'EXPIRED' };
  if (claims.iat > nowS + FUTURE_IAT_LEEWAY_SECONDS) return { ok: false, reason: 'EXPIRED' };
  if (nowS > claims.exp || nowS - claims.iat > HANDOFF_MAX_AGE_SECONDS) return { ok: false, reason: 'EXPIRED' };
  return { ok: true, claims };
}

const digest = (s: string) => createHash('sha256').update(s, 'utf8').digest();

/** The nonce Studio must echo into the token for this state: base64url(sha256(state)). */
export function handoffNonce(state: string): string {
  return digest(state).toString('base64url');
}

// ---- src/server/core/state.ts ---------------------------------------------------------------------------------------

type SubscriptionStatus = 'TRIAL' | 'ACTIVE' | 'GRACE' | 'EXPIRED' | 'CANCELLED';
const SUBSCRIPTION_STATUSES = ['TRIAL', 'ACTIVE', 'GRACE', 'EXPIRED', 'CANCELLED'] as const satisfies readonly SubscriptionStatus[];
const BUSINESS_STATUSES = ['ACTIVE', 'SUSPENDED', 'ARCHIVED'] as const;

export type CoreState = {
  coreBusinessId: string;
  version: number;
  status: (typeof BUSINESS_STATUSES)[number];
  plan: { code: string; name: string; maxBranches: number; maxTerminals: number; maxUsers: number; storageMb: number; aiMonthly: number };
  subscription: {
    status: SubscriptionStatus;
    trialEndsAt: Date | null;
    currentPeriodStart: Date;
    currentPeriodEnd: Date;
    graceDays: number;
  };
  aiIntake: boolean;
  owner: { coreUserId: string; email: string; emailVerified: boolean; name: string };
};

const isoDate = z.iso.datetime({ offset: true }).transform((s) => new Date(s));
const limit = z.number().int().min(0).max(1_000_000_000);
const id = z.string().trim().min(1).max(128);

export const coreStateSchema: ZodType<CoreState> = z.object({
  coreBusinessId: id,
  version: z.number().int().min(1).max(2_000_000_000),
  status: z.enum(BUSINESS_STATUSES),
  plan: z.object({
    code: z.string().trim().min(1).max(64),
    name: z.string().trim().min(1).max(120),
    maxBranches: limit,
    maxTerminals: limit,
    maxUsers: limit,
    storageMb: limit,
    aiMonthly: limit,
  }),
  subscription: z
    .object({
      status: z.enum(SUBSCRIPTION_STATUSES),
      trialEndsAt: isoDate.nullable(),
      currentPeriodStart: isoDate,
      currentPeriodEnd: isoDate,
      graceDays: z.number().int().min(0).max(365),
    })
    .refine((v) => v.status !== 'TRIAL' || v.trialEndsAt !== null, { message: 'TRIAL requires trialEndsAt', path: ['trialEndsAt'] })
    .refine((v) => v.currentPeriodEnd.getTime() > v.currentPeriodStart.getTime(), {
      message: 'currentPeriodEnd must be after currentPeriodStart',
      path: ['currentPeriodEnd'],
    }),
  aiIntake: z.boolean(),
  owner: z.object({
    coreUserId: id,
    email: z.string().trim().max(254).pipe(z.email()),
    emailVerified: z.boolean(),
    name: z.string().trim().max(200),
  }),
});

// ---- src/server/admin/core-provision.ts -----------------------------------------------------------------------------

const ACTIVITY_TYPES = ['MARKET', 'CLOTHING', 'ELECTRONICS', 'BEAUTY', 'STATIONERY', 'MIXED'] as const;
const CAPABILITIES = ['VARIANTS', 'SERIAL', 'BATCH', 'WEIGHT', 'MULTI_UNIT', 'WARRANTY', 'WHOLESALE', 'LOYALTY', 'CREDIT', 'HOLDS', 'TRANSFERS'] as const;
const MAX_BRANCHES = 20;

const unique = <T>(list: readonly T[]) => new Set(list).size === list.length;

export const coreProvisionInput = z
  .object({
    coreBusinessId: z.string().trim().min(1).max(128),
    name: z.string().trim().min(1).max(120),
    activityType: z.enum(ACTIVITY_TYPES).default('MIXED'),
    capabilities: z.array(z.enum(CAPABILITIES)).max(CAPABILITIES.length * 2).default([]),
    branches: z
      .array(z.object({ name: z.string().trim().min(1).max(80) }))
      .min(1)
      .max(MAX_BRANCHES)
      .refine((b) => unique(b.map((x) => x.name)), 'branch names must be unique'),
    currencies: z.array(z.enum(['IQD', 'USD'])).min(1).max(2).refine(unique, 'currencies must be unique'),
    state: coreStateSchema,
  })
  .refine((v) => v.state.coreBusinessId === v.coreBusinessId, { message: 'state is for another business', path: ['state'] });
