import { z } from 'zod';
import { effectiveStatus, isLive } from '@/server/domain/billing/subscriptions';
import { ownedRetailShops } from '@/server/retail/handoff';
import { aiUnitsOf, deriveSyncState } from '@/server/retail/sync-state';
import { defineQuery, type QueryContext } from '@/server/studio/framework/query';
import { StudioError } from '@/server/studio/framework/result';

type Names = { en: string; ar: string; ckb: string };

/**
 * The retail shops the signed-in person owns, for the handoff's chooser (`/studio/retail/choose`): name and whether
 * Buzzify Retail has provisioned it. Keyed by the actor's own OWNER memberships, never by an id from the input.
 */
export const myRetailShops = defineQuery({
  name: 'retail.myShops',
  permission: null,
  input: z.unknown(),
  target: () => ({ kind: 'self' }),
  run: async ({ actor, db }) => ownedRetailShops(db, actor.userId),
});

/**
 * Every RETAIL-sector business that has a `RetailLink`, for the Studio's Retail page: branches, status, its `retail`
 * subscription as it is now (the live one, else the newest) and how far delivery to Buzzify Retail is. `failedOnly` keeps
 * the shops whose delivery failed. `platform.settings`, like the pharmacy list: no tenant reads it.
 */
export const retailList = defineQuery({
  name: 'retail.list',
  permission: 'platform.settings',
  input: z.object({ failedOnly: z.boolean().optional() }),
  target: () => ({ kind: 'platform' }) as const,
  run: async (ctx, { failedOnly }) => {
    const now = new Date();
    const [shops, plans] = await Promise.all([
      ctx.db.restaurant.findMany({
        where: { sector: 'RETAIL', retailLink: { isNot: null } },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          name: true,
          status: true,
          createdAt: true,
          _count: { select: { branches: true } },
          retailLink: { select: { retailBusinessId: true, stateVersion: true, acceptedVersion: true } },
          retailOutbox: { select: { attempts: true, nextAttemptAt: true, waitingFor: true, lastError: true, failedAt: true } },
          subscriptions: {
            where: { applicationId: 'retail' },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            select: { planCode: true, status: true, trialEndsAt: true, currentPeriodEnd: true, graceDays: true, anchorDay: true },
          },
        },
      }),
      ctx.db.appPlan.findMany({ where: { applicationId: 'retail' }, select: { code: true, name: true } }),
    ]);
    const planName = new Map(plans.map((plan) => [plan.code, plan.name as Names]));

    const rows = shops.map((shop) => {
      const own = shop.subscriptions.map((sub) => ({ sub, status: effectiveStatus(sub, now) }));
      const current = own.find(({ status }) => isLive(status)) ?? own[0];
      return {
        id: shop.id,
        name: shop.name,
        status: shop.status,
        branches: shop._count.branches,
        createdAt: shop.createdAt,
        sync: deriveSyncState(shop.retailLink!, shop.retailOutbox),
        subscription: current
          ? {
              status: current.status,
              planCode: current.sub.planCode,
              planName: planName.get(current.sub.planCode) ?? null,
              currentPeriodEnd: current.sub.currentPeriodEnd,
              trial: current.sub.anchorDay === null && current.sub.trialEndsAt !== null,
            }
          : null,
      };
    });
    return { rows: failedOnly ? rows.filter((row) => row.sync.kind === 'failed') : rows };
  },
});

function restaurantOf(ctx: QueryContext): string {
  if (ctx.restaurantId === null) throw new Error('A retail query ran without a restaurant');
  return ctx.restaurantId;
}

/**
 * One linked shop's Retail tab: versions, what the last reconcile read from Retails, the last error code, the delivery
 * attempts and the AI usage this month in units. Never the shop's id in Retails, a token or a response body. `can.aiIntake`
 * is the platform owner's right to the AI switch (a Super Admin who is not the owner sees it off); `isOwner` is whether the
 * reader owns this shop, who alone gets the "Open Retails" link.
 */
export const retailDetail = defineQuery({
  name: 'retail.detail',
  permission: 'platform.settings',
  input: z.object({ restaurantId: z.string().min(1).max(100) }),
  target: (i) => ({ kind: 'restaurant', restaurantId: i.restaurantId }) as const,
  run: async (ctx) => {
    const restaurantId = restaurantOf(ctx);
    const [shop, outbox] = await Promise.all([
      ctx.db.restaurant.findUnique({
        where: { id: restaurantId },
        select: { id: true, name: true, sector: true, retailLink: true },
      }),
      ctx.db.retailOutbox.findUnique({ where: { restaurantId } }),
    ]);
    const link = shop?.retailLink;
    if (!shop || shop.sector !== 'RETAIL' || !link) throw new StudioError('NOT_FOUND');
    return {
      id: shop.id,
      name: shop.name,
      provisioned: link.retailBusinessId !== null,
      stateVersion: link.stateVersion,
      acceptedVersion: link.acceptedVersion,
      remoteVersion: link.remoteVersion,
      remoteStatus: link.remoteStatus,
      reconciledAt: link.reconciledAt,
      aiIntake: link.aiIntake,
      aiUsage: { month: link.aiUsageMonth, units: aiUnitsOf(link.aiUsageHalfUnits) },
      sync: deriveSyncState(link, outbox),
      attempts: outbox?.attempts ?? 0,
      nextAttemptAt: outbox?.nextAttemptAt ?? null,
      lastError: outbox?.lastError ?? null,
      can: { aiIntake: ctx.permissions.has('plans.manage') },
      isOwner: ctx.actor.memberships.some((m) => m.restaurantId === restaurantId && m.role === 'OWNER'),
    };
  },
});
