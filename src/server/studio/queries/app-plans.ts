import { z } from 'zod';
import { pharmacyLimitsSchema, type AppPlanRow, type PharmacyLimits, type RetailAppPlanRow } from '@/server/domain/pharmacy/limits';
import { retailLimitsSchema } from '@/server/domain/retail/limits';
import { defineQuery } from '@/server/studio/framework/query';

/**
 * The pharmacy and Retail plans for the billing screens: `platform.settings`, which every Super Admin holds. `canEdit`
 * says whether the reader is the platform owner, who alone may write (`plans.manage`). `applicationId` picks the product
 * and defaults to the pharmacy.
 */

const PLATFORM = { kind: 'platform' } as const;

export const appPlansList = defineQuery({
  name: 'appPlans.list',
  permission: 'platform.settings',
  input: z.object({ applicationId: z.enum(['pharmacy', 'retail']).default('pharmacy') }),
  target: () => PLATFORM,
  run: async (ctx, input) => {
    const applicationId = input.applicationId;
    const [plans, counts] = await Promise.all([
      ctx.db.appPlan.findMany({ where: { applicationId }, orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] }),
      ctx.db.subscription.groupBy({ by: ['planCode'], where: { applicationId }, _count: { _all: true } }),
    ]);
    const used = new Map(counts.map((row) => [row.planCode, row._count._all]));
    const rows: Array<AppPlanRow<PharmacyLimits> | RetailAppPlanRow> = plans.map((plan) => {
      const limits = (applicationId === 'retail' ? retailLimitsSchema : pharmacyLimitsSchema).safeParse(plan.limits);
      return {
        code: plan.code,
        name: plan.name as AppPlanRow['name'],
        limits: limits.success ? limits.data : null,
        active: plan.active,
        sortOrder: plan.sortOrder,
        version: plan.version,
        subscriptions: used.get(plan.code) ?? 0,
      } as AppPlanRow<PharmacyLimits> | RetailAppPlanRow;
    });
    return { applicationId, plans: rows, canEdit: ctx.permissions.has('plans.manage') };
  },
});
