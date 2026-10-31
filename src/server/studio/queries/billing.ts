import { z } from 'zod';
import type { PrismaClient } from '@/generated/prisma/client';
import type { ApplicationId } from '@/server/domain/billing/catalog';
import { effectiveStatus, isLive } from '@/server/domain/billing/subscriptions';
import { defineQuery } from '@/server/studio/framework/query';
import { StudioError } from '@/server/studio/framework/result';
import { sellablePlanCodes } from '@/server/studio/services/billing';
import { APPLICATIONS_OF, businessSpace, sectorWhere } from '@/server/studio/services/space-scope';

/**
 * Billing reads (Task 3 of docs/superpowers/plans/2026-10-22-business-core-in-menu.md): `platform.settings`, which every
 * Super Admin holds and no client policy can grant. `canEdit` says whether the reader is the platform owner, who alone
 * may write (`plans.manage`); another Super Admin sees the same pages read-only.
 */

const PLATFORM = { kind: 'platform' } as const;
const priceOrder = [{ currency: 'asc' }, { period: 'asc' }] as const;

type Names = { en: string; ar: string; ckb: string };

/** What each product sells now: its plan codes by application id. */
async function planCodesByApplication(db: PrismaClient, ids: string[]) {
  const codes = new Map<string, string[]>();
  for (const id of ids) codes.set(id, await sellablePlanCodes(db, id as ApplicationId));
  return codes;
}

export const billingOverview = defineQuery({
  name: 'billing.overview',
  permission: 'platform.settings',
  input: z.object({ space: businessSpace }),
  target: () => PLATFORM,
  run: async (ctx, { space }) => {
    const applications = await ctx.db.application.findMany({
      where: { id: { in: [...APPLICATIONS_OF[space]] } },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      include: { prices: { orderBy: [...priceOrder] } },
    });
    const codes = await planCodesByApplication(ctx.db, applications.map((app) => app.id));
    return {
      applications: applications.map((app) => ({
        id: app.id,
        name: app.name as Names,
        status: app.status,
        sortOrder: app.sortOrder,
        plans: (codes.get(app.id) ?? []).map((code) => ({
          code,
          prices: app.prices
            .filter((price) => price.planCode === code)
            .map((price) => ({ currency: price.currency, period: price.period, amountMinor: price.amountMinor })),
        })),
      })),
      canEdit: ctx.permissions.has('plans.manage'),
    };
  },
});

/**
 * Every restaurant, a page at a time by name, with each product's subscription as it is now (its live one, else its
 * newest) and the last payment recorded for it: the Billing page of the sidebar.
 */
