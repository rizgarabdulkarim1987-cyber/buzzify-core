import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPrisma } from '@/server/data/prisma';
import { formatClientId } from '@/server/domain/restaurant-profile';
import * as menuActions from '@/server/studio/actions/menus';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { runAction } from '@/server/studio/framework/action';
import { runQuery, type QueryDef } from '@/server/studio/framework/query';
import type { ActionResult } from '@/server/studio/framework/result';
import * as search from '@/server/studio/queries/search';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { createMenuFixture, requireTestDb, resetTestData } from '../helpers/db';

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };
const prisma = () => getPrisma();

const dataOf = <T>(result: ActionResult<T>): T => {
  if (!result.ok) throw new Error(`expected success, got ${JSON.stringify(result.error)}`);
  return result.data;
};
const codeOf = (result: ActionResult<unknown>) => (result.ok ? 'OK' : result.error.code);

let admin: Actor;
let designer: Actor;
let owner: Actor;
let atelier: { id: string; clientNumber: number };
let bistro: { id: string; clientNumber: number };
let mazo: { id: string; clientNumber: number };

async function person(id: string, name: string, memberships: Array<[string, 'DESIGNER' | 'OWNER']> = [], superAdmin = false): Promise<Actor> {
  await prisma().user.create({ data: { id, name, email: `${id}@example.com`, isSuperAdmin: superAdmin, twoFactorEnabled: superAdmin } });
  for (const [restaurantId, role] of memberships) await prisma().membership.create({ data: { userId: id, restaurantId, role } });
  return (await loadActor(prisma(), id)) as Actor;
}

const ask = <I, O>(actor: Actor, def: QueryDef<I, O>, input: unknown = {}) => runQuery(prisma(), actor, def, input);
const jump = async (actor: Actor, q: string) => dataOf(await ask(actor, search.jump, { q }));

/** A menu (one product) moved under `restaurantId`. */
async function menuIn(restaurantId: string, slug: string, name = `Menu ${slug}`) {
  const fixture = await createMenuFixture(prisma(), slug);
  await prisma().menu.update({ where: { id: fixture.menu.id }, data: { restaurantId, name } });
  await prisma().restaurant.delete({ where: { id: fixture.restaurant.id } });
  return prisma().menu.findUniqueOrThrow({ where: { id: fixture.menu.id } });
}

beforeAll(async () => {
  requireTestDb();
  vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
  await resetTestData(prisma());
});

