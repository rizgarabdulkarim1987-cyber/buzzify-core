import { z } from 'zod';
import { effectiveStatus, isLive } from '@/server/domain/billing/subscriptions';
import { defineQuery } from '@/server/studio/framework/query';

type Names = { en: string; ar: string; ckb: string };

/**
 * Every PHARMACY-sector business on the platform, for the Studio's Pharmacy page: its branches, its status, its
 * `pharmacy` subscription as it is now (the live one, else the newest) and when it was created. `platform.settings`,
 * like the Billing list and the Cashier overview: every Super Admin holds it and no client policy can grant it, so no
 * tenant reads it. The same businesses stay in the Restaurants list, where a Super Admin also bills them.
 */
export const listPharmacies = defineQuery({
  name: 'pharmacies.list',
  permission: 'platform.settings',
  input: z.object({}),
  target: () => ({ kind: 'platform' }) as const,
  run: async (ctx) => {
    const now = new Date();
    const [businesses, plans] = await Promise.all([
      ctx.db.restaurant.findMany({
        where: { sector: 'PHARMACY' },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          name: true,
          status: true,
          createdAt: true,
          _count: { select: { branches: true } },
          subscriptions: {
            where: { applicationId: 'pharmacy' },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            select: { planCode: true, status: true, trialEndsAt: true, currentPeriodEnd: true, graceDays: true, anchorDay: true },
          },
        },
      }),
      ctx.db.appPlan.findMany({ where: { applicationId: 'pharmacy' }, select: { code: true, name: true } }),
    ]);
    const planName = new Map(plans.map((plan) => [plan.code, plan.name as Names]));

    return {
      rows: businesses.map((business) => {
        const own = business.subscriptions.map((sub) => ({ sub, status: effectiveStatus(sub, now) }));
        const current = own.find(({ status }) => isLive(status)) ?? own[0];
        return {
          id: business.id,
          name: business.name,
          status: business.status,
          branches: business._count.branches,
          createdAt: business.createdAt,
          subscription: current
            ? {
                status: current.status,
                planCode: current.sub.planCode,
                planName: planName.get(current.sub.planCode) ?? null,
                currentPeriodEnd: current.sub.currentPeriodEnd,
                // Never paid for (no anchor day yet): its period is the trial.
                trial: current.sub.anchorDay === null && current.sub.trialEndsAt !== null,
              }
            : null,
        };
      }),
    };
  },
});
