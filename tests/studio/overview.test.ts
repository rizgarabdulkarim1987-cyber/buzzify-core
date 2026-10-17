import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPrisma } from '@/server/data/prisma';
import { refreshDraftHash } from '@/server/publish/draft';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { runQuery, type QueryDef } from '@/server/studio/framework/query';
import type { ActionResult } from '@/server/studio/framework/result';
import * as overviewQueries from '@/server/studio/queries/overview';
import { isOwnerOnly, landingPath, visibleNav } from '@/studio/nav';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { createMenuFixture, requireTestDb, resetTestData } from '../helpers/db';

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };
const prisma = () => getPrisma();

const dataOf = <T>(result: ActionResult<T>): T => {
  if (!result.ok) throw new Error(`expected success, got ${JSON.stringify(result.error)}`);
  return result.data;
};

let admin: Actor;
let designer: Actor;
let owner: Actor;
let atelier: { id: string };
let bistro: { id: string };
let archivedPlace: { id: string };

async function person(id: string, name: string, memberships: Array<[string, 'DESIGNER' | 'OWNER']> = [], superAdmin = false): Promise<Actor> {
  await prisma().user.create({ data: { id, name, email: `${id}@example.com`, isSuperAdmin: superAdmin, twoFactorEnabled: superAdmin } });
  for (const [restaurantId, role] of memberships) await prisma().membership.create({ data: { userId: id, restaurantId, role } });
  return (await loadActor(prisma(), id)) as Actor;
}

const ask = <I, O>(actor: Actor, def: QueryDef<I, O>, input: unknown = {}) => runQuery(prisma(), actor, def, input);

/** A menu (one product) moved under `restaurantId`, published unless `publish` is false. */
async function menuIn(restaurantId: string, slug: string, options: { publish?: boolean } = {}) {
  const fixture = await createMenuFixture(prisma(), slug, options);
  await prisma().menu.update({ where: { id: fixture.menu.id }, data: { restaurantId } });
  await prisma().restaurant.delete({ where: { id: fixture.restaurant.id } });
  return fixture.menu;
}

/** An edit to the draft, after which it differs from what is live. */
async function editDraft(menuId: string, slug = 'latte') {
  const category = await prisma().category.findFirstOrThrow({ where: { menuId } });
  await prisma().product.create({ data: { menuId, categoryId: category.id, slug, basePrice: 450, translations: { en: { name: slug } } } });
  await refreshDraftHash(prisma(), menuId);
}

const view = (menuId: string, occurredAt: Date, type: 'MENU_VIEW' | 'PRODUCT_VIEW' = 'MENU_VIEW') =>
  prisma().analyticsEvent.create({ data: { menuId, anonymousSessionId: 'guest', type, occurredAt } });

const DAY = 24 * 60 * 60 * 1000;

beforeAll(async () => {
  requireTestDb();
  vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
  await resetTestData(prisma());
});

