import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPrisma } from '@/server/data/prisma';
import { expireMenu } from '@/server/data/cache';
import { resolvePublicMenu } from '@/server/data/public-menu';
import { formatClientId, parseClientId } from '@/server/domain/restaurant-profile';
import * as menuActions from '@/server/studio/actions/menus';
import * as restaurants from '@/server/studio/actions/restaurants';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import type { ActionDef } from '@/server/studio/framework/action';
import { runAction } from '@/server/studio/framework/action';
import { runQuery, type QueryDef } from '@/server/studio/framework/query';
import type { ActionResult } from '@/server/studio/framework/result';
import * as menuQueries from '@/server/studio/queries/menus';
import * as overviewQueries from '@/server/studio/queries/overview';
import * as restaurantQueries from '@/server/studio/queries/restaurants';
import { branchInput, restaurantInput } from '@/server/studio/services/restaurants';
import { getStorage } from '@/server/storage/storage';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { createMenuFixture, publishFixture, requireTestDb, resetTestData } from '../helpers/db';

// Restaurants' cached menus are expired after a status change; the real function is a no-op outside Next, so the test
// watches the calls and lets them through.
vi.mock('@/server/data/cache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/data/cache')>();
  return { ...actual, expireMenu: vi.fn(actual.expireMenu) };
});

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };
const prisma = () => getPrisma();
const META = { ip: '203.0.113.7', userAgent: 'vitest' };

const codeOf = (result: ActionResult<unknown>) => (result.ok ? 'OK' : result.error.code);
const dataOf = <T>(result: ActionResult<T>): T => {
  if (!result.ok) throw new Error(`expected success, got ${JSON.stringify(result.error)}`);
  return result.data;
};
const failureOf = (result: ActionResult<unknown>) => {
  if (result.ok) throw new Error(`expected a failure, got ${JSON.stringify(result.data)}`);
  return result.error;
};

let admin: Actor;
let designerOfAtelier: Actor;
let ownerOfAtelier: Actor;
let ownerOfBistro: Actor;
let unassigned: Actor;
let atelier: { id: string; clientNumber: number };
let bistro: { id: string; clientNumber: number };

async function person(
  id: string,
  name: string,
  memberships: Array<[string, 'DESIGNER' | 'OWNER']> = [],
  superAdmin = false,
): Promise<Actor> {
  await prisma().user.create({ data: { id, name, email: `${id}@example.com`, isSuperAdmin: superAdmin, twoFactorEnabled: superAdmin } });
  for (const [restaurantId, role] of memberships) await prisma().membership.create({ data: { userId: id, restaurantId, role } });
  return (await loadActor(prisma(), id)) as Actor;
}

const run = <I, O>(actor: Actor, def: ActionDef<I, O>, input: unknown) => runAction(prisma(), actor, def, input, META);
const ask = <I, O>(actor: Actor, def: QueryDef<I, O>, input: unknown = {}) => runQuery(prisma(), actor, def, input);

/** A restaurant made through the action, the way the Studio makes one. */
async function create(name: string, extra: Record<string, unknown> = {}): Promise<string> {
  return dataOf(await run(admin, restaurants.createRestaurant, { name, type: 'RESTAURANT', ...extra })).restaurantId;
}

beforeAll(async () => {
  requireTestDb();
  vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
  await resetTestData(prisma());
});

beforeEach(async () => {
  await resetTestData(prisma());
  vi.mocked(expireMenu).mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  atelier = await prisma().restaurant.create({ data: { name: 'Atelier', city: 'Erbil', type: 'FINE_DINING' }, select: { id: true, clientNumber: true } });
  bistro = await prisma().restaurant.create({ data: { name: 'Bistro Mazo', city: 'Duhok', type: 'CAFE' }, select: { id: true, clientNumber: true } });
  admin = await person('admin', 'Sam Admin', [], true);
  designerOfAtelier = await person('dee', 'Dee Designer', [[atelier.id, 'DESIGNER']]);
  ownerOfAtelier = await person('olive', 'Olive Owner', [[atelier.id, 'OWNER']]);
  ownerOfBistro = await person('bea', 'Bea Owner', [[bistro.id, 'OWNER']]);
  unassigned = await person('una', 'Una Unassigned');
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

describe('client IDs', () => {
  it('formats the number with four digits, and longer numbers in full', () => {
    expect(formatClientId(1)).toBe('BZ-0001');
    expect(formatClientId(7)).toBe('BZ-0007');
    expect(formatClientId(9999)).toBe('BZ-9999');
    expect(formatClientId(10000)).toBe('BZ-10000');
    expect(formatClientId(123456)).toBe('BZ-123456');
  });

  it('reads a typed client ID with or without the hyphen, in any case', () => {
    for (const text of ['BZ-0007', 'bz7', 'bz-0007', 'Bz-7', ' bz-7 ', 'BZ 7', 'bz0007']) {
      expect(parseClientId(text), text).toBe(7);
    }
    expect(parseClientId('BZ-12345')).toBe(12345);
  });

  it('does not take anything else for a client ID', () => {
    for (const text of ['', '7', '0007', 'BZ-', 'BZ-0', 'bz-x', 'abz-7', 'bz-7x', 'Atelier', 'BZ-1234567890']) {
      expect(parseClientId(text), text).toBeNull();
    }
  });
});

describe('restaurantInput', () => {
  const parse = (value: unknown) => restaurantInput.safeParse(value);
  const fieldsOf = (value: unknown) => {
    const result = parse(value);
    if (result.success) throw new Error('expected the input to be refused');
    return Object.fromEntries(result.error.issues.map((issue) => [issue.path.join('.'), issue.message]));
  };

  it('accepts a name and a type, trims the name and fills the rest', () => {
    const result = parse({ name: '  Atelier  ', type: 'CAFE' });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ name: 'Atelier', type: 'CAFE', description: '', city: '', notes: '' });
    expect(result.data?.workingHours.mon).toEqual([]);
    expect(result.data?.socialLinks).toEqual({ instagram: '', facebook: '', tiktok: '', website: '' });
  });

  it('needs a name of 1 to 120 characters', () => {
    expect(fieldsOf({ name: '   ', type: 'CAFE' }).name).toBeTruthy();
    expect(parse({ name: 'x'.repeat(120), type: 'CAFE' }).success).toBe(true);
    expect(fieldsOf({ name: 'x'.repeat(121), type: 'CAFE' }).name).toBe('Use at most 120 characters');
  });

  it('needs one of the six types', () => {
    for (const type of ['CAFE', 'RESTAURANT', 'BAKERY', 'FAST_FOOD', 'FINE_DINING', 'OTHER']) {
      expect(parse({ name: 'A', type }).success, type).toBe(true);
    }
    expect(fieldsOf({ name: 'A', type: 'BAR' }).type).toBeTruthy();
    expect(fieldsOf({ name: 'A' }).type).toBeTruthy();
  });

  it('caps the free text fields', () => {
    expect(parse({ name: 'A', type: 'CAFE', description: 'd'.repeat(2000), notes: 'n'.repeat(5000) }).success).toBe(true);
    expect(fieldsOf({ name: 'A', type: 'CAFE', description: 'd'.repeat(2001) }).description).toBeTruthy();
    expect(fieldsOf({ name: 'A', type: 'CAFE', notes: 'n'.repeat(5001) }).notes).toBeTruthy();
    for (const field of ['address', 'city', 'country']) {
      expect(parse({ name: 'A', type: 'CAFE', [field]: 'x'.repeat(200) }).success, field).toBe(true);
      expect(fieldsOf({ name: 'A', type: 'CAFE', [field]: 'x'.repeat(201) })[field], field).toBeTruthy();
    }
  });

  it('takes phone numbers of digits, spaces, plus, brackets and hyphens, up to 32 characters', () => {
    for (const field of ['phone', 'whatsapp']) {
      expect(parse({ name: 'A', type: 'CAFE', [field]: '+964 (750) 123-4567' }).success, field).toBe(true);
      expect(parse({ name: 'A', type: 'CAFE', [field]: '' }).success, field).toBe(true);
      expect(fieldsOf({ name: 'A', type: 'CAFE', [field]: '0750 abc' })[field], field).toBeTruthy();
      expect(fieldsOf({ name: 'A', type: 'CAFE', [field]: '1'.repeat(33) })[field], field).toBeTruthy();
      expect(fieldsOf({ name: 'A', type: 'CAFE', [field]: '075<0' })[field], field).toBeTruthy();
    }
  });

  it('takes social links as https:// links or empty, and nothing else', () => {
    const ok = parse({
      name: 'A',
      type: 'CAFE',
      socialLinks: { instagram: 'https://instagram.com/atelier', website: 'https://atelier.example/menu?a=1' },
    });
    expect(ok.success).toBe(true);
    for (const bad of ['http://x.example', 'javascript:alert(1)', 'instagram.com/atelier', 'https://', 'https://exa mple.com', 'ftp://x.example']) {
      expect(fieldsOf({ name: 'A', type: 'CAFE', socialLinks: { facebook: bad } })['socialLinks.facebook'], bad).toBeTruthy();
    }
  });

  it('takes working hours of up to three HH:MM ranges a day, which may cross midnight', () => {
    const ok = parse({
      name: 'A',
      type: 'CAFE',
      workingHours: {
        mon: [['08:00', '23:00']],
        fri: [['12:00', '15:00'], ['18:00', '02:00'], ['03:00', '04:00']],
      },
    });
    expect(ok.success).toBe(true);
    expect(ok.data?.workingHours.fri).toHaveLength(3);
    expect(ok.data?.workingHours.tue).toEqual([]);

    const tooMany = fieldsOf({
      name: 'A',
      type: 'CAFE',
      workingHours: { sat: [['01:00', '02:00'], ['03:00', '04:00'], ['05:00', '06:00'], ['07:00', '08:00']] },
    });
    expect(tooMany['workingHours.sat']).toBeTruthy();
    for (const bad of [['25:00', '02:00'], ['8:00', '12:00'], ['08:00', '12:60'], ['09:00', '09:00'], ['09:00', '']]) {
      expect(Object.keys(fieldsOf({ name: 'A', type: 'CAFE', workingHours: { sun: [bad] } })).some((key) => key.startsWith('workingHours.sun')), bad.join('-')).toBe(true);
    }
  });
});

