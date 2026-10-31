import { z } from 'zod';
import type { AnyDb } from '@/server/data/tenant-db';
import type { RetailLimits } from '@/server/domain/retail/limits';
import { effectiveStatus, isLive } from '@/server/domain/billing/subscriptions';

/**
 * What a pharmacy plan allows (`AppPlan.limits`) and how it is enforced. A limit of `0` means none left, never
 * unlimited (as a `PosAiPackage` of 0 does). A plan is only read through a live `pharmacy` subscription: a pharmacy
 * with none has no limits, and everything that creates a branch or a staff member is refused for it.
 *
 * `limitsOf` and the counts take a client and always filter by the restaurant themselves, so they give the same answer
 * on the application's client and on a client scoped to the restaurant.
 */

const MAX_LIMIT = 2_147_483_647;
const limit = z
  .number('Enter a whole number')
  .int('Enter a whole number')
  .min(0, 'Use 0 or more')
  .max(MAX_LIMIT, 'Enter a smaller number');

export const pharmacyLimitsSchema = z.object({
  branches: limit,
  users: limit,
  storageMb: limit,
  aiMonthlyBudgetMinor: limit,
});

export type PharmacyLimits = z.infer<typeof pharmacyLimitsSchema>;

/** A plan as the billing screens show it; `limits` is the product's own set (Retail's for a `retail` plan). */
export interface AppPlanRow<L = PharmacyLimits> {
  code: string;
  name: { en: string; ar: string; ckb: string };
  /** Null when the stored limits are not a valid set: the plan then allows nothing until the owner saves it again. */
  limits: L | null;
  active: boolean;
  sortOrder: number;
  version: number;
  /** Subscriptions to the plan, live or not. */
  subscriptions: number;
}

/** A Retail plan as the billing screens show it. */
export type RetailAppPlanRow = AppPlanRow<RetailLimits>;

export type LimitKind = 'branches' | 'users';

export type LimitCheck = { ok: true } | { ok: false; code: 'LIMIT_REACHED'; limit: number };

/** Whether one more of `kind` fits, given how many there are now. A limit of 0 fits none. */
export function checkLimit(kind: LimitKind, current: number, limits: PharmacyLimits): LimitCheck {
  const allowed = limits[kind];
  return current < allowed ? { ok: true } : { ok: false, code: 'LIMIT_REACHED', limit: allowed };
}

// The functions take plain delegates: the application's client, a transaction, or `delegates(tx)` of a scoped one.
// (A union with the scoped client types, or overloads, makes TypeScript compare whole client types: very slow.)

const LIVE_STORED = ['TRIAL', 'ACTIVE', 'GRACE'] as const;

/**
 * The limits of the plan the restaurant's live `pharmacy` subscription is on, or null: no live subscription, a plan that
 * no longer exists, or a plan whose limits are not a valid set (refusing is the safe reading of a broken row). A plan
 * taken off sale (`active: false`) still binds the subscriptions already on it.
 */
export async function limitsOf(d: AnyDb, restaurantId: string, now: Date = new Date()): Promise<PharmacyLimits | null> {
  const subscriptions = await d.subscription.findMany({
    where: { restaurantId, applicationId: 'pharmacy', status: { in: [...LIVE_STORED] } },
    select: { planCode: true, status: true, trialEndsAt: true, currentPeriodEnd: true, graceDays: true },
  });
  // A sweep may not have run yet: judge each row as of now.
  const live = subscriptions.find((subscription) => isLive(effectiveStatus(subscription, now)));
  if (!live) return null;
  const plan = await d.appPlan.findUnique({
    where: { applicationId_code: { applicationId: 'pharmacy', code: live.planCode } },
    select: { limits: true },
  });
  if (!plan) return null;
  const parsed = pharmacyLimitsSchema.safeParse(plan.limits);
  return parsed.success ? parsed.data : null;
}

export async function countBranches(db: AnyDb, restaurantId: string): Promise<number> {
  return db.branch.count({ where: { restaurantId } });
}

/** Staff who can still sign in to work: a deactivated member no longer counts against the plan. */
export async function countActiveStaff(db: AnyDb, restaurantId: string): Promise<number> {
  return db.phStaff.count({ where: { restaurantId, deactivatedAt: null } });
}

export type LimitOutcome = LimitCheck | { ok: false; code: 'NO_PLAN'; limit: 0 };

/**
 * Whether the restaurant may add one more branch or staff member now. Branch and staff creation call this before they
 * write. `NO_PLAN` is a pharmacy with no live subscription (or an unreadable plan): it creates nothing.
 */
export async function checkCreation(db: AnyDb, restaurantId: string, kind: LimitKind, now: Date = new Date()): Promise<LimitOutcome> {
  // One creation at a time per business: the count below is read after the lock, so two concurrent creations at
  // limit-1 cannot both pass. The lock is held to the end of the surrounding transaction (and is a no-op outside one).
  // eslint-disable-next-line no-restricted-properties -- an advisory lock touches no tenant rows: it only serialises one business's creations
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${restaurantId}))`;
  const limits = await limitsOf(db, restaurantId, now);
  if (!limits) return { ok: false, code: 'NO_PLAN', limit: 0 };
  const current = kind === 'branches' ? await countBranches(db, restaurantId) : await countActiveStaff(db, restaurantId);
  return checkLimit(kind, current, limits);
}
