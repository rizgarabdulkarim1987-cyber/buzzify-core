import { z } from 'zod';
import { LOCALES } from '@/lib/locale';
import { loadOverlay } from '@/server/data/live';
import { buildMenuView, type MenuView } from '@/server/data/menu-view';
import { tenantInfo } from '@/server/data/public-menu';
import type { TenantInfo } from '@/server/data/tenant';
import { allows } from '@/server/domain/entitlements';
import { servedCatalog } from '@/server/domain/plan-choices';
import { parseSnapshot, toCatalog } from '@/server/domain/snapshot';
import { pendingSchedule } from '@/server/publish/revisions';
import { defineQuery, type QueryContext } from '@/server/studio/framework/query';
import { StudioError } from '@/server/studio/framework/result';
import { idField } from '@/server/studio/services/content';
import { upgradeInfo } from '@/server/studio/services/plans';

/** What the Revisions tab reads: the menu's revisions, newest first, and one revision as guests saw it. */

const atMenu = (menuId: string) => ({ kind: 'menu', menuId }) as const;
const PAGE_SIZE = 50;

function menuOf(ctx: QueryContext): string {
  if (ctx.menuId === null) throw new Error('A menu query ran without a menu');
  return ctx.menuId;
}

type RevisionState = 'live' | 'past' | 'scheduled' | 'cancelled';

export const list = defineQuery({
  name: 'revisions.list',
  permission: 'view',
  input: z.object({ menuId: idField, page: z.number().int().min(1).max(100_000).default(1) }),
  target: (i) => atMenu(i.menuId),
  run: async (ctx, { page }) => {
    const menuId = menuOf(ctx);
    const menu = await ctx.db.menu.findUnique({ where: { id: menuId }, select: { liveRevisionId: true, timezone: true, draftHash: true } });
    if (!menu) throw new StudioError('NOT_FOUND');
    const [rows, total] = await Promise.all([
      ctx.db.menuRevision.findMany({
        where: { menuId },
        orderBy: { number: 'desc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        select: { id: true, number: true, createdAt: true, createdById: true, note: true, goLiveAt: true, wentLiveAt: true, cancelledAt: true },
      }),
      ctx.db.menuRevision.count({ where: { menuId } }),
    ]);
    const authorIds = [...new Set(rows.flatMap((row) => (row.createdById ? [row.createdById] : [])))];
    const authors = new Map((await ctx.db.user.findMany({ where: { id: { in: authorIds } }, select: { id: true, name: true } })).map((user) => [user.id, user.name]));
    const state = (row: (typeof rows)[number]): RevisionState => {
      if (row.id === menu.liveRevisionId) return 'live';
      if (row.cancelledAt) return 'cancelled';
      if (row.goLiveAt && !row.wentLiveAt) return 'scheduled';
      return 'past';
    };
    return {
      rows: rows.map((row) => ({
        id: row.id,
        number: row.number,
        state: state(row),
        createdAt: row.createdAt.toISOString(),
        createdBy: row.createdById ? (authors.get(row.createdById) ?? null) : null,
        note: row.note,
        goLiveAt: row.goLiveAt?.toISOString() ?? null,
        wentLiveAt: row.wentLiveAt?.toISOString() ?? null,
        cancelledAt: row.cancelledAt?.toISOString() ?? null,
      })),
      pending: await pendingSchedule(ctx.db, menuId),
      total,
      timezone: menu.timezone,
      /** The draft as the page was read, for a restore to apply only to it. */
      draftHash: menu.draftHash,
      /** Whether "Schedule" works here: the person may schedule and the restaurant's plan includes it. */
      canSchedule: ctx.permissions.has('publish.schedule') && ctx.plan !== null && allows(ctx.plan.entitlements, 'publish.scheduling'),
      upgrade: await upgradeInfo(ctx.db, ctx),
    };
  },
});

export const view = defineQuery({
  name: 'revisions.view',
  permission: 'view',
  input: z.object({ menuId: idField, revisionId: idField, locale: z.enum(LOCALES) }),
  target: (i) => atMenu(i.menuId),
  run: async (ctx, { revisionId, locale }): Promise<{ number: number; tenant: TenantInfo; view: MenuView }> => {
    const menuId = menuOf(ctx);
    const menu = await ctx.db.menu.findUnique({ where: { id: menuId }, select: { id: true, slug: true, restaurantId: true } });
    const revision = await ctx.db.menuRevision.findFirst({ where: { id: revisionId, menuId }, select: { id: true, number: true, snapshot: true } });
    if (!menu || !revision) throw new StudioError('NOT_FOUND');
    const snapshot = parseSnapshot(revision.snapshot);
    if (!snapshot.menu.locales.includes(locale)) throw new StudioError('NOT_FOUND');
    // Today's live switches over the revision: what guests would get if the menu went back to it now.
    if (ctx.plan === null) throw new Error('A menu query ran without a menu');
    const tenant = tenantInfo(menu, revision.id, snapshot, ctx.plan.entitlements);
    const catalog = servedCatalog(toCatalog(menu.id, snapshot, await loadOverlay(ctx.db, menu.id)), tenant.features);
    return { number: revision.number, tenant, view: buildMenuView(catalog, tenant, locale, new Date()) };
  },
});
