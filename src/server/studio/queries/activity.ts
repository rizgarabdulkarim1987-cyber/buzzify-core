import { defineQuery } from '@/server/studio/framework/query';
import { ACTIVITY_PAGE_SIZE, activityFilters, listActivityRows, type Named } from '@/server/studio/services/activity';

/**
 * The audit log, for the people who may read it (`audit.view`: Super Admins; no client policy can grant it). Rows show
 * who did what, to what, where and when, never what the change held.
 */

export const listActivity = defineQuery({
  name: 'activity.list',
  permission: 'audit.view',
  input: activityFilters,
  target: () => ({ kind: 'platform' }),
  run: async (ctx, input) => {
    const [{ total, rows }, actor, restaurant, menu] = await Promise.all([
      listActivityRows(ctx.db, input),
      input.actorId ? ctx.db.user.findUnique({ where: { id: input.actorId }, select: { id: true, name: true } }) : null,
      input.restaurantId ? ctx.db.restaurant.findUnique({ where: { id: input.restaurantId }, select: { id: true, name: true } }) : null,
      input.menuId ? ctx.db.menu.findUnique({ where: { id: input.menuId }, select: { id: true, name: true } }) : null,
    ]);
    // What the filters name, so the page can show it beside the control that holds it (an id alone says nothing).
    const named = (id: string | undefined, found: Named | null): Named | null => (id ? (found ?? { id, name: null }) : null);
    return {
      rows,
      total,
      page: input.page,
      pageSize: ACTIVITY_PAGE_SIZE,
      selected: { actor: named(input.actorId, actor), restaurant: named(input.restaurantId, restaurant), menu: named(input.menuId, menu) },
    };
  },
});