beforeEach(async () => {
  await resetTestData(prisma());
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  atelier = await prisma().restaurant.create({ data: { name: 'ATELIER', city: 'Erbil' }, select: { id: true, clientNumber: true } });
  bistro = await prisma().restaurant.create({ data: { name: 'Bistro Noir', city: 'Duhok' }, select: { id: true, clientNumber: true } });
  mazo = await prisma().restaurant.create({ data: { name: 'مطعم مازو', city: 'السليمانية' }, select: { id: true, clientNumber: true } });
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

describe('jump', () => {
  it('finds a restaurant by client ID, however it is typed', async () => {
    for (const typed of [formatClientId(bistro.clientNumber), formatClientId(bistro.clientNumber).toLowerCase(), `bz${bistro.clientNumber}`, `BZ ${bistro.clientNumber}`]) {
      const found = await jump(admin, typed);
      expect(found.restaurants, typed).toEqual([
        { id: bistro.id, name: 'Bistro Noir', clientId: formatClientId(bistro.clientNumber), city: 'Duhok' },
      ]);
    }
  });

  it('finds the restaurant and the menu of "atel", whatever the case', async () => {
    const menu = await menuIn(atelier.id, 'atelier', 'Dinner');
    await menuIn(bistro.id, 'noir-lunch', 'Lunch');
    for (const typed of ['atel', 'ATEL', 'Atelier']) {
      const found = await jump(admin, typed);
      expect(found.restaurants.map((row) => row.name), typed).toEqual(['ATELIER']);
      expect(found.menus, typed).toEqual([{ id: menu.id, name: 'Dinner', slug: 'atelier', restaurantName: 'ATELIER', status: 'PUBLISHED' }]);
    }
  });

  it('finds menus by name, address, former address, restaurant name and restaurant client ID', async () => {
    const dinner = await menuIn(bistro.id, 'noir-dinner', 'Chef tasting');
    const renamed = await menuIn(bistro.id, 'old-address', 'Brunch');
    const changed = await runAction(prisma(), admin, menuActions.changeMenuSlug, { menuId: renamed.id, slug: 'new-address', version: renamed.version }, { ip: '', userAgent: '' });
    dataOf(changed);

    const ids = async (q: string) => (await jump(admin, q)).menus.map((row) => row.id).sort();
    expect(await ids('tasting')).toEqual([dinner.id]);
    expect(await ids('noir-dinn')).toEqual([dinner.id]);
    expect(await ids('old-addr')).toEqual([renamed.id]);
    expect(await ids('new-addr')).toEqual([renamed.id]);
    expect(await ids('bistro')).toEqual([dinner.id, renamed.id].sort());
    expect(await ids(`bz-${String(bistro.clientNumber).padStart(4, '0')}`)).toEqual([dinner.id, renamed.id].sort());
  });

  it('finds an Arabic-named restaurant by a word inside its name', async () => {
    const found = await jump(admin, 'مازو');
    expect(found.restaurants).toEqual([{ id: mazo.id, name: 'مطعم مازو', clientId: formatClientId(mazo.clientNumber), city: 'السليمانية' }]);
    // Its city too, and a partial word.
    expect((await jump(admin, 'سليم')).restaurants.map((row) => row.id)).toEqual([mazo.id]);
    expect((await jump(admin, 'مطعم')).restaurants.map((row) => row.id)).toEqual([mazo.id]);
    // And its menus, through the restaurant's name.
    const menu = await menuIn(mazo.id, 'mazo-menu', 'قائمة العشاء');
    expect((await jump(admin, 'مازو')).menus.map((row) => row.id)).toEqual([menu.id]);
    expect((await jump(admin, 'العشاء')).menus.map((row) => row.id)).toEqual([menu.id]);
  });

  it('treats % and _ as the characters they are', async () => {
    expect((await jump(admin, '%')).restaurants).toEqual([]);
    expect((await jump(admin, '_telier')).restaurants).toEqual([]);
    await prisma().restaurant.create({ data: { name: '100% Vegan' } });
    expect((await jump(admin, '%')).restaurants.map((row) => row.name)).toEqual(['100% Vegan']);
  });

  it('shows at most 8 restaurants and 8 menus', async () => {
    for (let i = 0; i < 10; i += 1) {
      const place = await prisma().restaurant.create({ data: { name: `Many ${String(i).padStart(2, '0')}` } });
      await menuIn(place.id, `many-menu-${i}`, `Many menu ${String(i).padStart(2, '0')}`);
    }
    const found = await jump(admin, 'many');
    expect(found.restaurants.map((row) => row.name)).toEqual(Array.from({ length: 8 }, (_, i) => `Many ${String(i).padStart(2, '0')}`));
    expect(found.menus).toHaveLength(8);
  });

  it('finds only what is within the reader scope', async () => {
    await menuIn(atelier.id, 'atelier-own', 'Atelier menu');
    await menuIn(bistro.id, 'bistro-own', 'Bistro menu');
    for (const actor of [designer, owner]) {
      expect((await jump(actor, 'bistro')).restaurants).toEqual([]);
      expect((await jump(actor, 'bistro')).menus).toEqual([]);
      expect((await jump(actor, 'atelier')).restaurants.map((row) => row.id)).toEqual([atelier.id]);
      expect((await jump(actor, 'atelier')).menus.map((row) => row.slug)).toEqual(['atelier-own']);
      expect((await jump(actor, formatClientId(bistro.clientNumber))).restaurants).toEqual([]);
      expect((await jump(actor, 'مازو')).restaurants).toEqual([]);
    }
  });

  it('takes 1 to 80 characters and a signed-in reader', async () => {
    expect(codeOf(await ask(admin, search.jump, { q: '' }))).toBe('INVALID');
    expect(codeOf(await ask(admin, search.jump, { q: '   ' }))).toBe('INVALID');
    expect(codeOf(await ask(admin, search.jump, { q: 'x'.repeat(81) }))).toBe('INVALID');
    expect(codeOf(await ask(admin, search.jump, {}))).toBe('INVALID');
    expect(codeOf(await ask(admin, search.jump, { q: 'x'.repeat(80) }))).toBe('OK');
    expect(codeOf(await ask(admin, search.jump, { q: '  x  ' }))).toBe('OK');
    expect(codeOf(await runQuery(prisma(), null, search.jump, { q: 'atel' }))).toBe('UNAUTHENTICATED');
  });
});

describe('the pickers', () => {
  it('list at most 20 restaurants, narrowed by what is typed', async () => {
    for (let i = 0; i < 24; i += 1) await prisma().restaurant.create({ data: { name: `Pick ${String(i).padStart(2, '0')}` } });
    const first = dataOf(await ask(admin, search.searchRestaurants, {})).rows;
    expect(first).toHaveLength(20);
    const narrowed = dataOf(await ask(admin, search.searchRestaurants, { q: 'pick 2' })).rows;
    expect(narrowed.map((row) => row.name)).toEqual(['Pick 20', 'Pick 21', 'Pick 22', 'Pick 23']);
    expect(dataOf(await ask(admin, search.searchRestaurants, { q: formatClientId(mazo.clientNumber) })).rows.map((row) => row.id)).toEqual([mazo.id]);
    // Within scope, as everything else.
    expect(dataOf(await ask(designer, search.searchRestaurants, {})).rows.map((row) => row.id)).toEqual([atelier.id]);
  });

  it('list menus and people the same way, people for Super Admins only', async () => {
    const menu = await menuIn(atelier.id, 'pick-menu', 'Picked');
    expect(dataOf(await ask(admin, search.searchMenus, { q: 'picked' })).rows.map((row) => row.id)).toEqual([menu.id]);
    expect(dataOf(await ask(designer, search.searchMenus, { q: 'picked' })).rows.map((row) => row.id)).toEqual([menu.id]);
    expect(dataOf(await ask(admin, search.searchPeople, { q: 'dee' })).rows).toEqual([{ id: 'dee', name: 'Dee Designer', email: 'dee@example.com' }]);
    expect(dataOf(await ask(admin, search.searchPeople, { q: 'EXAMPLE.COM' })).rows).toHaveLength(3);
    expect(codeOf(await ask(designer, search.searchPeople, { q: 'sam' }))).toBe('FORBIDDEN');
  });
});