beforeEach(async () => {
  await resetTestData(prisma());
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  atelier = await prisma().restaurant.create({ data: { name: 'Atelier' } });
  bistro = await prisma().restaurant.create({ data: { name: 'Bistro' } });
  archivedPlace = await prisma().restaurant.create({ data: { name: 'Old Cafe', status: 'ARCHIVED' } });
  await prisma().restaurant.create({ data: { name: 'Pause', status: 'SUSPENDED' } });
  admin = await person('admin', 'Sam Admin', [], true);
  designer = await person('dee', 'Dee Designer', [[atelier.id, 'DESIGNER']]);
  owner = await person('olive', 'Olive Owner', [[atelier.id, 'OWNER']]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await resetTestData(prisma());
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
  vi.unstubAllEnvs();
});

describe('overview', () => {
  it('counts restaurants and menus by status, within the reader scope', async () => {
    await menuIn(atelier.id, 'ov-live');
    await menuIn(atelier.id, 'ov-draft', { publish: false });
    const bistroMenu = await menuIn(bistro.id, 'ov-bistro');
    await prisma().menu.update({ where: { id: bistroMenu.id }, data: { status: 'SUSPENDED' } });
    const gone = await menuIn(archivedPlace.id, 'ov-old');
    await prisma().menu.update({ where: { id: gone.id }, data: { status: 'ARCHIVED' } });

    const all = dataOf(await ask(admin, overviewQueries.overview));
    expect(all.restaurants).toEqual({ ACTIVE: 2, SUSPENDED: 1, ARCHIVED: 1 });
    expect(all.menus).toEqual({ DRAFT: 1, PUBLISHED: 1, SUSPENDED: 1, ARCHIVED: 1 });

    // A designer counts only what their restaurants hold.
    const mine = dataOf(await ask(designer, overviewQueries.overview));
    expect(mine.restaurants).toEqual({ ACTIVE: 1, SUSPENDED: 0, ARCHIVED: 0 });
    expect(mine.menus).toEqual({ DRAFT: 1, PUBLISHED: 1, SUSPENDED: 0, ARCHIVED: 0 });

    // Somebody in no restaurant counts nothing.
    const nobody = await person('nia', 'Nia Newcomer');
    const none = dataOf(await ask(nobody, overviewQueries.overview));
    expect(none.restaurants).toEqual({ ACTIVE: 0, SUSPENDED: 0, ARCHIVED: 0 });
    expect(none.menus).toEqual({ DRAFT: 0, PUBLISHED: 0, SUSPENDED: 0, ARCHIVED: 0 });
    expect(none.unpublished).toEqual([]);
    expect(none.viewsLast7Days).toBe(0);
  });

  it('lists the menus with unpublished changes within the scope, newest change first, at most 10', async () => {
    const clean = await menuIn(atelier.id, 'ov-clean');
    const edited = await menuIn(atelier.id, 'ov-edited');
    const never = await menuIn(atelier.id, 'ov-never', { publish: false });
    const elsewhere = await menuIn(bistro.id, 'ov-elsewhere');
    const archived = await menuIn(atelier.id, 'ov-archived');
    await editDraft(edited.id);
    await editDraft(elsewhere.id);
    await editDraft(archived.id);
    await prisma().menu.update({ where: { id: archived.id }, data: { status: 'ARCHIVED' } });

    const mine = dataOf(await ask(designer, overviewQueries.overview));
    expect(mine.unpublished.map((entry) => entry.menuId)).toEqual([edited.id]);
    expect(mine.unpublished[0]).toMatchObject({ name: edited.name, restaurantName: 'Atelier' });
    expect(Date.parse(mine.unpublished[0]!.updatedAt)).toBeGreaterThan(0);
    expect(mine.unpublished.map((entry) => entry.menuId)).not.toContain(clean.id);
    expect(mine.unpublished.map((entry) => entry.menuId)).not.toContain(never.id);

    expect(dataOf(await ask(admin, overviewQueries.overview)).unpublished.map((entry) => entry.menuId).sort()).toEqual(
      [edited.id, elsewhere.id].sort(),
    );

    const ids: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      const menu = await menuIn(bistro.id, `ov-many-${i}`);
      await editDraft(menu.id);
      await prisma().menu.update({ where: { id: menu.id }, data: { updatedAt: new Date(Date.UTC(2026, 0, 1 + i)) } });
      ids.push(menu.id);
    }
    const page = dataOf(await ask(admin, overviewQueries.overview)).unpublished;
    expect(page).toHaveLength(10);
    // The two menus edited just now come first (the later edit first), then the others by their dates, newest first.
    expect(page.slice(0, 2).map((entry) => entry.menuId)).toEqual([elsewhere.id, edited.id]);
    expect(page.slice(2).map((entry) => entry.menuId)).toEqual([...ids].reverse().slice(0, 8));
  });

  it('lists the pending schedules within the scope, soonest first', async () => {
    const mine = await menuIn(atelier.id, 'ov-sched-mine');
    const theirs = await menuIn(bistro.id, 'ov-sched-theirs');
    const soon = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const later = new Date(Date.now() + 5 * 60 * 60 * 1000);
    const pending = (menuId: string, number: number, goLiveAt: Date) =>
      prisma().menuRevision.create({ data: { menuId, number, schemaVersion: 1, snapshot: {}, snapshotHash: 'h', goLiveAt } });
    await pending(mine.id, 2, later);
    await pending(theirs.id, 2, soon);
    await prisma().menuRevision.create({ data: { menuId: mine.id, number: 3, schemaVersion: 1, snapshot: {}, snapshotHash: 'h', goLiveAt: soon, cancelledAt: new Date() } });

    const own = dataOf(await ask(designer, overviewQueries.overview)).scheduled;
    expect(own).toEqual([{ menuId: mine.id, menuName: mine.name, restaurantName: 'Atelier', number: 2, goLiveAt: later.toISOString() }]);
    expect(dataOf(await ask(admin, overviewQueries.overview)).scheduled.map((entry) => entry.menuId)).toEqual([theirs.id, mine.id]);
  });

  it('counts menu views of the last 7 days in the reader scope, and nothing else', async () => {
    const mine = await menuIn(atelier.id, 'ov-views-mine');
    const theirs = await menuIn(bistro.id, 'ov-views-theirs');
    const now = Date.now();
    await view(mine.id, new Date(now - 1 * DAY));
    await view(mine.id, new Date(now - 6 * DAY));
    await view(mine.id, new Date(now - 8 * DAY));
    await view(mine.id, new Date(now - 1 * DAY), 'PRODUCT_VIEW');
    await view(theirs.id, new Date(now - 2 * DAY));

    expect(dataOf(await ask(designer, overviewQueries.overview)).viewsLast7Days).toBe(2);
    expect(dataOf(await ask(admin, overviewQueries.overview)).viewsLast7Days).toBe(3);
  });

  it('shows recent activity to a reader who may read the audit log, and null to everyone else', async () => {
    const menu = await menuIn(atelier.id, 'ov-activity');
    await prisma().auditLog.createMany({
      data: Array.from({ length: 12 }, (_, i) => ({
        actorId: i % 2 === 1 ? admin.userId : null,
        restaurantId: atelier.id,
        menuId: menu.id,
        action: 'menu.published',
        entityType: 'Menu',
        entityId: menu.id,
        occurredAt: new Date(Date.UTC(2026, 5, 1, 12, i)),
      })),
    });

    const recent = dataOf(await ask(admin, overviewQueries.overview)).recentActivity;
    expect(recent).toHaveLength(10);
    expect(recent![0]).toMatchObject({
      action: 'menu.published',
      actor: { id: admin.userId, name: 'Sam Admin' },
      restaurant: { id: atelier.id, name: 'Atelier' },
      menu: { id: menu.id, name: menu.name },
      occurredAt: new Date(Date.UTC(2026, 5, 1, 12, 11)).toISOString(),
    });
    // Newest first.
    expect(recent!.map((row) => row.occurredAt)).toEqual([...recent!.map((row) => row.occurredAt)].sort().reverse());

    expect(dataOf(await ask(designer, overviewQueries.overview)).recentActivity).toBeNull();
    expect(dataOf(await ask(owner, overviewQueries.overview)).recentActivity).toBeNull();
  });
});

