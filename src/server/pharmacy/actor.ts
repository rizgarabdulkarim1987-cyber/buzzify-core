import { cookies } from 'next/headers';
import { cache } from 'react';
import type { PrismaClient } from '@/generated/prisma/client';
import { isLocale, type Locale } from '@/lib/locale';
import { getPrisma } from '@/server/data/prisma';
import { authEnv } from '@/server/env';
import { effectiveStatus, graceEndsAt, isLive } from '@/server/domain/billing/subscriptions';
import type { PhRole } from '@/server/domain/pharmacy/permissions';
import { grantStatus } from '@/server/domain/pharmacy/support-grant';
import { getActor } from '@/server/studio/auth/actor';
import { PH_PLACE_COOKIE, readPlaceCookie, signPlaceCookie, type PhPlace } from './entry';

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
  | { state: 'closed'; reason: 'restaurantInactive' | 'notPharmacy' | 'planInactive' | 'applicationDisabled' | 'archived' };

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
    select: { status: true, trialEndsAt: true, currentPeriodEnd: true, graceDays: true, cancelledAt: true, application: { select: { status: true } } },
  });
  if (!subscription) return { state: 'closed', reason: 'planInactive' };
  // The platform's kill switch for the whole pharmacy product (read with the subscription: no extra query).
  if (subscription.application.status !== 'ACTIVE') return { state: 'closed', reason: 'applicationDisabled' };
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
 * active support grant for that restaurant (no role, the grant's scopes). A deactivated user has none. The answer is
 * for the named restaurant only: a person who works in several is never answered for another one. With `branchId` a
 * person who may not use that branch has none.
 */
export async function resolvePhActor(
  prisma: PrismaClient,
  userId: string,
  opts: { restaurantId: string; branchId?: string; now?: Date },
): Promise<PhActor | null> {
  const now = opts.now ?? new Date();
  const found = await candidatesOf(prisma, userId, opts.restaurantId, now);
  if (!found) return null;
  const { user, candidates } = found;

  const candidate = candidates.get(opts.restaurantId);
  if (!candidate) return null;
  const chosen: [string, Candidate] = [opts.restaurantId, candidate];

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

/** The restaurants a user may have a pharmacy identity in, before the sector and branches are checked. */
async function candidatesOf(prisma: PrismaClient, userId: string, restaurantId: string | undefined, now: Date) {
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
      where: { granteeUserId: userId, ...(restaurantId ? { restaurantId } : {}) },
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

  return { user, candidates };
}

/** A pharmacy a person may choose in the picker, with the branches they may use in it. */
export interface PhPlaceChoice {
  restaurantId: string;
  restaurantName: string;
  /** Whether "All branches" is a choice: the owner (and a support actor) work across every branch. */
  allBranches: boolean;
  branches: Array<{ id: string; name: string }>;
}

async function branchesNamed(prisma: PrismaClient, restaurantId: string, ids: string[]) {
  return prisma.branch.findMany({
    where: { restaurantId, id: { in: ids } },
    select: { id: true, name: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
}

/**
 * Every pharmacy the person has an identity in, in the order they joined, each with the branches they may use: what the
 * picker lists. Identity only (names of the business and its branches), never pharmacy data.
 */
export async function listPhPlaces(prisma: PrismaClient, userId: string, now: Date): Promise<PhPlaceChoice[]> {
  const found = await candidatesOf(prisma, userId, undefined, now);
  if (!found) return [];
  const byJoined = [...found.candidates.entries()].sort((x, y) => x[1].joined.getTime() - y[1].joined.getTime());
  const places: PhPlaceChoice[] = [];
  for (const [restaurantId] of byJoined) {
    const actor = await resolvePhActor(prisma, userId, { restaurantId, now });
    if (!actor || actor.branchIds.length === 0) continue;
    places.push({
      restaurantId,
      restaurantName: actor.restaurantName,
      allBranches: actor.allBranches,
      branches: await branchesNamed(prisma, restaurantId, actor.branchIds),
    });
  }
  return places;
}

/**
 * The person's identity in a chosen place, checked against the database now: the pharmacy must be theirs, the branch one
 * they may use, and "All branches" (`branchId` null) only for an all-branches actor. Null when any of it fails.
 */
export async function phPlaceFor(
  prisma: PrismaClient,
  userId: string,
  place: PhPlace,
  now: Date,
): Promise<{ actor: PhActor; branchName: string | null } | null> {
  const actor = await resolvePhActor(prisma, userId, { restaurantId: place.restaurantId, branchId: place.branchId ?? undefined, now });
  if (!actor) return null;
  if (place.branchId === null) return actor.allBranches ? { actor, branchName: null } : null;
  const [branch] = await branchesNamed(prisma, actor.restaurantId, [place.branchId]);
  return branch ? { actor, branchName: branch.name } : null;
}

export interface PhAccess {
  signedIn: boolean;
  /** The person's identity in the place their cookie names, or null when it names none they may use now. */
  actor: PhActor | null;
  gate: PhGate | null;
  place: (PhPlace & { branchName: string | null }) | null;
}

/**
 * Who is asking and where they chose to work, for the pharmacy's pages: the signed place cookie is read, its signature
 * checked for this person, and the place it names checked again against the database on every request, so an edited or
 * stale cookie gives no place. Identity, gate and place only; pharmacy data is read through the framework's queries.
 */
export const getPhAccess = cache(async (): Promise<PhAccess> => {
  const studioActor = await getActor();
  if (!studioActor) return { signedIn: false, actor: null, gate: null, place: null };
  const prisma = getPrisma();
  const now = new Date();
  const chosen = readPlaceCookie(authEnv().secret, studioActor.userId, (await cookies()).get(PH_PLACE_COOKIE)?.value);
  const found = chosen ? await phPlaceFor(prisma, studioActor.userId, chosen, now) : null;
  if (!chosen || !found) return { signedIn: true, actor: null, gate: null, place: null };
  return {
    signedIn: true,
    actor: found.actor,
    gate: await phGate(prisma, found.actor.restaurantId, now),
    place: { ...chosen, branchName: found.branchName },
  };
});

/**
 * The `ph` definition input for where the person behind the request chose to work, from the validated place cookie
 * (`getPhAccess`), never from what the browser sends: spread it into the input of every pharmacy query a page runs
 * (`query(def, { ...(await currentPhPlaceInput()), ... })`) and pass it to the client components whose Server Actions
 * need it (Task 19+). "All branches" gives no `branchId`. Null when no valid place is chosen.
 */
export async function currentPhPlaceInput(): Promise<{ restaurantId: string; branchId?: string } | null> {
  const { place } = await getPhAccess();
  if (!place) return null;
  return place.branchId === null ? { restaurantId: place.restaurantId } : { restaurantId: place.restaurantId, branchId: place.branchId };
}

/** The picker's choices for the person behind the request; empty when signed out or without a pharmacy. */
export const getPhPlaces = cache(async (): Promise<PhPlaceChoice[]> => {
  const studioActor = await getActor();
  return studioActor ? listPhPlaces(getPrisma(), studioActor.userId, new Date()) : [];
});

/**
 * The signed cookie value for a place the person behind the request chose, or null when the place is not theirs (or
 * nobody is signed in). The picker's form posts here through `/pharmacy/select/choose`.
 */
export async function signPhPlaceChoice(place: PhPlace): Promise<string | null> {
  const studioActor = await getActor();
  if (!studioActor) return null;
  const found = await phPlaceFor(getPrisma(), studioActor.userId, place, new Date());
  return found ? signPlaceCookie(authEnv().secret, studioActor.userId, place) : null;
}
