import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import { expirePlans } from '@/server/data/cache';
import { extrasToStore, parseExtras, parsePlans, PLAN_NAME_MAX, PLAN_TIERS, plansToStore } from '@/server/domain/entitlements';
import { LOCALES } from '@/lib/locale';
import { defineAction } from '@/server/studio/framework/action';
import { StudioError } from '@/server/studio/framework/result';
import { PLANS_SETTING, readPlans, readUpgradeWhatsApp, UPGRADE_WHATSAPP_SETTING } from '@/server/data/plans';
import { followRestaurantPlan } from '@/server/studio/services/billing';
import { expireMenusAfterCommit } from '@/server/studio/services/restaurants';

/**
 * Plans (spec: plans and entitlements, sections 2.1 and 8): only the platform owner holds `plans.manage`, so only they set
 * a restaurant's plan, its extras and the note, edit what each plan holds, and set the WhatsApp number the upgrade button
 * opens. Only one account can change these, so the last save wins; every save is in the audit log.
 */

const idField = z.string().min(1).max(100);
const PLATFORM = { kind: 'platform' } as const;

/** Feature switches as sent; keys that are not features are dropped when they are read (`parseExtras`, `parsePlans`). */
const switches = z.record(z.string().max(64), z.boolean());

export const setRestaurantPlan = defineAction({
  name: 'plans.setRestaurantPlan',
  permission: 'plans.manage',
  input: z.object({
    restaurantId: idField,
    plan: z.enum(PLAN_TIERS, 'Choose one of the plans offered'),
    extras: switches.default({}),
    note: z.string().trim().max(2000, 'Use at most 2,000 characters').default(''),
  }),
  target: (i) => ({ kind: 'restaurant', restaurantId: i.restaurantId }),
  run: (ctx, input) =>
    ctx.transaction(async (tx) => {
      const restaurantId = ctx.restaurantId;
      if (restaurantId === null) throw new Error('plans.setRestaurantPlan ran without a restaurant');
      const before = await tx.restaurant.findUnique({ where: { id: restaurantId }, select: { plan: true, planExtras: true, planNote: true } });
      if (!before) throw new StudioError('NOT_FOUND');
      const extras = parseExtras({ features: input.extras });
      await tx.restaurant.update({
        where: { id: restaurantId },
        data: { plan: input.plan, planExtras: extrasToStore(extras) as Prisma.InputJsonObject, planNote: input.note },
      });

      const changes: Record<string, { before: unknown; after: unknown }> = {};
      if (before.plan !== input.plan) changes.plan = { before: before.plan, after: input.plan };
      const extrasBefore = parseExtras(before.planExtras);
      if (JSON.stringify(extrasToStore(extrasBefore)) !== JSON.stringify(extrasToStore(extras))) changes.extras = { before: extrasBefore, after: extras };
      if (before.planNote !== input.note) changes.note = { before: before.planNote, after: input.note };
      if (Object.keys(changes).length > 0) {
        ctx.audit({ action: 'restaurant.plan_changed', entityType: 'RestaurantPlan', entityId: restaurantId, changes });
      }
      // The live Menu subscription follows, so a later payment does not put the restaurant back on its old plan.
      await followRestaurantPlan(tx, ctx, input.plan, new Date());

      // What guests see depends on the plan and is cached per address: every address of every menu is expired.
      await expireMenusAfterCommit(tx, ctx.afterCommit);
      return { plan: input.plan, extras, note: input.note };
    }),
});

const planName = z.string().trim().min(1, 'Enter the plan’s name').max(PLAN_NAME_MAX, `Use at most ${PLAN_NAME_MAX} characters`);

/** The platform owner's WhatsApp number: digits with the country code (spaces, +, - and brackets are taken out), or none. */
const whatsappField = z
  .string()
  .max(40)
  .transform((value) => value.replace(/[\s+\-()]/g, ''))
  .refine((digits) => digits === '' || /^\d{8,15}$/.test(digits), 'Enter the number with its country code, digits only');

export const updatePlans = defineAction({
  name: 'plans.update',
  permission: 'plans.manage',
  input: z.object({
    plans: z.partialRecord(
      z.enum(PLAN_TIERS),
      z.object({ names: z.partialRecord(z.enum(LOCALES), planName).optional(), features: switches.optional() }),
    ),
    whatsapp: whatsappField,
  }),
  target: () => PLATFORM,
  run: (ctx, input) =>
    ctx.transaction(async (tx) => {
      const before = plansToStore(await readPlans(tx));
      const merged = structuredClone(before) as Record<string, { names: Record<string, string>; features: Record<string, boolean> }>;
      for (const tier of PLAN_TIERS) {
        const change = input.plans[tier];
        if (!change) continue;
        merged[tier] = { names: { ...merged[tier]!.names, ...change.names }, features: { ...merged[tier]!.features, ...change.features } };
      }
      const after = plansToStore(parsePlans(merged));
      const whatsappBefore = (await readUpgradeWhatsApp(tx)) ?? '';

      const changes: Record<string, { before: unknown; after: unknown }> = {};
      for (const tier of PLAN_TIERS) {
        for (const [locale, name] of Object.entries(after[tier].names)) {
          const was = before[tier].names[locale as keyof (typeof before)[typeof tier]['names']];
          if (was !== name) changes[`${tier}.names.${locale}`] = { before: was, after: name };
        }
        for (const [key, on] of Object.entries(after[tier].features)) {
          const was = before[tier].features[key as keyof (typeof before)[typeof tier]['features']];
          if (was !== on) changes[`${tier}.${key}`] = { before: was, after: on };
        }
      }
      if (whatsappBefore !== input.whatsapp) changes.whatsapp = { before: whatsappBefore, after: input.whatsapp };
      if (Object.keys(changes).length === 0) return { plans: after, whatsapp: input.whatsapp };

      await tx.platformSetting.upsert({
        where: { key: PLANS_SETTING },
        create: { key: PLANS_SETTING, value: after as unknown as Prisma.InputJsonObject, updatedById: ctx.actor.userId },
        update: { value: after as unknown as Prisma.InputJsonObject, updatedById: ctx.actor.userId },
      });
      await tx.platformSetting.upsert({
        where: { key: UPGRADE_WHATSAPP_SETTING },
        create: { key: UPGRADE_WHATSAPP_SETTING, value: input.whatsapp, updatedById: ctx.actor.userId },
        update: { value: input.whatsapp, updatedById: ctx.actor.userId },
      });
      ctx.audit({ action: 'plans.updated', entityType: 'Plans', entityId: PLANS_SETTING, changes });
      ctx.afterCommit(() => expirePlans());
      return { plans: after, whatsapp: input.whatsapp };
    }),
});
