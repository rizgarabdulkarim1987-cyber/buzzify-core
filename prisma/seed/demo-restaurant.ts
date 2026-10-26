import type { PrismaClient } from '@/generated/prisma/client';
import type { PlanTier } from '@/server/domain/entitlements';
import type { SeedData } from './atelier';

/**
 * The plan each demo restaurant starts on, so a fresh database shows the three side by side (spec: plans and
 * entitlements, 11). Set only when the seed creates the restaurant: a reseed leaves the plan someone chose.
 */
export const DEMO_PLANS: Readonly<Record<string, PlanTier>> = {
  ATELIER: 'PREMIUM',
  'Riverlight Coffee': 'PRO',
  'Hot Brick Burgers': 'BASIC',
};

/** Finds the demo's restaurant by name (a reseed keeps it, and so its client number and plan), or creates it on its plan. */
export async function demoRestaurant(prisma: PrismaClient, { profile }: SeedData) {
  return (
    (await prisma.restaurant.findFirst({ where: { name: profile.name }, orderBy: { createdAt: 'asc' } })) ??
    (await prisma.restaurant.create({
      data: {
        name: profile.name,
        type: profile.type,
        description: profile.description,
        city: profile.city,
        country: profile.country,
        phone: profile.phone,
        whatsapp: profile.whatsapp,
        socialLinks: profile.instagram ? { instagram: profile.instagram } : {},
        address: profile.address ?? '',
        mapUrl: profile.mapUrl ?? '',
        workingHours: profile.workingHours ?? {},
        plan: DEMO_PLANS[profile.name] ?? 'PREMIUM',
      },
    }))
  );
}
