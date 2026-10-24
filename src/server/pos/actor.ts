import { cache } from 'react';
import type { PrismaClient } from '@/generated/prisma/client';
import { isLocale, type Locale } from '@/lib/locale';
import { getPrisma } from '@/server/data/prisma';
import { effectiveStatus, isLive } from '@/server/domain/billing/subscriptions';
import type { PosRole } from '@/server/domain/pos/permissions';
import { getActor } from '@/server/studio/auth/actor';

/** Who is at the till: a person and the one restaurant and cashier role they act in. */
export interface PosActor {
  userId: string;
  name: string;
  restaurantId: string;
  role: PosRole;
  /** True when the role comes from being the restaurant's Studio OWNER rather than from a staff row. */
  viaMembership: boolean;
  locale: Locale;
}

export type PosGate = { open: true } | { open: false; reason: 'restaurantInactive' | 'cashierPlanInactive' };

/**
 * The till identity of a user: a Studio OWNER member is the cashier OWNER of that restaurant, anyone else needs an
 * active staff row. A Studio DESIGNER alone, a Super Admin and a deactivated person have none. With `restaurantId`
 * the answer is for that restaurant only; without it, the restaurant they joined first.
 */
export async function resolvePosActor(prisma: PrismaClient, userId: string, restaurantId?: string): Promise<PosActor | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      memberships: { where: { role: 'OWNER' }, select: { restaurantId: true, createdAt: true } },
      posStaffs: { where: { deactivatedAt: null }, select: { restaurantId: true, role: true, createdAt: true } },
    },
  });
  if (!user || user.deactivatedAt || user.isSuperAdmin) return null;

  const candidates = new Map<string, { role: PosRole; viaMembership: boolean; joined: Date }>();
  for (const staff of user.posStaffs) {
    candidates.set(staff.restaurantId, { role: staff.role, viaMembership: false, joined: staff.createdAt });
  }
  // The membership wins over a staff row of the same restaurant: an owner is always the owner.
  for (const member of user.memberships) {
    candidates.set(member.restaurantId, { role: 'OWNER', viaMembership: true, joined: member.createdAt });
  }

  const chosen =
    restaurantId !== undefined
      ? ([restaurantId, candidates.get(restaurantId)] as const)
      : [...candidates.entries()].sort((x, y) => x[1].joined.getTime() - y[1].joined.getTime())[0];
  if (!chosen || !chosen[1]) return null;

  return {
    userId: user.id,
    name: user.name,
    restaurantId: chosen[0],
    role: chosen[1].role,
    viaMembership: chosen[1].viaMembership,
    locale: isLocale(user.locale) ? user.locale : 'en',
  };
}

/** Whether a restaurant may use the till now: ACTIVE, and with a live `cashier` subscription (grace counted as live). */
export async function posGate(prisma: PrismaClient, restaurantId: string, now: Date = new Date()): Promise<PosGate> {
  const restaurant = await prisma.restaurant.findUnique({ where: { id: restaurantId }, select: { status: true } });
  if (!restaurant || restaurant.status !== 'ACTIVE') return { open: false, reason: 'restaurantInactive' };
  const subscription = await prisma.subscription.findFirst({
    where: { restaurantId, applicationId: 'cashier' },
    select: { status: true, trialEndsAt: true, currentPeriodEnd: true, graceDays: true },
  });
  if (!subscription || !isLive(effectiveStatus(subscription, now))) return { open: false, reason: 'cashierPlanInactive' };
  return { open: true };
}

/** The till identity behind the current request, or `null`. Cached for the length of one request. */
export const getPosActor = cache(async (): Promise<PosActor | null> => {
  const actor = await getActor();
  return actor ? resolvePosActor(getPrisma(), actor.userId) : null;
});

/** The person, their till identity and whether the till is open for their restaurant, for one request. */
export const getPosAccess = cache(async () => {
  const studioActor = await getActor();
  if (!studioActor) return { signedIn: false as const, actor: null, gate: null };
  const prisma = getPrisma();
  const actor = await resolvePosActor(prisma, studioActor.userId);
  return { signedIn: true as const, actor, gate: actor ? await posGate(prisma, actor.restaurantId) : null };
});
