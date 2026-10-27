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
  restaurantName: string;
  role: PosRole;
  /** True when the role comes from being the restaurant's Studio OWNER rather than from a staff row. */
  viaMembership: boolean;
  locale: Locale;
}

export type PosGate = { open: true } | { open: false; reason: 'restaurantInactive' | 'cashierPlanInactive' };

/**
 * The till identity of a user: a Studio OWNER member is the cashier OWNER of that restaurant, anyone else needs an
 * active staff row. A Studio DESIGNER alone, a Super Admin and a deactivated person have none. With `restaurantId`
 * the answer is for that restaurant only; without it, the first they joined whose till is open (else the first).
 */
export async function resolvePosActor(prisma: PrismaClient, userId: string, restaurantId?: string): Promise<PosActor | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      // A pharmacy business has no till: whatever the person holds there, the cashier never resolves it. The sector
      // is filtered inside these reads so a FOOD till pays no extra round trip for it.
      memberships: { where: { role: 'OWNER', restaurant: { sector: 'FOOD' } }, select: { restaurantId: true, createdAt: true } },
      posStaffs: { where: { deactivatedAt: null, restaurant: { sector: 'FOOD' } }, select: { restaurantId: true, role: true, createdAt: true } },
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

  let chosen: readonly [string, (typeof candidates extends Map<string, infer V> ? V : never) | undefined] | undefined;
  if (restaurantId !== undefined) {
    chosen = [restaurantId, candidates.get(restaurantId)];
  } else {
    // The first restaurant they joined whose till is open; if none is open, the first they joined (it shows why it is closed).
    const byJoined = [...candidates.entries()].sort((x, y) => x[1].joined.getTime() - y[1].joined.getTime());
    chosen = byJoined[0];
    if (byJoined.length > 1) {
      for (const entry of byJoined) {
        if ((await posGate(prisma, entry[0])).open) {
          chosen = entry;
          break;
        }
      }
    }
  }
  if (!chosen || !chosen[1]) return null;
  const restaurant = await prisma.restaurant.findUnique({ where: { id: chosen[0] }, select: { name: true } });
  if (!restaurant) return null;

  return {
    userId: user.id,
    name: user.name,
    restaurantId: chosen[0],
    restaurantName: restaurant.name,
    role: chosen[1].role,
    viaMembership: chosen[1].viaMembership,
    locale: isLocale(user.locale) ? user.locale : 'en',
  };
}

/** Whether a restaurant may use the till now: not a pharmacy, ACTIVE, and with a live `cashier` subscription (grace counted as live). */
export async function posGate(prisma: PrismaClient, restaurantId: string, now: Date = new Date()): Promise<PosGate> {
  const restaurant = await prisma.restaurant.findUnique({ where: { id: restaurantId }, select: { status: true, sector: true } });
  if (!restaurant || restaurant.status !== 'ACTIVE' || restaurant.sector === 'PHARMACY') return { open: false, reason: 'restaurantInactive' };
  const subscription = await prisma.subscription.findFirst({
    where: { restaurantId, applicationId: 'cashier' },
    select: { status: true, trialEndsAt: true, currentPeriodEnd: true, graceDays: true },
  });
  if (!subscription || !isLive(effectiveStatus(subscription, now))) return { open: false, reason: 'cashierPlanInactive' };
  return { open: true };
}

/** The person, their till identity and whether the till is open for their restaurant, for one request. */
export const getPosAccess = cache(async () => {
  const studioActor = await getActor();
  if (!studioActor) return { signedIn: false as const, actor: null, gate: null };
  const prisma = getPrisma();
  const actor = await resolvePosActor(prisma, studioActor.userId, studioActor.posRestaurantId);
  return { signedIn: true as const, actor, gate: actor ? await posGate(prisma, actor.restaurantId) : null };
});