describe('branchInput', () => {
  it('needs a name and takes the same limits as the profile', () => {
    expect(branchInput.safeParse({ name: 'Downtown' }).success).toBe(true);
    expect(branchInput.safeParse({ name: '' }).success).toBe(false);
    expect(branchInput.safeParse({ name: 'x'.repeat(121) }).success).toBe(false);
    expect(branchInput.safeParse({ name: 'A', phone: 'call me' }).success).toBe(false);
    expect(branchInput.safeParse({ name: 'A', workingHours: { mon: [['08:00', '23:00']] } }).success).toBe(true);
  });
});

describe('createRestaurant', () => {
  it('lets a Super Admin create one, with a client ID, a normalized profile and an audit row filed under it', async () => {
    const { restaurantId } = dataOf(
      await run(admin, restaurants.createRestaurant, {
        name: '  Café Mazo ',
        type: 'BAKERY',
        city: 'Sulaymaniyah',
        phone: '+964 750 000 0000',
        socialLinks: { instagram: 'https://instagram.com/mazo', facebook: '' },
        workingHours: { mon: [['08:00', '22:00']] },
        notes: 'Pays on the 1st',
      }),
    );

    const row = await prisma().restaurant.findUniqueOrThrow({ where: { id: restaurantId } });
    expect(row).toMatchObject({ name: 'Café Mazo', type: 'BAKERY', city: 'Sulaymaniyah', status: 'ACTIVE', version: 1, notes: 'Pays on the 1st' });
    expect(row.clientNumber).toBeGreaterThan(bistro.clientNumber);
    // Only the links that were given are stored.
    expect(row.socialLinks).toEqual({ instagram: 'https://instagram.com/mazo' });
    expect(row.workingHours).toMatchObject({ mon: [['08:00', '22:00']], tue: [] });

    // The platform action files its audit row under the restaurant it made, so that restaurant's Activity shows it.
    const audit = await prisma().auditLog.findFirstOrThrow({ where: { action: 'restaurant.created' } });
    expect(audit).toMatchObject({ actorId: admin.userId, restaurantId, menuId: null, entityType: 'Restaurant', entityId: restaurantId });
    expect(audit.changes).toMatchObject({ name: { before: null, after: 'Café Mazo' } });
  });

  it('is for Super Admins only', async () => {
    for (const actor of [designerOfAtelier, ownerOfAtelier, unassigned]) {
      expect(codeOf(await run(actor, restaurants.createRestaurant, { name: 'Nope', type: 'CAFE' }))).toBe('FORBIDDEN');
    }
    expect(await prisma().restaurant.count({ where: { name: 'Nope' } })).toBe(0);
    expect(codeOf(await run(null as never, restaurants.createRestaurant, { name: 'Nope', type: 'CAFE' }))).toBe('UNAUTHENTICATED');
  });

  it('refuses an invalid profile with the fields named, and writes nothing', async () => {
    const result = await run(admin, restaurants.createRestaurant, { name: '', type: 'CAFE', phone: 'x', socialLinks: { website: 'http://a.example' } });
    const error = failureOf(result);
    expect(error.code).toBe('INVALID');
    expect(Object.keys(error.fields ?? {}).sort()).toEqual(['name', 'phone', 'socialLinks.website']);
    expect(await prisma().auditLog.count({ where: { action: 'restaurant.created' } })).toBe(0);
  });

  it('gives each restaurant the next client number', async () => {
    const first = await create('One');
    const second = await create('Two');
    const [a, b] = await Promise.all([first, second].map((id) => prisma().restaurant.findUniqueOrThrow({ where: { id }, select: { clientNumber: true } })));
    expect(b!.clientNumber).toBe(a!.clientNumber + 1);
  });
});

