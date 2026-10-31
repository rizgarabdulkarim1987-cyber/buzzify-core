import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import { pharmacyLimitsSchema } from '@/server/domain/pharmacy/limits';
import { retailLimitsSchema } from '@/server/domain/retail/limits';
import { defineAction } from '@/server/studio/framework/action';
import { updateWithVersion } from '@/server/studio/framework/concurrency';
import { StudioError } from '@/server/studio/framework/result';

/**
 * The pharmacy and Retail plans (`AppPlan`): what each one is called and the limits it sets. Only the platform owner holds
 * `plans.manage`, so only they make or change a plan; the target is the platform, so anyone else is refused before any
 * row is read. A plan is changed with the version the person opened it at and refused, naming who changed it, if it has
 * moved on. No prices are written here: they are the billing screens' (`billing.setPrices`).
 */

const PLATFORM = { kind: 'platform' } as const;

const nameText = z.string().trim().min(1, 'Enter a name').max(80, 'Use at most 80 characters');
const version = z.number().int().positive();

const planFields = {
  code: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_-]{1,39}$/, 'Use 2 to 40 lower-case letters, digits, dashes or underscores, starting with a letter'),
  name: z.object({ en: nameText, ar: nameText, ckb: nameText }),
  sortOrder: z.number('Enter a whole number').int('Enter a whole number').min(0, 'Use 0 or more').max(1000, 'Use at most 1,000').default(0),
  active: z.boolean().default(true),
  /** Absent to make a new plan; the version the person opened an existing one at to change it. */
  version: version.optional(),
};

/** The products that sell `AppPlan`s. Absent means the pharmacy, which keeps the calls from before Retail working. */
const withDefaultApplication = (value: unknown) =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && (value as { applicationId?: unknown }).applicationId === undefined
    ? { ...value, applicationId: 'pharmacy' }
    : value;

/** Each product's own limits: a pharmacy-shaped object is not a Retail plan's and the reverse. */
const appPlanInput = z.preprocess(
  withDefaultApplication,
  z.discriminatedUnion('applicationId', [
    z.object({ applicationId: z.literal('pharmacy'), limits: pharmacyLimitsSchema, ...planFields }),
    z.object({ applicationId: z.literal('retail'), limits: retailLimitsSchema, ...planFields }),
  ]),
);

type Changes = Record<string, { before: unknown; after: unknown }>;

const NAME_LOCALES = ['en', 'ar', 'ckb'] as const;

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';
}

const taken = () => new StudioError('CONFLICT', 'A plan with this code already exists', { code: 'Use another code: this one is taken' });

export const upsert = defineAction({
  name: 'appPlans.upsert',
  permission: 'plans.manage',
  input: appPlanInput,
  target: () => PLATFORM,
  run: (ctx, input) =>
    ctx.transaction(async (tx) => {
      const APPLICATION = input.applicationId;
      if (!(await tx.application.findUnique({ where: { id: APPLICATION }, select: { id: true } }))) throw new StudioError('NOT_FOUND');
      const existing = await tx.appPlan.findUnique({
        where: { applicationId_code: { applicationId: APPLICATION, code: input.code } },
      });
      const data = { name: input.name, limits: input.limits, sortOrder: input.sortOrder, active: input.active };

      if (input.version === undefined) {
        if (existing) throw taken();
        try {
          const created = await tx.appPlan.create({
            data: { applicationId: APPLICATION, code: input.code, ...data },
            select: { id: true, version: true },
          });
          ctx.audit({
            action: 'app_plan.created',
            entityType: 'AppPlan',
            entityId: created.id,
            changes: {
              code: { before: null, after: input.code },
              name: { before: null, after: input.name },
              limits: { before: null, after: input.limits },
              active: { before: null, after: input.active },
            },
          });
          return { id: created.id, version: created.version };
        } catch (error) {
          // Two saves of the same new code at once: the unique key refuses the second.
          if (isUniqueViolation(error)) throw taken();
          throw error;
        }
      }

      if (!existing) throw new StudioError('NOT_FOUND');
      const changes: Changes = {};
      const was = (existing.name ?? {}) as Record<string, unknown>;
      // Compared per language: the stored JSON keeps its keys in its own order.
      if (NAME_LOCALES.some((locale) => was[locale] !== input.name[locale])) changes.name = { before: existing.name, after: input.name };
      const wasLimits = (input.applicationId === 'retail' ? retailLimitsSchema : pharmacyLimitsSchema).safeParse(existing.limits);
      if (!wasLimits.success || JSON.stringify(wasLimits.data) !== JSON.stringify(input.limits)) {
        changes.limits = { before: existing.limits, after: input.limits };
      }
      if (existing.sortOrder !== input.sortOrder) changes.sortOrder = { before: existing.sortOrder, after: input.sortOrder };
      if (existing.active !== input.active) changes.active = { before: existing.active, after: input.active };
      // Nothing to write, and nothing moved since: no new version. A stale version still goes through the check below.
      if (Object.keys(changes).length === 0 && existing.version === input.version) return { id: existing.id, version: existing.version };

      // Seam for Retail's snapshot (Task 4): a retail plan's limit or name change is queued for the linked shops here.
      await updateWithVersion(
        tx.appPlan,
        { id: existing.id, version: input.version, data: data as Prisma.AppPlanUpdateInput, entityType: 'AppPlan' },
        tx,
      );
      if (Object.keys(changes).length > 0) {
        ctx.audit({ action: 'app_plan.updated', entityType: 'AppPlan', entityId: existing.id, changes });
      }
      return { id: existing.id, version: input.version + 1 };
    }),
});

export const deactivate = defineAction({
  name: 'appPlans.deactivate',
  permission: 'plans.manage',
  input: z.preprocess(
    withDefaultApplication,
    z.object({ applicationId: z.enum(['pharmacy', 'retail']), code: z.string().trim().min(1).max(40), version }),
  ),
  target: () => PLATFORM,
  run: (ctx, input) =>
    ctx.transaction(async (tx) => {
      const existing = await tx.appPlan.findUnique({ where: { applicationId_code: { applicationId: input.applicationId, code: input.code } } });
      if (!existing) throw new StudioError('NOT_FOUND');
      if (!existing.active && existing.version === input.version) return { id: existing.id, version: existing.version };
      // Taken off sale only: subscriptions already on the plan keep it and its limits.
      await updateWithVersion(tx.appPlan, { id: existing.id, version: input.version, data: { active: false }, entityType: 'AppPlan' }, tx);
      if (existing.active) {
        ctx.audit({ action: 'app_plan.deactivated', entityType: 'AppPlan', entityId: existing.id, changes: { active: { before: true, after: false } } });
      }
      return { id: existing.id, version: input.version + 1 };
    }),
});
