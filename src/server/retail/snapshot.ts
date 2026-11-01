import { createHash } from 'node:crypto';
import type { AnyDb } from '@/server/data/tenant-db';
import { retailLimitsSchema } from '@/server/domain/retail/limits';

/**
 * The snapshot Studio sends Retails for one linked business (Retails' `coreStateSchema`), and the provision body that
 * carries it the first time (`coreProvisionInput`). It is built at send time from the rows as they are, so a delivery
 * never carries stale content; its `version` is `RetailLink.stateVersion`, which every change that alters it bumps
 * (`outbox.ts`).
 *
 * A business is ready once it has an owner who accepted (an OWNER membership of an active user) and a `retail`
 * subscription: Retails requires both in every snapshot. Until then the build says which one it is waiting for.
 */

export type RetailState = {
  coreBusinessId: string;
  version: number;
  status: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
  plan: { code: string; name: string; maxBranches: number; maxTerminals: number; maxUsers: number; storageMb: number; aiMonthly: number };
  subscription: {
    status: 'TRIAL' | 'ACTIVE' | 'GRACE' | 'EXPIRED' | 'CANCELLED';
    trialEndsAt: string | null;
    currentPeriodStart: string;
    currentPeriodEnd: string;
    graceDays: number;
  };
  aiIntake: boolean;
  owner: { coreUserId: string; email: string; emailVerified: boolean; name: string };
};

export type ProvisionBody = {
  coreBusinessId: string;
  name: string;
  activityType: 'MIXED';
  capabilities: [];
  branches: { name: string }[];
  currencies: ('IQD' | 'USD')[];
  state: RetailState;
};

export type Built =
  | { ready: false; waitingFor: 'OWNER' | 'SUBSCRIPTION' }
  | { ready: true; state: RetailState; provision: ProvisionBody; hash: string };

/** Thrown for a business that has no `RetailLink`: it is not a linked retail business (or it was deleted). */
export class NotRetailError extends Error {
  constructor(readonly restaurantId: string) {
    super(`${restaurantId} is not a linked retail business`);
    this.name = 'NotRetailError';
  }
}

/** Retails' caps (`coreStateSchema`, `coreProvisionInput`). */
const PLAN_NAME_MAX = 120;
const BUSINESS_NAME_MAX = 120;
const OWNER_NAME_MAX = 200;
const LIVE_STORED = ['TRIAL', 'ACTIVE', 'GRACE'] as const;
const ZERO_LIMITS = { branches: 0, users: 0, terminals: 0, storageMb: 0, aiMonthly: 0 };

/**
 * Reads everything under a FOR SHARE lock on the RetailLink row taken first; call inside a transaction. The lock makes a
 * concurrent bump (which updates that row) wait until this read is done, so the version read here matches the content.
 * Takes the application's client or one scoped to the business (it reads the business's branches).
 */
export async function buildRetailState(tx: AnyDb, restaurantId: string): Promise<Built> {
  // eslint-disable-next-line no-restricted-properties -- a row lock on this one business's link, keyed by its id
  const locked = await tx.$queryRaw<{ restaurantId: string }[]>`SELECT "restaurantId" FROM "RetailLink" WHERE "restaurantId" = ${restaurantId} FOR SHARE`;
  if (locked.length === 0) throw new NotRetailError(restaurantId);
  const link = await tx.retailLink.findUniqueOrThrow({ where: { restaurantId }, select: { stateVersion: true, aiIntake: true, currencies: true } });

  const membership = await tx.membership.findFirst({
    where: { restaurantId, role: 'OWNER', user: { deactivatedAt: null } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { user: { select: { id: true, email: true, emailVerified: true, name: true } } },
  });
  if (!membership) return { ready: false, waitingFor: 'OWNER' };

  // The live one by stored status (the sweep bumps when it moves it on), else the newest.
  const subscriptionSelect = { planCode: true, status: true, trialEndsAt: true, currentPeriodStart: true, currentPeriodEnd: true, graceDays: true } as const;
  const subscription =
    (await tx.subscription.findFirst({ where: { restaurantId, applicationId: 'retail', status: { in: [...LIVE_STORED] } }, select: subscriptionSelect })) ??
    (await tx.subscription.findFirst({ where: { restaurantId, applicationId: 'retail' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: subscriptionSelect }));
  if (!subscription) return { ready: false, waitingFor: 'SUBSCRIPTION' };

  const plan = await tx.appPlan.findUnique({
    where: { applicationId_code: { applicationId: 'retail', code: subscription.planCode } },
    select: { name: true, limits: true },
  });
  // A missing plan or limits that are not a valid set allow nothing: the safe reading `limitsOf` uses.
  const parsed = plan ? retailLimitsSchema.safeParse(plan.limits) : null;
  const limits = parsed?.success ? parsed.data : ZERO_LIMITS;
  const english = (plan?.name as { en?: unknown } | null | undefined)?.en;
  const planName = (typeof english === 'string' && english.trim() !== '' ? english.trim() : subscription.planCode).slice(0, PLAN_NAME_MAX);

  const business = await tx.restaurant.findUniqueOrThrow({ where: { id: restaurantId }, select: { name: true, status: true } });
  const branches = await tx.branch.findMany({ where: { restaurantId }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], select: { name: true } });

  const owner = membership.user;
  const state: RetailState = {
    coreBusinessId: restaurantId,
    version: link.stateVersion,
    status: business.status,
    plan: {
      code: subscription.planCode,
      name: planName,
      maxBranches: limits.branches,
      maxTerminals: limits.terminals,
      maxUsers: limits.users,
      storageMb: limits.storageMb,
      aiMonthly: limits.aiMonthly,
    },
    subscription: {
      status: subscription.status,
      trialEndsAt: subscription.trialEndsAt?.toISOString() ?? null,
      currentPeriodStart: subscription.currentPeriodStart.toISOString(),
      currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
      graceDays: subscription.graceDays,
    },
    aiIntake: link.aiIntake,
    owner: { coreUserId: owner.id, email: owner.email, emailVerified: owner.emailVerified, name: owner.name.trim().slice(0, OWNER_NAME_MAX) },
  };
  const provision: ProvisionBody = {
    coreBusinessId: restaurantId,
    name: business.name.trim().slice(0, BUSINESS_NAME_MAX),
    // Owner question 7: the owner sets the shop type and capabilities in Retails.
    activityType: 'MIXED',
    capabilities: [],
    branches: branches.map((branch) => ({ name: branch.name })),
    currencies: [...link.currencies],
    state,
  };
  return { ready: true, state, provision, hash: stateHash(state) };
}

/** JSON with every object's keys sorted, so equal content gives equal text whatever order it was built in. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** sha256 hex of the snapshot's canonical JSON without `version`: what the reconcile compares to find drift. */
export function stateHash(state: RetailState): string {
  const { version: _version, ...content } = state;
  void _version;
  return createHash('sha256').update(canonicalJson(content)).digest('hex');
}
