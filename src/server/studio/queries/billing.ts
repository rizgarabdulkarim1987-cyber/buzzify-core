import { z } from 'zod';
import { planCodesFor, type ApplicationId } from '@/server/domain/billing/catalog';
import { effectiveStatus } from '@/server/domain/billing/subscriptions';
import { defineQuery } from '@/server/studio/framework/query';
import { StudioError } from '@/server/studio/framework/result';

/**
 * Billing reads (Task 3 of docs/superpowers/plans/2026-10-22-business-core-in-menu.md): `platform.settings`, which every
 * Super Admin holds and no client policy can grant. `canEdit` says whether the reader is the platform owner, who alone
 * may write (`plans.manage`); another Super Admin sees the same pages read-only.
 */

const PLATFORM = { kind: 'platform' } as const;
const priceOrder = [{ currency: 'asc' }, { period: 'asc' }] as const;

type Names = { en: string; ar: string; ckb: string };

export const billingOverview = defineQuery({
  name: 'billing.overview',
  permission: 'platform.settings',
  input: z.object({}),
  target: () => PLATFORM,
  run: async (ctx) => {
    const applications = await ctx.db.application.findMany({
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      include: { prices: { orderBy: [...priceOrder] } },
    });
    return {
      applications: applications.map((app) => ({
        id: app.id,
        name: app.name as Names,
        status: app.status,
        sortOrder: app.sortOrder,
        plans: planCodesFor(app.id as ApplicationId).map((code) => ({
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
    return {
      restaurant,
      applications: applications.map((app) => ({ id: app.id, name: app.name as Names, status: app.status, planCodes: [...planCodesFor(app.id as ApplicationId)] })),
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