describe('where an owner lands', () => {
  it('is their only menu, else their restaurant menus, and nowhere for anyone who is not only an owner', async () => {
    const menu = await menuIn(atelier.id, 'land-only');
    const only = [{ id: atelier.id, name: 'Atelier', menuIds: [menu.id] }];

    expect(isOwnerOnly(owner)).toBe(true);
    expect(landingPath(owner, only)).toBe(`/studio/menus/${menu.id}`);
    // The nav item an owner sees points at the same place.
    expect(visibleNav(owner, only)[0]!.href).toBe(landingPath(owner, only));

    const second = await menuIn(atelier.id, 'land-second');
    const several = [{ id: atelier.id, name: 'Atelier', menuIds: [menu.id, second.id] }];
    expect(landingPath(owner, several)).toBe(`/studio/restaurants/${atelier.id}/menus`);
    expect(landingPath(owner, [{ id: atelier.id, name: 'Atelier', menuIds: [] }])).toBe(`/studio/restaurants/${atelier.id}/menus`);

    // Two restaurants have no single landing page: the Overview lists them.
    const other = await person('otto', 'Otto Owner', [[atelier.id, 'OWNER'], [bistro.id, 'OWNER']]);
    expect(landingPath(other, [])).toBeNull();

    expect(landingPath(designer, only)).toBeNull();
    expect(landingPath(admin, [])).toBeNull();
  });
});
