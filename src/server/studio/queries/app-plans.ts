import { z } from 'zod';
import { pharmacyLimitsSchema, type AppPlanRow } from '@/server/domain/pharmacy/limits';
import { defineQuery } from '@/server/studio/framework/query';

/**
 * The pharmacy plans for the billing screens: `platform.settings`, which every Super Admin holds. `canEdit` says whether
 * the reader is the platform owner, who alone may write (`plans.manage`).
 */

const PLATFORM = { kind: 'platform' } as const;

export const appPlansList = defineQuery({
  name: 'appPlans.list',
  permission: 'platform.settings',
  input: z.object({}),
  target: () => PLATFORM,
  run: async (ctx) => {
    const [plans, counts] = await Promise.all([
      ctx.db.appPlan.findMany({ where: { applicationId: 'pharmacy' }, orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] }),
      ctx.db.subscription.groupBy({ by: ['planCode'], where: { applicationId: 'pharmacy' }, _count: { _all: true } }),
    ]);
    const used = new Map(counts.map((row) => [row.planCode, row._count._all]));
    const rows: AppPlanRow[] = plans.map((plan) => {
      const limits = pharmacyLimitsSchema.safeParse(plan.limits);
      return {
        code: plan.code,
        name: plan.name as AppPlanRow['name'],
        limits: limits.success ? limits.data : null,
        active: plan.active,
        sortOrder: plan.sortOrder,
        version: plan.version,
        subscriptions: used.get(plan.code) ?? 0,
      };
    });
    return { plans: rows, canEdit: ctx.permissions.has('plans.manage') };
  },
});
