import { publishMenu } from '@/server/publish/publish';
import { expireMenu } from '@/server/data/cache';
import type { ActionContext } from '@/server/studio/framework/action';
import { menuSlugs } from '@/server/studio/services/menus';
import { catalogMenuOf } from './catalog-menu';

/**
 * Runs a cashier's edit of the product list, then republishes the catalog menu so guests see it. The till reads the
 * draft and guests read the live revision, so without this an edit at the till would wait for a publish in the Studio.
 *
 * Only a menu that is already live is republished: a till-only catalog menu stays a draft and nothing becomes public by
 * accident. A blocked or failed publish never fails the edit, which is already saved: it is written to the audit log.
 * The publish carries whatever else is in the draft.
 */
export async function publishAfter<T>(ctx: ActionContext, edit: () => Promise<T>): Promise<T> {
  const result = await edit();
  const restaurantId = ctx.restaurantId;
  if (restaurantId === null) return result;
  const menu = await catalogMenuOf(ctx.db, restaurantId);
  if (!menu) return result;
  const live = await ctx.db.menu.findFirst({ where: { id: menu.id, restaurantId }, select: { liveRevisionId: true } });
  if (!live?.liveRevisionId) return result;

  let reason: string | null = null;
  try {
    await ctx.transactionIn({ restaurantId, menuId: menu.id }, async (tx) => {
      const outcome = await publishMenu(tx, { menuId: menu.id, actorId: ctx.actor.userId, note: 'Edited at the till', now: new Date() });
      if (!outcome.ok) throw new Error('blocked');
      const slugs = await menuSlugs(tx, menu.id);
      ctx.afterCommit(() => expireMenu(slugs, menu.id));
    });
  } catch (error) {
    reason = error instanceof Error ? error.message : 'failed';
  }
  if (reason !== null) {
    ctx.audit({ action: 'pos.catalog.publish_skipped', entityType: 'Menu', entityId: menu.id, changes: { reason: { before: null, after: reason } } });
    await ctx.transactionIn({ restaurantId, menuId: menu.id }, async () => undefined);
  }
  return result;
}
