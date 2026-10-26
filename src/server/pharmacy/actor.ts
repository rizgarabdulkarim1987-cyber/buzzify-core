import { cache } from 'react';
import type { PrismaClient } from '@/generated/prisma/client';
import { isLocale, type Locale } from '@/lib/locale';
import { getPrisma } from '@/server/data/prisma';
import { effectiveStatus, graceEndsAt, isLive } from '@/server/domain/billing/subscriptions';
import type { PhRole } from '@/server/domain/pharmacy/permissions';
import { grantStatus } from '@/server/domain/pharmacy/support-grant';
import { getActor } from '@/server/studio/auth/actor';

const DAY_MS = 86_400_000;

/** How long a lapsed pharmacy stays readable and exportable before it is archived; the platform may change it. */
export const PH_RETENTION_DAYS_DEFAULT = 90;

/** Who works in a pharmacy: a person, the one restaurant they act in, their role and the branches they may use. */
export interface PhActor {
  userId: string;
  name: string;
  restaurantId: string;
  restaurantName: string;
  /** `null` for a Super Admin acting through a support grant: they hold no pharmacy role, only the grant's scopes. */
  role: PhRole | null;
  allBranches: boolean;
  branchIds: string[];
  /** True when the role comes from being the restaurant's Studio OWNER rather than from a staff row. */
  viaMembership: boolean;
  support: { grantId: string; scopes: ReadonlySet<string>; expiresAt: Date } | null;
  locale: Locale;
}

export type PhGate =
  | { state: 'open' }
  | { state: 'readOnly'; until: Date }
  | { state: 'closed'; reason: 'restaurantInactive' | 'notPharmacy' | 'planInactive' | 'archived' };

/** The retention window in days: the `pharmacyRetentionDays` platform setting when it holds a positive whole number. */
async function retentionDays(prisma: PrismaClient): Promise<number> {
  const row = await prisma.platformSetting.findUnique({ where: { key: 'pharmacyRetentionDays' }, select: { value: true } });
  const value = row?.value;
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : PH_RETENTION_DAYS_DEFAULT;
}

/**
 * Whether a pharmacy may work at `now`: the restaurant is ACTIVE and a pharmacy, and its `pharmacy` subscription is live
 * (open), or lapsed within the retention window (readOnly until its end), or lapsed longer ago (closed, archived).
 */
export async function phGate(prisma: PrismaClient, restaurantId: string, now: Date): Promise<PhGate> {
  const restaurant = await prisma.restaurant.findUnique({ where: { id: restaurantId }, select: { status: true, sector: true } });
  if (!restaurant || restaurant.status !== 'ACTIVE') return { state: 'closed', reason: 'restaurantInactive' };
  if (restaurant.sector !== 'PHARMACY') return { state: 'closed', reason: 'notPharmacy' };
  const subscription = await prisma.subscription.findFirst({
    where: { restaurantId, applicationId: 'pharmacy' },
    select: { status: true, trialEndsAt: true, currentPeriodEnd: true, graceDays: true, cancelledAt: true },
  });
  if (!subscription) return { state: 'closed', reason: 'planInactive' };
  const status = effectiveStatus(subscription, now);
  if (isLive(status)) return { state: 'open' };

  const lapsedAt = status === 'CANCELLED' ? (subscription.cancelledAt ?? subscription.currentPeriodEnd) : graceEndsAt(subscription);
  const until = new Date(lapsedAt.getTime() + (await retentionDays(prisma)) * DAY_MS);
  return now.getTime() < until.getTime() ? { state: 'readOnly', until } : { state: 'closed', reason: 'archived' };
}

interface Candidate {
  role: PhRole | null;
  viaMembership: boolean;
  allBranches: boolean;
  branchIds: string[];
  joined: Date;
  support: PhActor['support'];
}

/**
 * The pharmacy identity of a user. A Studio OWNER member of a PHARMACY restaurant is its OWNER of every branch; anyone
 * else needs an active `PhStaff` row and at least one `PhStaffBranch` row. A Super Admin has an identity only through an
 * active support grant for that restaurant (no role, the grant's scopes). A deactivated user has none. With
 * `restaurantId` the answer is for that restaurant only; without it, the first they joined whose gate is not closed (else
 * the first). With `branchId` a person who may not use that branch has none.
 */
