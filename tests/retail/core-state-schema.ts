import { z, type ZodType } from 'zod';

/*
 * A verbatim copy of Retails' `coreStateSchema` (buzzify-retails src/server/core/state.ts, commit b67060e), with the
 * Prisma enum types inlined. Temporary: Task 5's `contract-oracle.ts` replaces it. Re-copy when Retails changes it.
 */

type SubscriptionStatus = 'TRIAL' | 'ACTIVE' | 'GRACE' | 'EXPIRED' | 'CANCELLED';
const SUBSCRIPTION_STATUSES = ['TRIAL', 'ACTIVE', 'GRACE', 'EXPIRED', 'CANCELLED'] as const;
const BUSINESS_STATUSES = ['ACTIVE', 'SUSPENDED', 'ARCHIVED'] as const;

export type CoreState = {
  coreBusinessId: string;
  version: number;
  status: (typeof BUSINESS_STATUSES)[number];
  plan: { code: string; name: string; maxBranches: number; maxTerminals: number; maxUsers: number; storageMb: number; aiMonthly: number };
  subscription: {
    status: SubscriptionStatus;
    trialEndsAt: Date | null;
    currentPeriodStart: Date;
    currentPeriodEnd: Date;
    graceDays: number;
  };
  aiIntake: boolean;
  owner: { coreUserId: string; email: string; emailVerified: boolean; name: string };
};

const isoDate = z.iso.datetime({ offset: true }).transform((s) => new Date(s));
const limit = z.number().int().min(0).max(1_000_000_000);
const id = z.string().trim().min(1).max(128);

export const coreStateSchema: ZodType<CoreState> = z.object({
  coreBusinessId: id,
  version: z.number().int().min(1).max(2_000_000_000),
  status: z.enum(BUSINESS_STATUSES),
  plan: z.object({
    code: z.string().trim().min(1).max(64),
    name: z.string().trim().min(1).max(120),
    maxBranches: limit,
    maxTerminals: limit,
    maxUsers: limit,
    storageMb: limit,
    aiMonthly: limit,
  }),
  subscription: z
    .object({
      status: z.enum(SUBSCRIPTION_STATUSES),
      trialEndsAt: isoDate.nullable(),
      currentPeriodStart: isoDate,
      currentPeriodEnd: isoDate,
      graceDays: z.number().int().min(0).max(365),
    })
    .refine((v) => v.status !== 'TRIAL' || v.trialEndsAt !== null, { message: 'TRIAL requires trialEndsAt', path: ['trialEndsAt'] })
    .refine((v) => v.currentPeriodEnd.getTime() > v.currentPeriodStart.getTime(), {
      message: 'currentPeriodEnd must be after currentPeriodStart',
      path: ['currentPeriodEnd'],
    }),
  aiIntake: z.boolean(),
  owner: z.object({
    coreUserId: id,
    email: z.string().trim().max(254).pipe(z.email()),
    emailVerified: z.boolean(),
    name: z.string().trim().max(200),
  }),
});
