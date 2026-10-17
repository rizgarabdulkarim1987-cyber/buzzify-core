import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import { MENU_STATUSES, type MenuStatus } from '@/server/domain/menu-status';
import { RESTAURANT_STATUSES, type RestaurantStatus } from '@/server/domain/restaurant-profile';
import type { ActorScope } from '@/server/studio/framework/query';
import { recentActivityRows, type AuditRow } from './activity';

/**
 * What the Overview counts, within the reader's restaurants: restaurants and menus by status, menus whose draft differs
 * from what guests see, menu views of the last 7 days, and (for those who may read the audit log) the newest activity.
 */

export const UNPUBLISHED_LIMIT = 10;
export const RECENT_ACTIVITY_LIMIT = 10;
const DAY_MS = 24 * 60 * 60 * 1000;
const SCHEDULED_LIMIT = 10;

export interface UnpublishedMenu {
  menuId: string;
  name: string;
  restaurantName: string;
  updatedAt: string;
}

/** A revision waiting to go live. */
export interface ScheduledRevision {
  menuId: string;
  menuName: string;
  restaurantName: string;
  number: number;
  goLiveAt: string;
}

export interface OverviewData {
  restaurants: Record<RestaurantStatus, number>;
  menus: Record<MenuStatus, number>;
  /** The menus with changes guests do not see yet, the most recently changed first. */
  unpublished: UnpublishedMenu[];
  /** The next revisions to go live by schedule, soonest first. */
  scheduled: ScheduledRevision[];
  /** Menu views (`MENU_VIEW` events) in the last 7 days. */
  viewsLast7Days: number;
  /** The newest audit rows; null for a reader who may not read the audit log. */
  recentActivity: AuditRow[] | null;
}

function zeroed<K extends string>(keys: readonly K[]): Record<K, number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>;
}

export async function loadOverview(db: PrismaClient, scope: ActorScope, options: { activity: boolean; now?: Date }): Promise<OverviewData> {
  const restaurantWhere: Prisma.RestaurantWhereInput = scope.kind === 'all' ? {} : { id: { in: scope.ids } };
  const menuWhere: Prisma.MenuWhereInput = scope.kind === 'all' ? {} : { restaurantId: { in: scope.ids } };
  const since = new Date((options.now ?? new Date()).getTime() - 7 * DAY_MS);

  const [restaurantCounts, menuCounts, unpublished, scheduled, views, recentActivity] = await Promise.all([
    db.restaurant.groupBy({ by: ['status'], where: restaurantWhere, _count: { _all: true } }),
    db.menu.groupBy({ by: ['status'], where: menuWhere, _count: { _all: true } }),
    // The draft's hash differs from the live one (a menu never published has no live hash, and nothing to differ from).
    db.menu.findMany({
      where: { AND: [menuWhere, { status: { not: 'ARCHIVED' } }, { liveHash: { not: null }, draftHash: { not: { equals: db.menu.fields.liveHash } } }] },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      take: UNPUBLISHED_LIMIT,
      select: { id: true, name: true, updatedAt: true, restaurant: { select: { name: true } } },
    }),
    db.menuRevision.findMany({
      where: { menu: { AND: [menuWhere, { status: { not: 'ARCHIVED' } }] }, goLiveAt: { not: null }, wentLiveAt: null, cancelledAt: null },
      orderBy: [{ goLiveAt: 'asc' }, { id: 'asc' }],
      take: SCHEDULED_LIMIT,
      select: { number: true, goLiveAt: true, menu: { select: { id: true, name: true, restaurant: { select: { name: true } } } } },
    }),
    db.analyticsEvent.count({ where: { type: 'MENU_VIEW', occurredAt: { gte: since }, menu: menuWhere } }),
    options.activity ? recentActivityRows(db, RECENT_ACTIVITY_LIMIT) : null,
  ]);

  const restaurants = zeroed(RESTAURANT_STATUSES);
  for (const row of restaurantCounts) restaurants[row.status] = row._count._all;
  const menus = zeroed(MENU_STATUSES);
  for (const row of menuCounts) menus[row.status] = row._count._all;

  return {
    restaurants,
    menus,
    unpublished: unpublished.map((menu) => ({
      menuId: menu.id,
      name: menu.name,
      restaurantName: menu.restaurant.name,
      updatedAt: menu.updatedAt.toISOString(),
    })),
    scheduled: scheduled.map((revision) => ({
      menuId: revision.menu.id,
      menuName: revision.menu.name,
      restaurantName: revision.menu.restaurant.name,
      number: revision.number,
      goLiveAt: revision.goLiveAt!.toISOString(),
    })),
    viewsLast7Days: views,
    recentActivity,
  };
}