export const billingRestaurants = defineQuery({
  name: 'billing.restaurants',
  permission: 'platform.settings',
  input: z.object({
    page: z.number().int().min(1).max(10_000).default(1),
    pageSize: z.number().int().min(1).max(100).default(50),
    space: businessSpace,
  }),
  target: () => PLATFORM,
  run: async (ctx, input) => {
    const now = new Date();
    const [applications, total, restaurants] = await Promise.all([
      ctx.db.application.findMany({
        where: { id: { in: [...APPLICATIONS_OF[input.space]] } },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        select: { id: true, name: true, status: true },
      }),
      ctx.db.restaurant.count({ where: sectorWhere(input.space) }),
      ctx.db.restaurant.findMany({
        where: sectorWhere(input.space),
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        select: { id: true, name: true, status: true },
      }),
    ]);
    const ids = restaurants.map((restaurant) => restaurant.id);
    const [subscriptions, payments] = await Promise.all([
      ctx.db.subscription.findMany({ where: { restaurantId: { in: ids } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
      // One row per restaurant: its newest payment.
      ctx.db.payment.findMany({
        where: { restaurantId: { in: ids } },
        distinct: ['restaurantId'],
        orderBy: [{ restaurantId: 'asc' }, { paidAt: 'desc' }, { id: 'desc' }],
        select: { restaurantId: true, amountMinor: true, currency: true, paidAt: true },
      }),
    ]);
    const lastPayment = new Map(payments.map(({ restaurantId, ...payment }) => [restaurantId, payment]));

    return {
      applications: applications.map((app) => ({ id: app.id, name: app.name as Names, status: app.status })),
      rows: restaurants.map((restaurant) => ({
        ...restaurant,
        products: applications.map((app) => {
          const own = subscriptions
            .filter((sub) => sub.restaurantId === restaurant.id && sub.applicationId === app.id)
            .map((sub) => ({ sub, status: effectiveStatus(sub, now) }));
          const current = own.find(({ status }) => isLive(status)) ?? own[0];
          return {
            applicationId: app.id,
            subscription: current
              ? {
                  id: current.sub.id,
                  planCode: current.sub.planCode,
                  status: current.status,
                  currentPeriodEnd: current.sub.currentPeriodEnd,
                  // Never paid for (no anchor day yet): its period is the trial.
                  trial: current.sub.anchorDay === null && current.sub.trialEndsAt !== null,
                }
              : null,
          };
        }),
        lastPayment: lastPayment.get(restaurant.id) ?? null,
      })),
      total,
      page: input.page,
      pageSize: input.pageSize,
      now,
    };
  },
});

export const restaurantBilling = defineQuery({
  name: 'billing.restaurant',
  permission: 'platform.settings',
  input: z.object({ restaurantId: z.string().min(1).max(100) }),
  target: () => PLATFORM,
  run: async (ctx, input) => {
    const restaurant = await ctx.db.restaurant.findUnique({ where: { id: input.restaurantId }, select: { id: true, name: true, status: true, plan: true } });
    if (!restaurant) throw new StudioError('NOT_FOUND');
    const now = new Date();
    const [applications, subscriptions, payments] = await Promise.all([
      ctx.db.application.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], select: { id: true, name: true, status: true } }),
      ctx.db.subscription.findMany({
        where: { restaurantId: restaurant.id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: { events: { orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] } },
      }),
      ctx.db.payment.findMany({ where: { restaurantId: restaurant.id }, orderBy: [{ paidAt: 'desc' }, { id: 'desc' }] }),
    ]);
    const peopleIds = [...new Set([...payments.map((p) => p.recordedById), ...subscriptions.flatMap((s) => s.events.map((e) => e.actorId))])].filter(
      (id): id is string => id !== null,
    );
    const people = new Map(
      (await ctx.db.user.findMany({ where: { id: { in: peopleIds } }, select: { id: true, name: true } })).map((person) => [person.id, person.name]),
    );
    const codes = await planCodesByApplication(ctx.db, applications.map((app) => app.id));
    return {
      restaurant,
      applications: applications.map((app) => ({ id: app.id, name: app.name as Names, status: app.status, planCodes: codes.get(app.id) ?? [] })),
      subscriptions: subscriptions.map((sub) => ({
        id: sub.id,
        applicationId: sub.applicationId,
        planCode: sub.planCode,
        /** As stored; `status` is what it is as of now, when a sweep has not caught up yet. */
        storedStatus: sub.status,
        status: effectiveStatus(sub, now),
        period: sub.period,
        currency: sub.currency,
        priceMinor: sub.priceMinor,
        trialEndsAt: sub.trialEndsAt,
        currentPeriodStart: sub.currentPeriodStart,
        currentPeriodEnd: sub.currentPeriodEnd,
        anchorDay: sub.anchorDay,
        graceDays: sub.graceDays,
        cancelledAt: sub.cancelledAt,
        version: sub.version,
        events: sub.events.map((event) => ({
          id: event.id,
          type: event.type,
          fromStatus: event.fromStatus,
          toStatus: event.toStatus,
          data: event.data,
          actorName: event.actorId === null ? null : (people.get(event.actorId) ?? null),
          occurredAt: event.occurredAt,
        })),
      })),
      payments: payments.map((payment) => ({
        id: payment.id,
        subscriptionId: payment.subscriptionId,
        amountMinor: payment.amountMinor,
        currency: payment.currency,
        method: payment.method,
        reference: payment.reference,
        paidAt: payment.paidAt,
        coversFrom: payment.coversFrom,
        coversTo: payment.coversTo,
        note: payment.note,
        recordedByName: people.get(payment.recordedById) ?? null,
        createdAt: payment.createdAt,
      })),
      now,
      canEdit: ctx.permissions.has('plans.manage'),
    };
  },
});