export async function resolvePhActor(
  prisma: PrismaClient,
  userId: string,
  opts: { restaurantId?: string; branchId?: string; now?: Date } = {},
): Promise<PhActor | null> {
  const now = opts.now ?? new Date();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      memberships: { where: { role: 'OWNER' }, select: { restaurantId: true, createdAt: true } },
      phStaffs: {
        where: { deactivatedAt: null },
        select: { restaurantId: true, role: true, createdAt: true, branches: { select: { branchId: true } } },
      },
    },
  });
  if (!user || user.deactivatedAt) return null;

  const candidates = new Map<string, Candidate>();
  if (user.isSuperAdmin) {
    const grants = await prisma.supportAccessGrant.findMany({
      where: { granteeUserId: userId, ...(opts.restaurantId ? { restaurantId: opts.restaurantId } : {}) },
      orderBy: { createdAt: 'asc' },
    });
    for (const grant of grants) {
      if (grantStatus(grant, now) !== 'active' || candidates.has(grant.restaurantId)) continue;
      candidates.set(grant.restaurantId, {
        role: null,
        viaMembership: false,
        allBranches: true,
        branchIds: [],
        joined: grant.createdAt,
        support: { grantId: grant.id, scopes: new Set(grant.scopes), expiresAt: grant.expiresAt },
      });
    }
  } else {
    for (const staff of user.phStaffs) {
      if (staff.branches.length === 0) continue;
      candidates.set(staff.restaurantId, {
        role: staff.role,
        viaMembership: false,
        allBranches: false,
        branchIds: staff.branches.map((b) => b.branchId),
        joined: staff.createdAt,
        support: null,
      });
    }
    // The membership wins over a staff row of the same restaurant: an owner is always the owner.
    for (const member of user.memberships) {
      candidates.set(member.restaurantId, {
        role: 'OWNER',
        viaMembership: true,
        allBranches: true,
        branchIds: [],
        joined: member.createdAt,
        support: null,
      });
    }
  }

  let chosen: [string, Candidate] | undefined;
  if (opts.restaurantId !== undefined) {
    const found = candidates.get(opts.restaurantId);
    if (found) chosen = [opts.restaurantId, found];
  } else {
    const byJoined = [...candidates.entries()].sort((x, y) => x[1].joined.getTime() - y[1].joined.getTime());
    chosen = byJoined[0];
    if (byJoined.length > 1) {
      for (const entry of byJoined) {
        if ((await phGate(prisma, entry[0], now)).state !== 'closed') {
          chosen = entry;
          break;
        }
      }
    }
  }
  if (!chosen) return null;

  const restaurant = await prisma.restaurant.findUnique({ where: { id: chosen[0] }, select: { name: true, sector: true } });
  if (!restaurant || restaurant.sector !== 'PHARMACY') return null;

  let { branchIds } = chosen[1];
  if (chosen[1].allBranches) {
    const branches = await prisma.branch.findMany({
      where: { restaurantId: chosen[0] },
      select: { id: true },
      orderBy: { sortOrder: 'asc' },
    });
    branchIds = branches.map((b) => b.id);
  }
  if (opts.branchId !== undefined && !branchIds.includes(opts.branchId)) return null;

  return {
    userId: user.id,
    name: user.name,
    restaurantId: chosen[0],
    restaurantName: restaurant.name,
    role: chosen[1].role,
    allBranches: chosen[1].allBranches,
    branchIds,
    viaMembership: chosen[1].viaMembership,
    support: chosen[1].support,
    locale: isLocale(user.locale) ? user.locale : 'en',
  };
}

/** The pharmacy identity behind the current request, or `null`. Cached for the length of one request. */
export const getPhActor = cache(async (): Promise<PhActor | null> => {
  const actor = await getActor();
  return actor ? resolvePhActor(getPrisma(), actor.userId, { now: new Date() }) : null;
});