describe('listRestaurants', () => {
  it('lists a new restaurant for a Super Admin, with its client ID and menu count', async () => {
    const id = await create('Zeta Grill', { city: 'Basra', type: 'FAST_FOOD' });
    const fixture = await createMenuFixture(prisma(), 'zeta-menu', { publish: false });
    await prisma().menu.update({ where: { id: fixture.menu.id }, data: { restaurantId: id } });
    await prisma().menu.create({ data: { restaurantId: id, name: 'Old', slug: 'zeta-old', status: 'ARCHIVED', timezone: 'Asia/Baghdad' } });

    const page = dataOf(await ask(admin, restaurantQueries.listRestaurants, { q: 'Zeta Grill' }));
    expect(page.total).toBe(1);
    const row = page.rows[0]!;
    expect(row).toMatchObject({ id, name: 'Zeta Grill', type: 'FAST_FOOD', city: 'Basra', status: 'ACTIVE', menuCount: 2 });
    const { clientNumber } = await prisma().restaurant.findUniqueOrThrow({ where: { id } });
    expect(row.clientId).toBe(formatClientId(clientNumber));
    expect(row.createdAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(page).toMatchObject({ page: 1, pageSize: 50, canCreate: true });
  });

  it('finds client 7 by BZ-0007, bz7 and bz-0007, and still matches names and cities', async () => {
    // Client numbers are unique and the sequence is shared by every test, so move the other one out of the way first.
    await prisma().restaurant.update({ where: { id: atelier.id }, data: { clientNumber: 9001 } });
    await prisma().restaurant.update({ where: { id: bistro.id }, data: { clientNumber: 7 } });
    for (const q of ['BZ-0007', 'bz7', 'bz-0007']) {
      const page = dataOf(await ask(admin, restaurantQueries.listRestaurants, { q }));
      expect(page.rows.map((row) => row.name), q).toEqual(['Bistro Mazo']);
    }
    // Case-insensitive names, and cities.
    expect(dataOf(await ask(admin, restaurantQueries.listRestaurants, { q: 'ATELIER' })).rows.map((row) => row.name)).toEqual(['Atelier']);
    expect(dataOf(await ask(admin, restaurantQueries.listRestaurants, { q: 'duh' })).rows.map((row) => row.name)).toEqual(['Bistro Mazo']);
    expect(dataOf(await ask(admin, restaurantQueries.listRestaurants, { q: 'no such place' })).total).toBe(0);
  });

  it('searches for what was typed, not for a pattern', async () => {
    await create('100% Grill');
    await create('a_b Diner');
    await create('axb Diner');
    const names = async (q: string) => dataOf(await ask(admin, restaurantQueries.listRestaurants, { q })).rows.map((row) => row.name);
    expect(await names('%')).toEqual(['100% Grill']);
    expect(await names('a_b')).toEqual(['a_b Diner']);
  });

  it('finds an Arabic-script name by part of it', async () => {
    await create('مطعم مازو', { city: 'أربيل' });
    expect(dataOf(await ask(admin, restaurantQueries.listRestaurants, { q: 'مازو' })).rows.map((row) => row.name)).toEqual(['مطعم مازو']);
    expect(dataOf(await ask(admin, restaurantQueries.listRestaurants, { q: 'أربيل' })).total).toBe(1);
  });

  it('filters by city, type, status and the day it was created', async () => {
    const cafe = await create('Cafe Three', { city: 'Erbil', type: 'CAFE' });
    await prisma().restaurant.update({ where: { id: cafe }, data: { status: 'SUSPENDED' } });
    await prisma().restaurant.update({ where: { id: atelier.id }, data: { createdAt: new Date('2026-01-10T09:00:00Z') } });
    await prisma().restaurant.update({ where: { id: bistro.id }, data: { createdAt: new Date('2026-02-20T09:00:00Z') } });
    const names = async (filter: Record<string, unknown>) => dataOf(await ask(admin, restaurantQueries.listRestaurants, filter)).rows.map((row) => row.name);

    expect(await names({ city: 'Erbil' })).toEqual(['Atelier', 'Cafe Three']);
    expect(await names({ city: 'erbil' })).toEqual(['Atelier', 'Cafe Three']);
    expect(await names({ type: 'CAFE' })).toEqual(['Bistro Mazo', 'Cafe Three']);
    expect(await names({ status: 'SUSPENDED' })).toEqual(['Cafe Three']);
    expect(await names({ status: 'ARCHIVED' })).toEqual([]);
    expect(await names({ createdFrom: '2026-02-01', createdTo: '2026-03-01' })).toEqual(['Bistro Mazo']);
    // The last day counts whole, in the Studio's time zone (UTC+3): 09:00Z on the 20th is 12:00 there.
    expect(await names({ createdFrom: '2026-02-20', createdTo: '2026-02-20' })).toEqual(['Bistro Mazo']);
    expect(await names({ createdTo: '2026-01-31' })).toEqual(['Atelier']);
    expect(await names({ city: 'Erbil', type: 'CAFE' })).toEqual(['Cafe Three']);
  });

  it('sorts by name, city and creation date, in both directions', async () => {
    await prisma().restaurant.update({ where: { id: atelier.id }, data: { createdAt: new Date('2026-03-01T00:00:00Z') } });
    await prisma().restaurant.update({ where: { id: bistro.id }, data: { createdAt: new Date('2026-01-01T00:00:00Z') } });
    const names = async (sort: string, dir: string) =>
      dataOf(await ask(admin, restaurantQueries.listRestaurants, { sort, dir })).rows.map((row) => row.name);

    expect(await names('name', 'asc')).toEqual(['Atelier', 'Bistro Mazo']);
    expect(await names('name', 'desc')).toEqual(['Bistro Mazo', 'Atelier']);
    expect(await names('city', 'asc')).toEqual(['Bistro Mazo', 'Atelier']); // Duhok, Erbil
    expect(await names('city', 'desc')).toEqual(['Atelier', 'Bistro Mazo']);
    expect(await names('createdAt', 'asc')).toEqual(['Bistro Mazo', 'Atelier']);
    expect(await names('createdAt', 'desc')).toEqual(['Atelier', 'Bistro Mazo']);
    // Without a choice: by name.
    expect(dataOf(await ask(admin, restaurantQueries.listRestaurants, {})).rows.map((row) => row.name)).toEqual(['Atelier', 'Bistro Mazo']);
  });

  it('pages by 50 and keeps the total', async () => {
    await prisma().restaurant.createMany({ data: Array.from({ length: 53 }, (_, i) => ({ name: `Place ${String(i).padStart(2, '0')}` })) });
    const first = dataOf(await ask(admin, restaurantQueries.listRestaurants, { sort: 'name' }));
    expect(first.total).toBe(55);
    expect(first.rows).toHaveLength(50);
    const second = dataOf(await ask(admin, restaurantQueries.listRestaurants, { sort: 'name', page: 2 }));
    expect(second.rows).toHaveLength(5);
    expect(second.page).toBe(2);
    const seen = new Set([...first.rows, ...second.rows].map((row) => row.id));
    expect(seen.size).toBe(55);
    expect(dataOf(await ask(admin, restaurantQueries.listRestaurants, { page: 3 })).rows).toEqual([]);
  });

  it('refuses a request it cannot read', async () => {
    for (const bad of [{ page: 0 }, { sort: 'password' }, { dir: 'sideways' }, { type: 'BAR' }, { createdFrom: 'yesterday' }, { createdFrom: '2026-13-45' }, { pageSize: 5000 }]) {
      expect(codeOf(await ask(admin, restaurantQueries.listRestaurants, bad)), JSON.stringify(bad)).toBe('INVALID');
    }
  });

  it('shows a designer only the restaurants they are assigned to, and nothing about the others', async () => {
    const page = dataOf(await ask(designerOfAtelier, restaurantQueries.listRestaurants, {}));
    expect(page.rows.map((row) => row.name)).toEqual(['Atelier']);
    expect(page.total).toBe(1);
    expect(page.canCreate).toBe(false);
    // Filters, search, a client ID and the list of cities never reach past the scope.
    expect(dataOf(await ask(designerOfAtelier, restaurantQueries.listRestaurants, { q: 'bistro' })).total).toBe(0);
    expect(dataOf(await ask(designerOfAtelier, restaurantQueries.listRestaurants, { q: formatClientId(bistro.clientNumber) })).total).toBe(0);
    expect(dataOf(await ask(designerOfAtelier, restaurantQueries.listRestaurants, { city: 'Duhok' })).total).toBe(0);
    expect(page.cities).toEqual(['Erbil']);
  });

  it('shows an owner their own restaurant only, and staff with no assignment nothing', async () => {
    expect(dataOf(await ask(ownerOfBistro, restaurantQueries.listRestaurants, {})).rows.map((row) => row.name)).toEqual(['Bistro Mazo']);
    const none = dataOf(await ask(unassigned, restaurantQueries.listRestaurants, {}));
    expect(none).toMatchObject({ rows: [], total: 0, cities: [] });
    expect(codeOf(await ask(null as never, restaurantQueries.listRestaurants, {}))).toBe('UNAUTHENTICATED');
  });

  it('counts only a restaurant the reader belongs to in the menu counts', async () => {
    const other = await createMenuFixture(prisma(), 'bistro-menu', { publish: false });
    await prisma().menu.update({ where: { id: other.menu.id }, data: { restaurantId: bistro.id } });
    expect(dataOf(await ask(designerOfAtelier, restaurantQueries.listRestaurants, {})).rows.map((row) => row.menuCount)).toEqual([0]);
    expect(dataOf(await ask(ownerOfBistro, restaurantQueries.listRestaurants, {})).rows.map((row) => row.menuCount)).toEqual([1]);
  });
});

describe('getRestaurant', () => {
  it('gives a member the profile with its version and what they may do', async () => {
    const id = await create('Profile Place', {
      description: 'Good food',
      city: 'Erbil',
      socialLinks: { website: 'https://place.example' },
      workingHours: { sat: [['10:00', '23:30']] },
      notes: 'Internal',
    });
    const asAdmin = dataOf(await ask(admin, restaurantQueries.getRestaurant, { restaurantId: id }));
    expect(asAdmin).toMatchObject({
      id,
      name: 'Profile Place',
      description: 'Good food',
      status: 'ACTIVE',
      version: 1,
      notes: 'Internal',
      menuCount: 0,
      branchCount: 0,
      socialLinks: { instagram: '', facebook: '', tiktok: '', website: 'https://place.example' },
    });
    expect(asAdmin.clientId).toMatch(/^BZ-\d{4,}$/);
    expect(asAdmin.workingHours.sat).toEqual([['10:00', '23:30']]);
    expect(asAdmin.can).toEqual({ edit: true, status: true, delete: true, invite: true, manage: true, permissions: true, audit: true, media: true });

    const asDesigner = dataOf(await ask(designerOfAtelier, restaurantQueries.getRestaurant, { restaurantId: atelier.id }));
    expect(asDesigner.can).toEqual({ edit: true, status: false, delete: false, invite: false, manage: false, permissions: false, audit: false, media: true });
    const asOwner = dataOf(await ask(ownerOfAtelier, restaurantQueries.getRestaurant, { restaurantId: atelier.id }));
    expect(asOwner.can).toEqual({ edit: false, status: false, delete: false, invite: false, manage: false, permissions: false, audit: false, media: false });
  });

  it('keeps the agency notes from the client owner', async () => {
    await prisma().restaurant.update({ where: { id: atelier.id }, data: { notes: 'Late payer' } });
    expect(dataOf(await ask(designerOfAtelier, restaurantQueries.getRestaurant, { restaurantId: atelier.id })).notes).toBe('Late payer');
    expect(dataOf(await ask(ownerOfAtelier, restaurantQueries.getRestaurant, { restaurantId: atelier.id })).notes).toBeNull();
  });

  it('answers another restaurant, and one that does not exist, the same way', async () => {
    expect(codeOf(await ask(ownerOfBistro, restaurantQueries.getRestaurant, { restaurantId: atelier.id }))).toBe('NOT_FOUND');
    expect(codeOf(await ask(unassigned, restaurantQueries.getRestaurant, { restaurantId: atelier.id }))).toBe('NOT_FOUND');
    expect(codeOf(await ask(admin, restaurantQueries.getRestaurant, { restaurantId: 'nope' }))).toBe('NOT_FOUND');
  });

  it('lets an owner see the client owner invite right when the client policy grants it', async () => {
    await prisma().restaurant.update({ where: { id: atelier.id }, data: { permissionPolicy: { OWNER: { grant: ['people.invite'], revoke: [] } } } });
    const asOwner = dataOf(await ask(ownerOfAtelier, restaurantQueries.getRestaurant, { restaurantId: atelier.id }));
    expect(asOwner.can.invite).toBe(true);
    expect(asOwner.can.manage).toBe(false);
  });
});

describe('updateRestaurant', () => {
  const profile = (extra: Record<string, unknown> = {}) => ({ name: 'Atelier', type: 'FINE_DINING', city: 'Erbil', ...extra });

  it('saves the profile for a designer of the restaurant, moves its version on and audits what changed', async () => {
    const result = await run(designerOfAtelier, restaurants.updateRestaurant, {
      restaurantId: atelier.id,
      version: 1,
      ...profile({ name: 'Atelier Nouveau', phone: '+964 750 111 2222', description: 'New' }),
    });
    expect(dataOf(result)).toEqual({ version: 2 });
    const row = await prisma().restaurant.findUniqueOrThrow({ where: { id: atelier.id } });
    expect(row).toMatchObject({ name: 'Atelier Nouveau', phone: '+964 750 111 2222', version: 2 });

    const audit = await prisma().auditLog.findFirstOrThrow({ where: { action: 'restaurant.updated' } });
    expect(audit).toMatchObject({ actorId: designerOfAtelier.userId, restaurantId: atelier.id, entityType: 'Restaurant', entityId: atelier.id });
    // Only the fields that changed.
    expect(Object.keys(audit.changes as object).sort()).toEqual(['description', 'name', 'phone']);
    expect(audit.changes).toMatchObject({ name: { before: 'Atelier', after: 'Atelier Nouveau' } });
  });

  it('refuses a stale version with who changed it and when, and keeps the newer data', async () => {
    dataOf(await run(admin, restaurants.updateRestaurant, { restaurantId: atelier.id, version: 1, ...profile({ name: 'By Sam' }) }));
    const stale = await run(designerOfAtelier, restaurants.updateRestaurant, { restaurantId: atelier.id, version: 1, ...profile({ name: 'By Dee' }) });
    const error = failureOf(stale);
    expect(error.code).toBe('CONFLICT');
    expect(error.fields).toMatchObject({ changedBy: 'Sam Admin' });
    expect(new Date(error.fields!.changedAt!).getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect((await prisma().restaurant.findUniqueOrThrow({ where: { id: atelier.id } })).name).toBe('By Sam');
    expect(await prisma().auditLog.count({ where: { action: 'restaurant.updated' } })).toBe(1);
  });

  it('names who last edited the profile in a refusal, not who changed the status or the branch order since', async () => {
    dataOf(await run(admin, restaurants.updateRestaurant, { restaurantId: atelier.id, version: 1, ...profile({ name: 'By Sam' }) }));
    // Neither of these moves the profile's version.
    const rita = await person('rita', 'Rita Root', [], true);
    dataOf(await run(rita, restaurants.setRestaurantStatus, { restaurantId: atelier.id, status: 'SUSPENDED' }));
    const ids: string[] = [];
    for (const name of ['A', 'B']) ids.push(dataOf(await run(admin, restaurants.createBranch, { restaurantId: atelier.id, name })).branchId);
    dataOf(await run(designerOfAtelier, restaurants.reorderBranches, { restaurantId: atelier.id, order: [...ids].reverse() }));

    const stale = failureOf(await run(designerOfAtelier, restaurants.updateRestaurant, { restaurantId: atelier.id, version: 1, ...profile({ name: 'By Dee' }) }));
    expect(stale).toMatchObject({ code: 'CONFLICT', fields: { changedBy: 'Sam Admin' } });
    expect(await prisma().auditLog.findFirstOrThrow({ where: { action: 'restaurant.status_changed' } })).toMatchObject({ entityType: 'RestaurantStatus', entityId: atelier.id });
    expect(await prisma().auditLog.findFirstOrThrow({ where: { action: 'branch.reordered' } })).toMatchObject({ entityType: 'BranchOrder', entityId: atelier.id });
  });

  it('does not write, version or audit when nothing changed', async () => {
    const result = await run(designerOfAtelier, restaurants.updateRestaurant, { restaurantId: atelier.id, version: 1, ...profile() });
    expect(dataOf(result)).toEqual({ version: 1 });
    expect((await prisma().restaurant.findUniqueOrThrow({ where: { id: atelier.id } })).version).toBe(1);
    expect(await prisma().auditLog.count({ where: { action: 'restaurant.updated' } })).toBe(0);
  });

  it('refuses an owner without the permission, and another restaurant as not found', async () => {
    expect(codeOf(await run(ownerOfAtelier, restaurants.updateRestaurant, { restaurantId: atelier.id, version: 1, ...profile({ name: 'Mine' }) }))).toBe('FORBIDDEN');
    expect(codeOf(await run(designerOfAtelier, restaurants.updateRestaurant, { restaurantId: bistro.id, version: 1, ...profile({ name: 'Theirs' }) }))).toBe('NOT_FOUND');
    expect((await prisma().restaurant.findUniqueOrThrow({ where: { id: bistro.id } })).name).toBe('Bistro Mazo');
  });

  it('saves nothing for an invalid profile', async () => {
    const error = failureOf(await run(designerOfAtelier, restaurants.updateRestaurant, { restaurantId: atelier.id, version: 1, ...profile({ whatsapp: 'abc' }) }));
    expect(error).toMatchObject({ code: 'INVALID', fields: { whatsapp: expect.any(String) } });
    expect(codeOf(await run(designerOfAtelier, restaurants.updateRestaurant, { restaurantId: atelier.id, version: 0, ...profile() }))).toBe('INVALID');
    expect((await prisma().restaurant.findUniqueOrThrow({ where: { id: atelier.id } })).version).toBe(1);
  });

  it('never changes the agency notes on behalf of an owner whose client policy lets them edit', async () => {
    await prisma().restaurant.update({
      where: { id: atelier.id },
      data: { notes: 'Late payer', permissionPolicy: { OWNER: { grant: ['restaurant.edit'], revoke: [] } } },
    });
    dataOf(await run(ownerOfAtelier, restaurants.updateRestaurant, { restaurantId: atelier.id, version: 1, ...profile({ name: 'Owner edit', notes: 'Hijacked' }) }));
    const row = await prisma().restaurant.findUniqueOrThrow({ where: { id: atelier.id } });
    expect(row).toMatchObject({ name: 'Owner edit', notes: 'Late payer' });
  });

  it('marks every menu of the restaurant as changed when its name changes, since guests see the name, until it is published', async () => {
    const first = await createMenuFixture(prisma(), 'rename-first');
    const restaurantId = first.restaurant.id;
    // A second published menu of the same restaurant, and a menu of another restaurant.
    const second = await prisma().menu.create({ data: { restaurantId, name: 'Second', slug: 'rename-second', locales: ['en'], timezone: 'Asia/Baghdad' } });
    await prisma().menuSlug.create({ data: { slug: 'rename-second', menuId: second.id } });
    const category = await prisma().category.create({ data: { menuId: second.id, slug: 'tea', translations: { en: { name: 'Tea' } } } });
    await prisma().product.create({
      data: { menuId: second.id, categoryId: category.id, slug: 'rename-tea', basePrice: 200, translations: { en: { name: 'Tea', description: 'Hot' } } },
    });
    await publishFixture(prisma(), second.id);
    const other = await createMenuFixture(prisma(), 'rename-other');

    const unpublished = async (menuId: string) => dataOf(await ask(admin, menuQueries.getMenu, { menuId })).unpublished;
    const listed = async () => dataOf(await ask(admin, menuQueries.listMenus, { unpublished: true })).rows.map((row) => row.id).sort();
    const onOverview = async () => dataOf(await ask(admin, overviewQueries.overview, {})).unpublished.map((row) => row.menuId).sort();
    const profileOf = (name: string) => ({ restaurantId, name, type: 'RESTAURANT', city: 'Zakho' });

    // A field guests do not see leaves the menus as they were.
    dataOf(await run(admin, restaurants.updateRestaurant, { ...profileOf(first.restaurant.name), version: 1 }));
    expect(await listed()).toEqual([]);

    dataOf(await run(admin, restaurants.updateRestaurant, { ...profileOf('Renamed Place'), version: 2 }));
    expect(await unpublished(first.menu.id)).toBe(true);
    expect(await unpublished(second.id)).toBe(true);
    expect(await unpublished(other.menu.id)).toBe(false);
    // All Menus' filter and the Overview's list say so too.
    expect(await listed()).toEqual([first.menu.id, second.id].sort());
    expect(await onOverview()).toEqual([first.menu.id, second.id].sort());

    // Publishing shows guests the new name, and that menu is current again; the other is still waiting.
    dataOf(await run(admin, menuActions.publish, { menuId: first.menu.id }));
    expect(await unpublished(first.menu.id)).toBe(false);
    expect(await unpublished(second.id)).toBe(true);
    const live = await resolvePublicMenu('rename-first');
    expect(live.kind === 'live' ? live.tenant.name : live.kind).toBe('Renamed Place');
  });
});

describe('setRestaurantStatus', () => {
  it('lets a Super Admin suspend and restore, and takes the published menu off the public page and back', async () => {
    const fixture = await createMenuFixture(prisma(), 'status-live');
    const restaurantId = fixture.restaurant.id;
    const slug = 'status-live';
    expect((await resolvePublicMenu(slug)).kind).toBe('live');

    expect(dataOf(await run(admin, restaurants.setRestaurantStatus, { restaurantId, status: 'SUSPENDED' }))).toEqual({ status: 'SUSPENDED' });
    expect((await resolvePublicMenu(slug)).kind).toBe('unavailable');

    expect(dataOf(await run(admin, restaurants.setRestaurantStatus, { restaurantId, status: 'ARCHIVED' }))).toEqual({ status: 'ARCHIVED' });
    expect((await resolvePublicMenu(slug)).kind).toBe('unavailable');

    dataOf(await run(admin, restaurants.setRestaurantStatus, { restaurantId, status: 'ACTIVE' }));
    expect((await resolvePublicMenu(slug)).kind).toBe('live');

    const audits = await prisma().auditLog.findMany({ where: { action: 'restaurant.status_changed' }, orderBy: { occurredAt: 'asc' } });
    expect(audits.map((row) => row.changes)).toEqual([
      { status: { before: 'ACTIVE', after: 'SUSPENDED' } },
      { status: { before: 'SUSPENDED', after: 'ARCHIVED' } },
      { status: { before: 'ARCHIVED', after: 'ACTIVE' } },
    ]);
    expect(audits[0]).toMatchObject({ actorId: admin.userId, restaurantId, entityType: 'RestaurantStatus', entityId: restaurantId });
  });

  it('expires the cache of every slug of every menu the restaurant has, once the change has committed', async () => {
    const a = await createMenuFixture(prisma(), 'cache-a', { publish: false });
    const restaurantId = a.restaurant.id;
    const second = await prisma().menu.create({ data: { restaurantId, name: 'Second', slug: 'cache-b', timezone: 'Asia/Baghdad' } });
    await prisma().menuSlug.create({ data: { slug: 'cache-b', menuId: second.id } });
    // A slug the first menu used to have still resolves (and is cached) on its own.
    await prisma().menuSlug.create({ data: { slug: 'cache-a-old', menuId: a.menu.id } });
    // Another restaurant's menu is left alone.
    const other = await createMenuFixture(prisma(), 'cache-other', { publish: false });

    dataOf(await run(admin, restaurants.setRestaurantStatus, { restaurantId, status: 'SUSPENDED' }));

    const calls = vi.mocked(expireMenu).mock.calls.map(([slugs, menuId]) => [[...slugs].sort(), menuId] as const);
    expect(calls).toHaveLength(2);
    expect(calls).toContainEqual([['cache-a', 'cache-a-old'], a.menu.id]);
    expect(calls).toContainEqual([['cache-b'], second.id]);
    expect(calls.some(([, menuId]) => menuId === other.menu.id)).toBe(false);
  });

  it('does nothing, and says nothing in the log, when the restaurant already has that status', async () => {
    const fixture = await createMenuFixture(prisma(), 'status-same', { publish: false });
    expect(dataOf(await run(admin, restaurants.setRestaurantStatus, { restaurantId: fixture.restaurant.id, status: 'ACTIVE' }))).toEqual({ status: 'ACTIVE' });
    expect(await prisma().auditLog.count({ where: { action: 'restaurant.status_changed' } })).toBe(0);
    expect(expireMenu).not.toHaveBeenCalled();
  });

  it('is not for designers or owners, and refuses an unknown status', async () => {
    expect(codeOf(await run(designerOfAtelier, restaurants.setRestaurantStatus, { restaurantId: atelier.id, status: 'SUSPENDED' }))).toBe('FORBIDDEN');
    expect(codeOf(await run(ownerOfAtelier, restaurants.setRestaurantStatus, { restaurantId: atelier.id, status: 'SUSPENDED' }))).toBe('FORBIDDEN');
    expect(codeOf(await run(admin, restaurants.setRestaurantStatus, { restaurantId: atelier.id, status: 'DELETED' }))).toBe('INVALID');
    expect((await prisma().restaurant.findUniqueOrThrow({ where: { id: atelier.id } })).status).toBe('ACTIVE');
  });
});

describe('deleteRestaurant', () => {
  it('deletes a restaurant with no menus, with its branches, members and pending invitations, and audits it', async () => {
    await prisma().branch.create({ data: { restaurantId: bistro.id, name: 'Main' } });
    await prisma().invitation.create({
      data: { email: 'new@example.com', restaurantId: bistro.id, role: 'OWNER', tokenHash: 'hash-1', expiresAt: new Date(Date.now() + 86_400_000), invitedById: admin.userId },
    });
    const bystander = await prisma().invitation.create({
      data: { email: 'else@example.com', restaurantId: atelier.id, role: 'OWNER', tokenHash: 'hash-2', expiresAt: new Date(Date.now() + 86_400_000), invitedById: admin.userId },
    });

    expect(dataOf(await run(admin, restaurants.deleteRestaurant, { restaurantId: bistro.id, confirmName: ' Bistro Mazo ' }))).toEqual({ deleted: true });

    expect(await prisma().restaurant.findUnique({ where: { id: bistro.id } })).toBeNull();
    expect(await prisma().branch.count({ where: { restaurantId: bistro.id } })).toBe(0);
    expect(await prisma().membership.count({ where: { restaurantId: bistro.id } })).toBe(0);
    expect(await prisma().invitation.count({ where: { restaurantId: bistro.id } })).toBe(0);
    // The people stay, and so does everything of another restaurant.
    expect(await prisma().user.findUnique({ where: { id: ownerOfBistro.userId } })).not.toBeNull();
    expect(await prisma().invitation.findUnique({ where: { id: bystander.id } })).not.toBeNull();
    expect(await prisma().restaurant.findUnique({ where: { id: atelier.id } })).not.toBeNull();

    const audit = await prisma().auditLog.findFirstOrThrow({ where: { action: 'restaurant.deleted' } });
    expect(audit).toMatchObject({ actorId: admin.userId, restaurantId: bistro.id, entityType: 'Restaurant', entityId: bistro.id });
    expect(audit.changes).toMatchObject({ name: { before: 'Bistro Mazo', after: null }, memberships: { before: 1, after: 0 }, invitations: { before: 1, after: 0 } });
  });

  it('deletes the files of its pictures, keeping those another restaurant’s asset still names', async () => {
    vi.stubEnv('MEDIA_LOCAL_DIR', mkdtempSync(join(tmpdir(), 'buzzify-restaurant-delete-')));
    vi.stubEnv('MEDIA_PUBLIC_URL', '/api/dev-media');
    const storage = getStorage();
    async function picture(restaurantId: string, storageKey: string) {
      const files = { original: `${storageKey}/original.png`, webp: { '320': `${storageKey}/webp-320.webp` } };
      await storage.put(files.original, new Uint8Array([1]), { contentType: 'image/png', cacheControl: 'no-store' });
      await storage.put(files.webp['320'], new Uint8Array([2]), { contentType: 'image/webp', cacheControl: 'no-store' });
      const contentHash = storageKey.split('/').at(-1)!;
      await prisma().mediaAsset.create({ data: { restaurantId, kind: 'IMAGE', storageKey, contentHash, mime: 'image/png', bytes: 1, storedBytes: 2, variants: files } });
      return files;
    }
    const own = await picture(bistro.id, `r/${bistro.id}/own`);
    const shared = await picture(bistro.id, `r/${atelier.id}/shared`);
    await picture(atelier.id, `r/${atelier.id}/shared`);

    dataOf(await run(admin, restaurants.deleteRestaurant, { restaurantId: bistro.id, confirmName: 'Bistro Mazo' }));

    expect(await prisma().mediaAsset.count({ where: { restaurantId: bistro.id } })).toBe(0);
    expect(await storage.head(own.original)).toBeNull();
    expect(await storage.head(own.webp['320'])).toBeNull();
    expect(await storage.head(shared.original)).not.toBeNull();
    expect(await storage.head(shared.webp['320'])).not.toBeNull();
  });

  it('is refused while the restaurant has any menu, archived ones included', async () => {
    const fixture = await createMenuFixture(prisma(), 'delete-blocked', { publish: false });
    const restaurantId = fixture.restaurant.id;
    const input = { restaurantId, confirmName: fixture.restaurant.name };
    expect(failureOf(await run(admin, restaurants.deleteRestaurant, input))).toMatchObject({ code: 'INVALID', message: 'Delete all of its menus first' });
    await prisma().menu.update({ where: { id: fixture.menu.id }, data: { status: 'ARCHIVED' } });
    expect(codeOf(await run(admin, restaurants.deleteRestaurant, input))).toBe('INVALID');
    expect(await prisma().restaurant.findUnique({ where: { id: restaurantId } })).not.toBeNull();
    expect(await prisma().auditLog.count({ where: { action: 'restaurant.deleted' } })).toBe(0);

    // Once the menu is deleted, it goes.
    await prisma().menuSlug.deleteMany({ where: { menuId: fixture.menu.id } });
    await prisma().menu.delete({ where: { id: fixture.menu.id } });
    expect(dataOf(await run(admin, restaurants.deleteRestaurant, input))).toEqual({ deleted: true });
  });

  it('needs the restaurant name typed exactly', async () => {
    for (const confirmName of ['', 'bistro mazo', 'Bistro', 'Bistro Mazo!']) {
      const error = failureOf(await run(admin, restaurants.deleteRestaurant, { restaurantId: bistro.id, confirmName }));
      expect(error, confirmName).toMatchObject({ code: 'INVALID', fields: { confirmName: 'Type the restaurant name exactly to confirm' } });
    }
    expect(await prisma().restaurant.findUnique({ where: { id: bistro.id } })).not.toBeNull();
    expect(await prisma().auditLog.count({ where: { action: 'restaurant.deleted' } })).toBe(0);
  });

  it('is for Super Admins only, whatever the client policy says', async () => {
    await prisma().restaurant.update({ where: { id: atelier.id }, data: { permissionPolicy: { OWNER: { grant: ['restaurant.delete'], revoke: [] }, DESIGNER: { grant: ['restaurant.delete'], revoke: [] } } } });
    for (const actor of [ownerOfAtelier, designerOfAtelier]) {
      expect(codeOf(await run(actor, restaurants.deleteRestaurant, { restaurantId: atelier.id, confirmName: 'Atelier' }))).toBe('FORBIDDEN');
    }
    expect(codeOf(await run(ownerOfBistro, restaurants.deleteRestaurant, { restaurantId: atelier.id, confirmName: 'Atelier' }))).toBe('NOT_FOUND');
    expect(await prisma().restaurant.findUnique({ where: { id: atelier.id } })).not.toBeNull();
  });
});

describe('branches', () => {
  const branches = (restaurantId: string) => prisma().branch.findMany({ where: { restaurantId }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
  const audits = (action: string) => prisma().auditLog.findMany({ where: { action }, orderBy: { occurredAt: 'asc' } });

  it('creates branches in order and audits each under the restaurant', async () => {
    const first = dataOf(await run(designerOfAtelier, restaurants.createBranch, { restaurantId: atelier.id, name: 'Downtown', city: 'Erbil', phone: '+964 750 1' })).branchId;
    const second = dataOf(await run(designerOfAtelier, restaurants.createBranch, { restaurantId: atelier.id, name: 'Airport', workingHours: { mon: [['06:00', '22:00']] } })).branchId;

    const rows = await branches(atelier.id);
    expect(rows.map((row) => row.id)).toEqual([first, second]);
    expect(rows.map((row) => row.sortOrder)).toEqual([0, 1]);
    expect(rows[1]!.workingHours).toMatchObject({ mon: [['06:00', '22:00']], tue: [] });

    const created = await audits('branch.created');
    expect(created).toHaveLength(2);
    expect(created[0]).toMatchObject({ actorId: designerOfAtelier.userId, restaurantId: atelier.id, entityType: 'Branch', entityId: first });
    expect(created[0]!.changes).toMatchObject({ name: { before: null, after: 'Downtown' } });
  });

  it('updates a branch with a version check and audits what changed', async () => {
    const branchId = dataOf(await run(admin, restaurants.createBranch, { restaurantId: atelier.id, name: 'Downtown' })).branchId;
    expect(dataOf(await run(designerOfAtelier, restaurants.updateBranch, { restaurantId: atelier.id, branchId, version: 1, name: 'Downtown 2', address: 'Main St' }))).toEqual({ version: 2 });
    const row = await prisma().branch.findUniqueOrThrow({ where: { id: branchId } });
    expect(row).toMatchObject({ name: 'Downtown 2', address: 'Main St', version: 2 });
    const [audit] = await audits('branch.updated');
    expect(audit).toMatchObject({ restaurantId: atelier.id, entityType: 'Branch', entityId: branchId });
    expect(Object.keys(audit!.changes as object).sort()).toEqual(['address', 'name']);

    // A save that started from the old version is refused, and says who got there first.
    const stale = failureOf(await run(admin, restaurants.updateBranch, { restaurantId: atelier.id, branchId, version: 1, name: 'Stale' }));
    expect(stale).toMatchObject({ code: 'CONFLICT', fields: { changedBy: 'Dee Designer' } });
    expect((await prisma().branch.findUniqueOrThrow({ where: { id: branchId } })).name).toBe('Downtown 2');
  });

  it('deletes a branch and audits it', async () => {
    const branchId = dataOf(await run(admin, restaurants.createBranch, { restaurantId: atelier.id, name: 'Old' })).branchId;
    expect(dataOf(await run(designerOfAtelier, restaurants.deleteBranch, { restaurantId: atelier.id, branchId }))).toEqual({ deleted: true });
    expect(await branches(atelier.id)).toEqual([]);
    const [audit] = await audits('branch.deleted');
    expect(audit).toMatchObject({ restaurantId: atelier.id, entityType: 'Branch', entityId: branchId });
    expect(audit!.changes).toMatchObject({ name: { before: 'Old', after: null } });
    expect(codeOf(await run(admin, restaurants.deleteBranch, { restaurantId: atelier.id, branchId }))).toBe('NOT_FOUND');
  });

  it('reorders branches, puts any it was not told about last, and audits the new order', async () => {
    const ids: string[] = [];
    for (const name of ['A', 'B', 'C']) ids.push(dataOf(await run(admin, restaurants.createBranch, { restaurantId: atelier.id, name })).branchId);
    const [a, b, c] = ids as [string, string, string];

    expect(dataOf(await run(designerOfAtelier, restaurants.reorderBranches, { restaurantId: atelier.id, order: [c, a, b] }))).toEqual({ order: [c, a, b] });
    expect((await branches(atelier.id)).map((row) => row.id)).toEqual([c, a, b]);
    expect(dataOf(await run(admin, restaurants.reorderBranches, { restaurantId: atelier.id, order: [b] })).order).toEqual([b, c, a]);
    const logged = await audits('branch.reordered');
    expect(logged).toHaveLength(2);
    expect(logged[0]).toMatchObject({ restaurantId: atelier.id, entityType: 'BranchOrder', entityId: atelier.id });
    expect(logged[0]!.changes).toMatchObject({ order: { before: [a, b, c], after: [c, a, b] } });
  });

  it('refuses a reorder that names a branch of another restaurant, or the same one twice', async () => {
    const mine = dataOf(await run(admin, restaurants.createBranch, { restaurantId: atelier.id, name: 'Mine' })).branchId;
    const theirs = dataOf(await run(admin, restaurants.createBranch, { restaurantId: bistro.id, name: 'Theirs' })).branchId;
    expect(codeOf(await run(designerOfAtelier, restaurants.reorderBranches, { restaurantId: atelier.id, order: [theirs, mine] }))).toBe('NOT_FOUND');
    expect(codeOf(await run(designerOfAtelier, restaurants.reorderBranches, { restaurantId: atelier.id, order: [mine, mine] }))).toBe('INVALID');
    expect(await audits('branch.reordered')).toHaveLength(0);
  });

  it('keeps one restaurant from touching another restaurant branches', async () => {
    const theirs = dataOf(await run(admin, restaurants.createBranch, { restaurantId: bistro.id, name: 'Theirs' })).branchId;
    // The designer of Atelier names their own restaurant and a branch of Bistro's.
    expect(codeOf(await run(designerOfAtelier, restaurants.updateBranch, { restaurantId: atelier.id, branchId: theirs, version: 1, name: 'Hijacked' }))).toBe('NOT_FOUND');
    expect(codeOf(await run(designerOfAtelier, restaurants.deleteBranch, { restaurantId: atelier.id, branchId: theirs }))).toBe('NOT_FOUND');
    // And Bistro itself is out of reach.
    expect(codeOf(await run(designerOfAtelier, restaurants.createBranch, { restaurantId: bistro.id, name: 'Planted' }))).toBe('NOT_FOUND');
    expect((await prisma().branch.findUniqueOrThrow({ where: { id: theirs } })).name).toBe('Theirs');
    expect(await branches(bistro.id)).toHaveLength(1);
  });

  it('is for those who may edit the restaurant', async () => {
    expect(codeOf(await run(ownerOfAtelier, restaurants.createBranch, { restaurantId: atelier.id, name: 'Nope' }))).toBe('FORBIDDEN');
    expect(codeOf(await run(unassigned, restaurants.createBranch, { restaurantId: atelier.id, name: 'Nope' }))).toBe('NOT_FOUND');
    expect(codeOf(await run(admin, restaurants.createBranch, { restaurantId: atelier.id, name: '' }))).toBe('INVALID');
    expect(await branches(atelier.id)).toEqual([]);
  });

  it('lists a restaurant branches in order for a member', async () => {
    const first = dataOf(await run(admin, restaurants.createBranch, { restaurantId: atelier.id, name: 'First', city: 'Erbil' })).branchId;
    dataOf(await run(admin, restaurants.createBranch, { restaurantId: atelier.id, name: 'Second' }));
    const list = dataOf(await ask(ownerOfAtelier, restaurantQueries.restaurantBranches, { restaurantId: atelier.id }));
    expect(list.map((branch) => branch.name)).toEqual(['First', 'Second']);
    expect(list[0]).toMatchObject({ id: first, city: 'Erbil', version: 1 });
    expect(list[0]!.workingHours.mon).toEqual([]);
    expect(codeOf(await ask(ownerOfBistro, restaurantQueries.restaurantBranches, { restaurantId: atelier.id }))).toBe('NOT_FOUND');
  });
});

describe('restaurantMenus', () => {
  it('lists the restaurant menus for a member and nobody else', async () => {
    const fixture = await createMenuFixture(prisma(), 'tab-menu', { publish: false });
    const restaurantId = fixture.restaurant.id;
    const owner = await person('menu-owner', 'Mina Owner', [[restaurantId, 'OWNER']]);
    const asOwner = dataOf(await ask(owner, restaurantQueries.restaurantMenus, { restaurantId }));
    expect(asOwner).toEqual([expect.objectContaining({ id: fixture.menu.id, name: 'Menu tab-menu', slug: 'tab-menu', status: 'DRAFT' })]);
    expect(codeOf(await ask(designerOfAtelier, restaurantQueries.restaurantMenus, { restaurantId }))).toBe('NOT_FOUND');
  });
});

describe('restaurantActivity', () => {
  it('shows the Super Admin what happened to the restaurant, newest first, from its creation on', async () => {
    const id = await create('Activity Place');
    dataOf(await run(admin, restaurants.updateRestaurant, { restaurantId: id, version: 1, name: 'Activity Place', type: 'RESTAURANT', city: 'Zakho' }));
    dataOf(await run(admin, restaurants.createBranch, { restaurantId: id, name: 'Main' }));
    await prisma().auditLog.create({ data: { actorId: admin.userId, restaurantId: atelier.id, action: 'restaurant.updated', entityType: 'Restaurant', entityId: atelier.id } });

    const page = dataOf(await ask(admin, restaurantQueries.restaurantActivity, { restaurantId: id }));
    expect(page.total).toBe(3);
    expect(page.rows.map((row) => row.action)).toEqual(['branch.created', 'restaurant.updated', 'restaurant.created']);
    expect(page.rows[0]).toMatchObject({ actor: { id: admin.userId, name: 'Sam Admin' }, entityType: 'Branch', restaurant: { id, name: 'Activity Place' } });
    expect(page).toMatchObject({ page: 1, pageSize: 25 });
    // Which fields a change touched, and never what they held: one policy with Activity.
    expect(page.rows[1]!.fields).toEqual(['city']);
    // A new restaurant's row names the plan it started on as well.
    expect([...page.rows[2]!.fields].sort()).toEqual(['name', 'plan', 'type']);
    expect(page.rows.every((row) => !('changes' in row))).toBe(true);
    expect(JSON.stringify(page)).not.toContain('Zakho');
  });

  it('pages the log', async () => {
    await prisma().auditLog.createMany({
      data: Array.from({ length: 30 }, (_, i) => ({ actorId: admin.userId, restaurantId: atelier.id, action: 'restaurant.updated', entityType: 'Restaurant', entityId: atelier.id, occurredAt: new Date(Date.now() - i * 1000) })),
    });
    const first = dataOf(await ask(admin, restaurantQueries.restaurantActivity, { restaurantId: atelier.id }));
    const second = dataOf(await ask(admin, restaurantQueries.restaurantActivity, { restaurantId: atelier.id, page: 2 }));
    expect([first.total, first.rows.length, second.rows.length]).toEqual([30, 25, 5]);
  });

  it('is for those who may see the activity log: not designers, not owners', async () => {
    expect(codeOf(await ask(designerOfAtelier, restaurantQueries.restaurantActivity, { restaurantId: atelier.id }))).toBe('FORBIDDEN');
    expect(codeOf(await ask(ownerOfAtelier, restaurantQueries.restaurantActivity, { restaurantId: atelier.id }))).toBe('FORBIDDEN');
    expect(codeOf(await ask(ownerOfBistro, restaurantQueries.restaurantActivity, { restaurantId: atelier.id }))).toBe('NOT_FOUND');
  });
});

describe('newRestaurantAccess', () => {
  it('is open to Super Admins only', async () => {
    expect(codeOf(await ask(admin, restaurantQueries.newRestaurantAccess, {}))).toBe('OK');
    expect(codeOf(await ask(designerOfAtelier, restaurantQueries.newRestaurantAccess, {}))).toBe('FORBIDDEN');
    expect(codeOf(await ask(ownerOfAtelier, restaurantQueries.newRestaurantAccess, {}))).toBe('FORBIDDEN');
  });
});
