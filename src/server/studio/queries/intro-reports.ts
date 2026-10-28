import { z } from 'zod';
import { clickRate, validRange } from '@/server/domain/intro-report';
import { defineQuery } from '@/server/studio/framework/query';
import { StudioError } from '@/server/studio/framework/result';

interface Counts {
  views: number;
  clicks: number;
}

const add = (map: Map<string, Counts>, key: string, views: number, clicks: number) => {
  const row = map.get(key) ?? { views: 0, clicks: 0 };
  row.views += views;
  row.clicks += clicks;
  map.set(key, row);
};

const byViews = <T extends Counts>(rows: T[]) => rows.sort((x, y) => y.views - x.views || y.clicks - x.clicks);

/**
 * How the platform's intro adverts did between two days (UTC, inclusive): the totals, each advert, each restaurant and menu that showed
 * them, and each day. Super Admin only; owners never see the numbers. Counts hold no person, only advert, menu and day.
 */
export const introReports = defineQuery({
  name: 'platform.introReports',
  permission: 'platform.settings',
  input: z.object({ from: z.string().max(10), to: z.string().max(10) }),
  target: () => ({ kind: 'platform' }) as const,
  run: async (ctx, { from, to }) => {
    if (!validRange(from, to)) throw new StudioError('INVALID', 'Choose a range of up to a year, oldest day first');
    const rows = await ctx.db.platformAdvertDaily.findMany({ where: { day: { gte: from, lte: to } } });

    const adverts = new Map<string, Counts>();
    const restaurants = new Map<string, Counts>();
    const menus = new Map<string, Counts>();
    const days = new Map<string, Counts>();
    let views = 0;
    let clicks = 0;
    for (const row of rows) {
      views += row.views;
      clicks += row.clicks;
      add(adverts, row.advertId, row.views, row.clicks);
      add(restaurants, row.shownRestaurantId, row.views, row.clicks);
      add(menus, row.shownMenuId, row.views, row.clicks);
      add(days, row.day, row.views, row.clicks);
    }

    const [advertRows, restaurantRows, menuRows] = await Promise.all([
      ctx.db.platformAdvert.findMany({ where: { id: { in: [...adverts.keys()] } }, select: { id: true, alts: true, href: true, active: true } }),
      ctx.db.restaurant.findMany({ where: { id: { in: [...restaurants.keys()] } }, select: { id: true, name: true } }),
      ctx.db.menu.findMany({ where: { id: { in: [...menus.keys()] } }, select: { id: true, name: true, restaurantId: true } }),
    ]);
    const advertById = new Map(advertRows.map((row) => [row.id, row]));
    const restaurantName = new Map(restaurantRows.map((row) => [row.id, row.name]));
    const menuById = new Map(menuRows.map((row) => [row.id, row]));
    const labelOf = (alts: unknown, href: string) => {
      const en = typeof alts === 'object' && alts !== null ? (alts as Record<string, unknown>).en : undefined;
      return typeof en === 'string' && en.trim() ? en.trim() : href;
    };

    return {
      from,
      to,
      totals: { views, clicks, rate: clickRate(clicks, views) },
      adverts: byViews(
        [...adverts].map(([id, counts]) => {
          const advert = advertById.get(id);
          return { advertId: id, label: advert ? labelOf(advert.alts, advert.href) : '', removed: !advert, active: advert?.active ?? false, ...counts, rate: clickRate(counts.clicks, counts.views) };
        }),
      ),
      restaurants: byViews([...restaurants].map(([id, counts]) => ({ restaurantId: id, name: restaurantName.get(id) ?? '', ...counts, rate: clickRate(counts.clicks, counts.views) }))),
      menus: byViews(
        [...menus].map(([id, counts]) => {
          const menu = menuById.get(id);
          return { menuId: id, name: menu?.name ?? '', restaurant: menu ? (restaurantName.get(menu.restaurantId) ?? '') : '', ...counts, rate: clickRate(counts.clicks, counts.views) };
        }),
      ),
      days: [...days].map(([day, counts]) => ({ day, ...counts })).sort((x, y) => x.day.localeCompare(y.day)),
    };
  },
});
