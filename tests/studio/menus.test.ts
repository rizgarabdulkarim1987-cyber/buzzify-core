import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PALETTES } from '@/lib/brand';
import { expireMenu } from '@/server/data/cache';
import { getPrisma } from '@/server/data/prisma';
import { resolvePublicMenu } from '@/server/data/public-menu';
import { snapshotHash } from '@/server/domain/snapshot';
import { loadDraftSnapshot, refreshDraftHash } from '@/server/publish/draft';
import * as menus from '@/server/studio/actions/menus';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { runAction, type ActionDef } from '@/server/studio/framework/action';
import { runQuery, type QueryDef } from '@/server/studio/framework/query';
import type { ActionResult } from '@/server/studio/framework/result';
import * as menuQueries from '@/server/studio/queries/menus';
import { checkSlugAvailable, menuSlugs } from '@/server/studio/services/menus';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { createMenuFixture, publishFixture, requireTestDb, resetTestData } from '../helpers/db';

// Menus' cached addresses are expired after every change; the real function does nothing outside Next, so the test
// watches the calls and lets them through.
vi.mock('@/server/data/cache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/data/cache')>();
  return { ...actual, expireMenu: vi.fn(actual.expireMenu) };
});

// `menuSlugs` is read between a delete's check and its delete: the race test restores the menu from inside it.
vi.mock('@/server/studio/services/menus', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/studio/services/menus')>();
  return { ...actual, menuSlugs: vi.fn(actual.menuSlugs) };
});

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };
const prisma = () => getPrisma();
const META = { ip: '203.0.113.9', userAgent: 'vitest' };

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
let designer: Actor;
let owner: Actor;
let outsider: Actor;
let atelier: { id: string; clientNumber: number };
let bistro: { id: string; clientNumber: number };

async function person(id: string, name: string, memberships: Array<[string, 'DESIGNER' | 'OWNER']> = [], superAdmin = false): Promise<Actor> {
  await prisma().user.create({ data: { id, name, email: `${id}@example.com`, isSuperAdmin: superAdmin, twoFactorEnabled: superAdmin } });
  for (const [restaurantId, role] of memberships) await prisma().membership.create({ data: { userId: id, restaurantId, role } });
  return (await loadActor(prisma(), id)) as Actor;
}

const run = <I, O>(actor: Actor, def: ActionDef<I, O>, input: unknown) => runAction(prisma(), actor, def, input, META);
const ask = <I, O>(actor: Actor, def: QueryDef<I, O>, input: unknown = {}) => runQuery(prisma(), actor, def, input);

const SETTINGS = { locales: ['en', 'ar', 'ckb'], defaultLocale: 'en', currency: 'IQD', timezone: 'Asia/Baghdad', numeralSystem: 'LATN' };

/** A menu made through the action, the way the Studio makes one. */
async function create(actor: Actor, restaurantId: string, name: string, slug: string, extra: Record<string, unknown> = {}) {
  return dataOf(await run(actor, menus.createMenu, { restaurantId, name, slug, ...SETTINGS, ...extra })).menuId;
}

/** A published menu (one product) moved under `restaurantId`. */
async function publishedMenuIn(restaurantId: string, slug: string, options: { publish?: boolean } = {}) {
  const fixture = await createMenuFixture(prisma(), slug, options);
  await prisma().menu.update({ where: { id: fixture.menu.id }, data: { restaurantId } });
  await prisma().restaurant.delete({ where: { id: fixture.restaurant.id } });
  return { ...fixture, menu: await prisma().menu.findUniqueOrThrow({ where: { id: fixture.menu.id } }) };
}

/** Gives a draft menu something to publish: a category with one priced product. */
async function addProduct(menuId: string, slug = 'espresso', price = 300) {
  const category = await prisma().category.upsert({
    where: { menuId_slug: { menuId, slug: 'coffee' } },
    create: { menuId, slug: 'coffee', translations: { en: { name: 'Coffee' } } },
    update: {},
  });
  const product = await prisma().product.create({
    data: { menuId, categoryId: category.id, slug, basePrice: price, translations: { en: { name: slug } } },
  });
  await refreshDraftHash(prisma(), menuId);
  return product;
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
  atelier = await prisma().restaurant.create({ data: { name: 'Atelier', city: 'Erbil' }, select: { id: true, clientNumber: true } });
  bistro = await prisma().restaurant.create({ data: { name: 'Bistro', city: 'Duhok' }, select: { id: true, clientNumber: true } });
  admin = await person('admin', 'Sam Admin', [], true);
  designer = await person('dee', 'Dee Designer', [[atelier.id, 'DESIGNER']]);
  owner = await person('olive', 'Olive Owner', [[atelier.id, 'OWNER']]);
  outsider = await person('bea', 'Bea Designer', [[bistro.id, 'DESIGNER']]);
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

describe('createMenu', () => {
  it('creates a menu whose slug resolves and is missing publicly until published', async () => {
    const menuId = await create(designer, atelier.id, '  Dinner  ', 'atelier-dinner', { locales: ['en', 'ar'], numeralSystem: 'ARAB' });

    const row = await prisma().menu.findUniqueOrThrow({ where: { id: menuId }, include: { brand: true, schedule: true, slugs: true } });
    expect(row).toMatchObject({
      restaurantId: atelier.id,
      name: 'Dinner',
      slug: 'atelier-dinner',
      status: 'DRAFT',
      locales: ['en', 'ar'],
      defaultLocale: 'en',
      currency: 'IQD',
      timezone: 'Asia/Baghdad',
      numeralSystem: 'ARAB',
      liveRevisionId: null,
      liveHash: null,
      version: 1,
    });
    expect(row.slugs.map((entry) => entry.slug)).toEqual(['atelier-dinner']);
    // The platform's default palette, and the restaurant's name as the logo.
    expect(row.brand).toMatchObject({ tokens: DEFAULT_PALETTES, logoText: 'Atelier', theme: 'DARK' });
    // Breakfast 07–11, lunch 11–16, dinner 16–22, late night 22–03, every day.
    const schedule = row.schedule.map(({ daypart, startMinute, endMinute, daysOfWeek }) => ({ daypart, startMinute, endMinute, daysOfWeek }));
    expect(schedule.sort((x, y) => x.startMinute - y.startMinute)).toEqual([
      { daypart: 'BREAKFAST', startMinute: 420, endMinute: 660, daysOfWeek: 127 },
      { daypart: 'LUNCH', startMinute: 660, endMinute: 960, daysOfWeek: 127 },
      { daypart: 'DINNER', startMinute: 960, endMinute: 1320, daysOfWeek: 127 },
      { daypart: 'LATE_NIGHT', startMinute: 1320, endMinute: 180, daysOfWeek: 127 },
    ]);
    // The draft hash is the hash of the draft as it stands.
    expect(row.draftHash).toBe(snapshotHash(await loadDraftSnapshot(prisma(), menuId)));

    // Guests get nothing until it is published; the new address is expired, since it may have been cached as missing.
    expect((await resolvePublicMenu('atelier-dinner')).kind).toBe('missing');
    expect(vi.mocked(expireMenu).mock.calls).toContainEqual([['atelier-dinner'], menuId]);

    const audit = await prisma().auditLog.findFirstOrThrow({ where: { action: 'menu.created' } });
    expect(audit).toMatchObject({ actorId: designer.userId, restaurantId: atelier.id, menuId, entityType: 'Menu', entityId: menuId });
    expect(audit.changes).toMatchObject({ name: { before: null, after: 'Dinner' }, slug: { before: null, after: 'atelier-dinner' } });

    await addProduct(menuId);
    dataOf(await run(designer, menus.publish, { menuId }));
    expect((await resolvePublicMenu('atelier-dinner')).kind).toBe('live');
  });

  it('refuses a slug taken by another menu, a tombstone or a reserved word', async () => {
    await publishedMenuIn(bistro.id, 'taken-slug');
    await prisma().menuSlug.create({ data: { slug: 'gone-slug', menuId: null } });
    const cases: Array<[string, string]> = [
      ['taken-slug', 'This address is taken'],
      ['gone-slug', 'This address is taken'],
      ['studio', 'This address is reserved'],
      ['auth', 'This address is reserved'],
      ['ab', 'Use at least 3 characters'],
      ['x'.repeat(49), 'Use at most 48 characters'],
      ['Bad Slug', 'Use lowercase letters, digits and single hyphens'],
      ['double--hyphen', 'Use lowercase letters, digits and single hyphens'],
    ];
    for (const [slug, message] of cases) {
      const error = failureOf(await run(admin, menus.createMenu, { restaurantId: atelier.id, name: 'Nope', slug, ...SETTINGS }));
      expect(error, slug).toMatchObject({ code: 'INVALID', fields: { slug: message } });
    }
    expect(await prisma().menu.count({ where: { restaurantId: atelier.id } })).toBe(0);

    // The check the form makes as the person types gives the same answers.
    expect(dataOf(await ask(designer, menuQueries.slugAvailability, { slug: 'taken-slug' }))).toEqual({ slug: 'taken-slug', status: 'taken' });
    expect(dataOf(await ask(designer, menuQueries.slugAvailability, { slug: 'gone-slug' })).status).toBe('taken');
    expect(dataOf(await ask(designer, menuQueries.slugAvailability, { slug: 'studio' })).status).toBe('RESERVED');
    expect(dataOf(await ask(designer, menuQueries.slugAvailability, { slug: 'ab' })).status).toBe('TOO_SHORT');
    expect(dataOf(await ask(designer, menuQueries.slugAvailability, { slug: 'fresh-slug' })).status).toBe('ok');
    // A menu's own address, and one it used to have, are its to keep.
    const own = await publishedMenuIn(atelier.id, 'mine-now');
    await prisma().menuSlug.create({ data: { slug: 'mine-before', menuId: own.menu.id } });
    expect(dataOf(await ask(designer, menuQueries.slugAvailability, { slug: 'mine-before', menuId: own.menu.id })).status).toBe('ok');
    expect(dataOf(await ask(designer, menuQueries.slugAvailability, { slug: 'mine-before' })).status).toBe('taken');
    expect(await checkSlugAvailable(prisma(), 'taken-slug', own.menu.id)).toBe('taken');
    expect(await checkSlugAvailable(prisma(), 'gone-slug', own.menu.id)).toBe('taken');
    // Another restaurant's menu cannot be named to probe through.
    expect(codeOf(await ask(outsider, menuQueries.slugAvailability, { slug: 'mine-before', menuId: own.menu.id }))).toBe('NOT_FOUND');
  });

  it('checks the languages, currency, time zone and numerals', async () => {
    const fields = async (extra: Record<string, unknown>) =>
      Object.keys(failureOf(await run(designer, menus.createMenu, { restaurantId: atelier.id, name: 'X', slug: 'x-menu', ...SETTINGS, ...extra })).fields ?? {});
    expect(await fields({ name: '  ' })).toEqual(['name']);
    expect(await fields({ locales: [] })).toEqual(['locales']);
    expect(await fields({ locales: ['en', 'fr'] })).toEqual(['locales.1']);
    expect(await fields({ locales: ['en', 'en'] })).toEqual(['locales']);
    expect(await fields({ locales: ['ar'], defaultLocale: 'en' })).toEqual(['defaultLocale']);
    expect(await fields({ currency: 'usd' })).toEqual(['currency']);
    expect(await fields({ currency: 'XYZ' })).toEqual(['currency']);
    expect(await fields({ timezone: 'Mars/Olympus' })).toEqual(['timezone']);
    expect(await fields({ numeralSystem: 'ROMAN' })).toEqual(['numeralSystem']);
    expect(await prisma().menu.count()).toBe(0);
  });

  it('is for those who may create menus in that restaurant', async () => {
    expect(codeOf(await run(owner, menus.createMenu, { restaurantId: atelier.id, name: 'Mine', slug: 'owner-menu', ...SETTINGS }))).toBe('FORBIDDEN');
    expect(codeOf(await run(outsider, menus.createMenu, { restaurantId: atelier.id, name: 'Theirs', slug: 'outsider-menu', ...SETTINGS }))).toBe('NOT_FOUND');
    expect(await prisma().menu.count()).toBe(0);
    expect(await prisma().menuSlug.count()).toBe(0);
  });
});

describe('changeMenuSlug', () => {
  it('lets a menu rename a → b → a and keeps redirects pointing at the current slug', async () => {
    const { menu } = await publishedMenuIn(atelier.id, 'ren-a');
    expect(dataOf(await run(designer, menus.changeMenuSlug, { menuId: menu.id, slug: 'ren-b', version: menu.version }))).toEqual({
      slug: 'ren-b',
      version: menu.version + 1,
    });
    expect(await resolvePublicMenu('ren-a')).toMatchObject({ kind: 'redirect', slug: 'ren-b' });
    expect((await resolvePublicMenu('ren-b')).kind).toBe('live');
    expect(vi.mocked(expireMenu).mock.calls.map(([slugs, id]) => [[...slugs].sort(), id])).toContainEqual([['ren-a', 'ren-b'], menu.id]);

    // Back to its first address: its own history is its to reclaim, and the other one now redirects there.
    dataOf(await run(designer, menus.changeMenuSlug, { menuId: menu.id, slug: 'ren-a', version: menu.version + 1 }));
    expect((await resolvePublicMenu('ren-a')).kind).toBe('live');
    expect(await resolvePublicMenu('ren-b')).toMatchObject({ kind: 'redirect', slug: 'ren-a' });
    const rows = await prisma().menuSlug.findMany({ where: { slug: { in: ['ren-a', 'ren-b'] } }, orderBy: { slug: 'asc' } });
    expect(rows.map((row) => [row.slug, row.menuId])).toEqual([
      ['ren-a', menu.id],
      ['ren-b', menu.id],
    ]);

    const audits = await prisma().auditLog.findMany({ where: { action: 'menu.slug_changed' }, orderBy: { occurredAt: 'asc' } });
    expect(audits.map((row) => row.changes)).toEqual([{ slug: { before: 'ren-a', after: 'ren-b' } }, { slug: { before: 'ren-b', after: 'ren-a' } }]);
    expect(audits[0]).toMatchObject({ entityType: 'Menu', entityId: menu.id, restaurantId: atelier.id, menuId: menu.id });

    // A change made from the version before is refused and names who changed it.
    const stale = failureOf(await run(admin, menus.changeMenuSlug, { menuId: menu.id, slug: 'ren-c', version: menu.version }));
    expect(stale).toMatchObject({ code: 'CONFLICT', fields: { changedBy: 'Dee Designer' } });
    // The same address again changes nothing.
    expect(dataOf(await run(designer, menus.changeMenuSlug, { menuId: menu.id, slug: 'ren-a', version: menu.version + 2 }))).toEqual({
      slug: 'ren-a',
      version: menu.version + 2,
    });
  });

  it("never takes another menu's address or a tombstone, and leaves their rows alone", async () => {
    const mine = await publishedMenuIn(atelier.id, 'mine-slug');
    const theirs = await publishedMenuIn(bistro.id, 'their-slug');
    await prisma().menuSlug.create({ data: { slug: 'their-old', menuId: theirs.menu.id } });
    await prisma().menuSlug.create({ data: { slug: 'dead-slug', menuId: null } });
    for (const slug of ['their-slug', 'their-old', 'dead-slug']) {
      const error = failureOf(await run(admin, menus.changeMenuSlug, { menuId: mine.menu.id, slug, version: mine.menu.version }));
      expect(error, slug).toMatchObject({ code: 'INVALID', fields: { slug: 'This address is taken' } });
    }
    expect(await prisma().menuSlug.findUniqueOrThrow({ where: { slug: 'their-old' } })).toMatchObject({ menuId: theirs.menu.id });
    expect(await prisma().menuSlug.findUniqueOrThrow({ where: { slug: 'dead-slug' } })).toMatchObject({ menuId: null });
    expect((await prisma().menu.findUniqueOrThrow({ where: { id: mine.menu.id } })).slug).toBe('mine-slug');
  });

  it('conflicts with a publish made since the page was opened', async () => {
    const { menu } = await publishedMenuIn(atelier.id, 'pub-race');
    dataOf(await run(owner, menus.publish, { menuId: menu.id }));
    const error = failureOf(await run(designer, menus.changeMenuSlug, { menuId: menu.id, slug: 'pub-race-2', version: menu.version }));
    expect(error).toMatchObject({ code: 'CONFLICT', fields: { changedBy: 'Olive Owner' } });
  });

  it('is for those who may change menu settings', async () => {
    const { menu } = await publishedMenuIn(atelier.id, 'owner-slug');
    expect(codeOf(await run(owner, menus.changeMenuSlug, { menuId: menu.id, slug: 'owner-slug-2', version: menu.version }))).toBe('FORBIDDEN');
    expect(codeOf(await run(outsider, menus.changeMenuSlug, { menuId: menu.id, slug: 'owner-slug-2', version: menu.version }))).toBe('NOT_FOUND');
  });
});

describe('publish', () => {
  it('publishes and returns warnings; blocked publish returns the issues and makes no revision', async () => {
    // Three languages and an English-only product without an image: publishable, with warnings.
    const { menu, product } = await publishedMenuIn(atelier.id, 'pub-menu', { publish: false });
    const published = dataOf(await run(owner, menus.publish, { menuId: menu.id, note: 'First' }));
    expect(published).toMatchObject({ number: 1 });
    expect(published.warnings.map((issue) => issue.code).sort()).toEqual(['MISSING_TRANSLATION', 'MISSING_TRANSLATION', 'MISSING_TRANSLATION', 'MISSING_TRANSLATION', 'NO_IMAGE']);
    expect(published.warnings.every((issue) => issue.severity === 'warn')).toBe(true);
    expect(await prisma().menu.findUniqueOrThrow({ where: { id: menu.id } })).toMatchObject({ status: 'PUBLISHED', version: menu.version + 1 });
    expect((await resolvePublicMenu('pub-menu')).kind).toBe('live');
    expect(vi.mocked(expireMenu).mock.calls).toContainEqual([['pub-menu'], menu.id]);
    const audit = await prisma().auditLog.findFirstOrThrow({ where: { action: 'menu.published' } });
    expect(audit).toMatchObject({ actorId: owner.userId, entityType: 'Menu', entityId: menu.id, menuId: menu.id, restaurantId: atelier.id });
    expect(audit.changes).toMatchObject({ revision: { before: null, after: 1 } });
    expect((await prisma().menuRevision.findFirstOrThrow({ where: { menuId: menu.id } })).note).toBe('First');

    // A product without a price blocks it: the issues come back, nothing is written.
    await prisma().product.update({ where: { id: product.id }, data: { basePrice: 0 } });
    const blocked = failureOf(await run(owner, menus.publish, { menuId: menu.id }));
    expect(blocked.code).toBe('INVALID');
    expect(blocked.message).toBe('This menu cannot be published yet');
    expect(blocked.issues).toContainEqual(expect.objectContaining({ code: 'NO_PRICE', severity: 'block', entity: expect.objectContaining({ slug: product.slug }) }));
    expect(await prisma().menuRevision.count({ where: { menuId: menu.id } })).toBe(1);
    expect((await prisma().menu.findUniqueOrThrow({ where: { id: menu.id } })).version).toBe(menu.version + 1);
    expect(await prisma().auditLog.count({ where: { action: 'menu.published' } })).toBe(1);
  });

  it('refuses an archived menu as invalid and a missing one as not found', async () => {
    const { menu } = await publishedMenuIn(atelier.id, 'pub-archived');
    await prisma().menu.update({ where: { id: menu.id }, data: { status: 'ARCHIVED' } });
    expect(failureOf(await run(designer, menus.publish, { menuId: menu.id }))).toMatchObject({ code: 'INVALID', message: 'Archived menus cannot be published' });
    expect(codeOf(await run(admin, menus.publish, { menuId: 'no-such-menu' }))).toBe('NOT_FOUND');
    expect(codeOf(await run(outsider, menus.publish, { menuId: menu.id }))).toBe('NOT_FOUND');
  });
});

describe('changeMenuStatus', () => {
  it('suspends, restores, archives and restores again, taking the menu off the public page and back', async () => {
    const { menu } = await publishedMenuIn(atelier.id, 'status-menu');
    const change = async (action: string) => dataOf(await run(designer, menus.changeMenuStatus, { menuId: menu.id, action }));

    expect(await change('suspend')).toEqual({ status: 'SUSPENDED' });
    expect((await resolvePublicMenu('status-menu')).kind).toBe('unavailable');
    expect(await change('restore')).toEqual({ status: 'PUBLISHED' });
    expect((await resolvePublicMenu('status-menu')).kind).toBe('live');
    expect(await change('archive')).toEqual({ status: 'ARCHIVED' });
    expect(await prisma().menu.findUniqueOrThrow({ where: { id: menu.id } })).toMatchObject({ status: 'ARCHIVED', statusBeforeArchive: 'PUBLISHED' });
    expect((await resolvePublicMenu('status-menu')).kind).toBe('unavailable');
    expect(await change('restore')).toEqual({ status: 'PUBLISHED' });
    expect(await prisma().menu.findUniqueOrThrow({ where: { id: menu.id } })).toMatchObject({ statusBeforeArchive: null, version: menu.version });

    // The status is not a setting: it does not move the version, and its audit rows are filed apart from the menu's.
    const audits = await prisma().auditLog.findMany({ where: { action: 'menu.status_changed' }, orderBy: { occurredAt: 'asc' } });
    expect(audits).toHaveLength(4);
    expect(audits[0]).toMatchObject({ entityType: 'MenuStatus', entityId: menu.id, restaurantId: atelier.id, menuId: menu.id });
    expect(audits.map((row) => row.changes)).toEqual([
      { status: { before: 'PUBLISHED', after: 'SUSPENDED' } },
      { status: { before: 'SUSPENDED', after: 'PUBLISHED' } },
      { status: { before: 'PUBLISHED', after: 'ARCHIVED' } },
      { status: { before: 'ARCHIVED', after: 'PUBLISHED' } },
    ]);
    expect(vi.mocked(expireMenu)).toHaveBeenCalledTimes(4);
  });

  it('refuses a change the status does not allow, and those without the permission', async () => {
    const { menu } = await publishedMenuIn(atelier.id, 'status-draft', { publish: false });
    expect(failureOf(await run(designer, menus.changeMenuStatus, { menuId: menu.id, action: 'suspend' }))).toMatchObject({
      code: 'INVALID',
      message: 'This change is not possible from the current status',
    });
    expect(codeOf(await run(designer, menus.changeMenuStatus, { menuId: menu.id, action: 'delete' }))).toBe('INVALID');
    expect(codeOf(await run(owner, menus.changeMenuStatus, { menuId: menu.id, action: 'archive' }))).toBe('FORBIDDEN');
    expect((await prisma().menu.findUniqueOrThrow({ where: { id: menu.id } })).status).toBe('DRAFT');
  });
});

describe('duplicateMenu', () => {
  it('duplicates into a new independent draft: editing the copy leaves the source unchanged', async () => {
    const source = await publishedMenuIn(atelier.id, 'dup-source', { publish: false });
    const menuId = source.menu.id;
    // What is copied: the settings, the brand, the active catalog and the tables.
    await prisma().menu.update({ where: { id: menuId }, data: { currency: 'EUR', numeralSystem: 'ARAB', seo: { en: { title: 'T', description: 'D' } } } });
    await prisma().brandConfig.create({
      data: { menuId, tokens: { ...DEFAULT_PALETTES }, typography: { display: 'Serif' }, logoText: 'SOURCE', theme: 'LIGHT', navStyle: 'tabs' } as never,
    });
    await prisma().table.createMany({ data: [1, 2].map((number) => ({ menuId, number, label: `Table ${number}` })) });
    // What is not: a sold-out product's state, an inactive category with its products, an inactive rule.
    await prisma().product.update({ where: { id: source.product.id }, data: { isAvailable: false, stockCount: 3 } });
    const hiddenCategory = await prisma().category.create({ data: { menuId, slug: 'old', translations: { en: { name: 'Old' } }, isActive: false } });
    const oldProduct = await prisma().product.create({ data: { menuId, categoryId: hiddenCategory.id, slug: 'old-tea', basePrice: 100, translations: { en: { name: 'Tea' } } } });
    await prisma().upsellRule.create({ data: { menuId, sourceProductId: source.product.id, targetProductId: source.product.id, translations: {}, isActive: false } });
    await publishFixture(prisma(), menuId);

    const { menuId: copyId } = dataOf(await run(designer, menus.duplicateMenu, { menuId, name: 'Copy', slug: 'dup-copy' }));
    const copy = await prisma().menu.findUniqueOrThrow({
      where: { id: copyId },
      include: { brand: true, tables: true, products: true, categories: true, upsellRules: true, slugs: true },
    });
    expect(copy).toMatchObject({
      restaurantId: atelier.id,
      name: 'Copy',
      slug: 'dup-copy',
      status: 'DRAFT',
      currency: 'EUR',
      numeralSystem: 'ARAB',
      seo: { en: { title: 'T', description: 'D' } },
      liveRevisionId: null,
      liveHash: null,
    });
    expect(copy.slugs.map((entry) => entry.slug)).toEqual(['dup-copy']);
    expect(copy.brand).toMatchObject({ logoText: 'SOURCE', theme: 'LIGHT', navStyle: 'tabs', typography: { display: 'Serif' } });
    expect(copy.tables.map((table) => table.number).sort()).toEqual([1, 2]);
    expect(copy.categories.map((category) => category.slug)).toEqual(['coffee']);
    expect(copy.products.map((product) => [product.slug, product.isAvailable, product.stockCount])).toEqual([[source.product.slug, true, null]]);
    expect(copy.upsellRules).toEqual([]);
    expect(copy.draftHash).toBe(snapshotHash(await loadDraftSnapshot(prisma(), copyId)));
    expect((await resolvePublicMenu('dup-copy')).kind).toBe('missing');
    expect(vi.mocked(expireMenu).mock.calls).toContainEqual([['dup-copy'], copyId]);
    const audit = await prisma().auditLog.findFirstOrThrow({ where: { action: 'menu.duplicated' } });
    expect(audit).toMatchObject({ entityType: 'Menu', entityId: copyId, restaurantId: atelier.id, menuId: copyId });
    expect(audit.changes).toMatchObject({ duplicatedFrom: { before: null, after: menuId } });

    // The copy is its own: changing it leaves the source as it was.
    const sourceHash = (await prisma().menu.findUniqueOrThrow({ where: { id: menuId } })).draftHash;
    await prisma().product.updateMany({ where: { menuId: copyId }, data: { basePrice: 999 } });
    await prisma().category.updateMany({ where: { menuId: copyId }, data: { translations: { en: { name: 'Changed' } } } });
    await refreshDraftHash(prisma(), copyId);
    expect((await prisma().product.findUniqueOrThrow({ where: { id: source.product.id } })).basePrice).toBe(300);
    expect((await prisma().menu.findUniqueOrThrow({ where: { id: menuId } })).draftHash).toBe(sourceHash);
    expect(await prisma().product.findUnique({ where: { id: oldProduct.id } })).not.toBeNull();
  });

  it('refuses cross-restaurant duplicate for a designer', async () => {
    const source = await publishedMenuIn(atelier.id, 'dup-cross');
    // Even one who works on both restaurants.
    await prisma().membership.create({ data: { userId: designer.userId, restaurantId: bistro.id, role: 'DESIGNER' } });
    const both = (await loadActor(prisma(), designer.userId)) as Actor;
    const input = { menuId: source.menu.id, name: 'Elsewhere', slug: 'dup-elsewhere', targetRestaurantId: bistro.id };
    expect(codeOf(await run(both, menus.duplicateMenu, input))).toBe('FORBIDDEN');
    expect(codeOf(await run(owner, menus.duplicateMenu, { ...input, targetRestaurantId: undefined }))).toBe('FORBIDDEN');
    expect(await prisma().menu.count({ where: { slug: 'dup-elsewhere' } })).toBe(0);
    expect(await prisma().menuSlug.count({ where: { slug: 'dup-elsewhere' } })).toBe(0);
  });

  it('lets a Super Admin duplicate into another restaurant that exists', async () => {
    const source = await publishedMenuIn(atelier.id, 'dup-admin');
    const input = { menuId: source.menu.id, name: 'Bistro copy', slug: 'dup-bistro', targetRestaurantId: bistro.id };
    const { menuId } = dataOf(await run(admin, menus.duplicateMenu, input));
    expect(await prisma().menu.findUniqueOrThrow({ where: { id: menuId } })).toMatchObject({ restaurantId: bistro.id, status: 'DRAFT' });
    expect(await prisma().auditLog.findFirstOrThrow({ where: { action: 'menu.duplicated' } })).toMatchObject({ restaurantId: bistro.id, menuId });
    expect(codeOf(await run(admin, menus.duplicateMenu, { ...input, slug: 'dup-nowhere', targetRestaurantId: 'no-such-restaurant' }))).toBe('NOT_FOUND');
    // The new address is checked like any other.
    expect(failureOf(await run(admin, menus.duplicateMenu, { ...input, slug: 'dup-admin' }))).toMatchObject({ code: 'INVALID', fields: { slug: 'This address is taken' } });
  });
});

describe('deleteMenu', () => {
  it('deletes only an archived menu with the exact typed name and keeps its slugs as tombstones', async () => {
    const { menu } = await publishedMenuIn(atelier.id, 'del-menu');
    await prisma().menuSlug.create({ data: { slug: 'del-old', menuId: menu.id } });

    expect(failureOf(await run(admin, menus.deleteMenu, { menuId: menu.id, confirmName: menu.name }))).toMatchObject({
      code: 'INVALID',
      message: 'Archive the menu before deleting it',
    });
    dataOf(await run(admin, menus.changeMenuStatus, { menuId: menu.id, action: 'archive' }));
    for (const confirmName of ['', 'menu del-menu', 'Menu del', `${menu.name}!`]) {
      expect(failureOf(await run(admin, menus.deleteMenu, { menuId: menu.id, confirmName })), confirmName).toMatchObject({
        code: 'INVALID',
        fields: { confirmName: 'Type the menu name exactly to confirm' },
      });
    }
    // Only Super Admins delete, whatever the client policy says.
    await prisma().restaurant.update({ where: { id: atelier.id }, data: { permissionPolicy: { DESIGNER: { grant: ['menu.delete'], revoke: [] } } } });
    expect(codeOf(await run(designer, menus.deleteMenu, { menuId: menu.id, confirmName: menu.name }))).toBe('FORBIDDEN');
    expect(await prisma().menu.findUnique({ where: { id: menu.id } })).not.toBeNull();

    vi.mocked(expireMenu).mockClear();
    expect(dataOf(await run(admin, menus.deleteMenu, { menuId: menu.id, confirmName: ` ${menu.name} ` }))).toEqual({ deleted: true });
    expect(await prisma().menu.findUnique({ where: { id: menu.id } })).toBeNull();
    expect(await prisma().menuRevision.count({ where: { menuId: menu.id } })).toBe(0);
    const tombstones = await prisma().menuSlug.findMany({ where: { slug: { in: ['del-menu', 'del-old'] } } });
    expect(tombstones.map((row) => [row.slug, row.menuId]).sort()).toEqual([
      ['del-menu', null],
      ['del-old', null],
    ]);
    expect((await resolvePublicMenu('del-menu')).kind).toBe('missing');
    expect(vi.mocked(expireMenu).mock.calls.map(([slugs, id]) => [[...slugs].sort(), id])).toEqual([[['del-menu', 'del-old'], menu.id]]);
    const audit = await prisma().auditLog.findFirstOrThrow({ where: { action: 'menu.deleted' } });
    expect(audit).toMatchObject({ actorId: admin.userId, restaurantId: atelier.id, menuId: menu.id, entityType: 'Menu', entityId: menu.id });

    // Its addresses can never be taken again.
    expect(failureOf(await run(admin, menus.createMenu, { restaurantId: bistro.id, name: 'Reuse', slug: 'del-menu', ...SETTINGS }))).toMatchObject({
      fields: { slug: 'This address is taken' },
    });
  });
});

describe('deleteMenu racing a restore', () => {
  it('answers CONFLICT and deletes nothing when the menu is restored between the check and the delete', async () => {
    const { menu } = await publishedMenuIn(atelier.id, 'race-menu');
    dataOf(await run(admin, menus.changeMenuStatus, { menuId: menu.id, action: 'archive' }));
    const actual = await vi.importActual<typeof import('@/server/studio/services/menus')>('@/server/studio/services/menus');
    vi.mocked(menuSlugs).mockImplementationOnce(async (...args: Parameters<typeof actual.menuSlugs>) => {
      // The delete has read the menu as archived; somebody restores it now, before the delete runs.
      await prisma().menu.update({ where: { id: menu.id }, data: { status: 'PUBLISHED', statusBeforeArchive: null } });
      return actual.menuSlugs(...args);
    });

    vi.mocked(expireMenu).mockClear();
    expect(failureOf(await run(admin, menus.deleteMenu, { menuId: menu.id, confirmName: menu.name })).code).toBe('CONFLICT');

    // The live menu is still there, with its revision and its address, and nothing says it was deleted.
    expect(await prisma().menu.findUniqueOrThrow({ where: { id: menu.id } })).toMatchObject({ status: 'PUBLISHED', slug: 'race-menu' });
    expect(await prisma().menuRevision.count({ where: { menuId: menu.id } })).toBeGreaterThan(0);
    expect(await prisma().menuSlug.findUniqueOrThrow({ where: { slug: 'race-menu' } })).toMatchObject({ menuId: menu.id });
    expect(await prisma().auditLog.count({ where: { action: 'menu.deleted' } })).toBe(0);
    expect(vi.mocked(expireMenu)).not.toHaveBeenCalled();
    expect((await resolvePublicMenu('race-menu')).kind).toBe('live');
  });
});

describe('bulkMenuAction', () => {
  it('bulk-publishes 3 menus where one is blocked and reports each result', async () => {
    const first = await publishedMenuIn(atelier.id, 'bulk-a', { publish: false });
    const second = await publishedMenuIn(atelier.id, 'bulk-b', { publish: false });
    const blocked = await publishedMenuIn(atelier.id, 'bulk-c', { publish: false });
    await prisma().product.update({ where: { id: blocked.product.id }, data: { basePrice: 0 } });

    const { results } = dataOf(await run(designer, menus.bulkMenuAction, { menuIds: [first.menu.id, blocked.menu.id, second.menu.id], action: 'publish' }));
    expect(results.map((result) => [result.menuId, result.ok, result.code ?? null])).toEqual([
      [first.menu.id, true, null],
      [blocked.menu.id, false, 'INVALID'],
      [second.menu.id, true, null],
    ]);
    expect(results[1]!.issues).toContainEqual(expect.objectContaining({ code: 'NO_PRICE', severity: 'block' }));
    expect(await prisma().menu.count({ where: { id: { in: [first.menu.id, second.menu.id] }, status: 'PUBLISHED' } })).toBe(2);
    expect((await prisma().menu.findUniqueOrThrow({ where: { id: blocked.menu.id } })).status).toBe('DRAFT');
    // Each menu's publish is audited as a single publish would be.
    const audits = await prisma().auditLog.findMany({ where: { action: 'menu.published' } });
    expect(audits.map((row) => row.menuId).sort()).toEqual([first.menu.id, second.menu.id].sort());

    // A status change for several, each refused or done on its own.
    const archived = dataOf(await run(designer, menus.bulkMenuAction, { menuIds: [first.menu.id, blocked.menu.id], action: 'suspend' }));
    expect(archived.results.map((result) => [result.ok, result.code ?? null])).toEqual([
      [true, null],
      [false, 'INVALID'],
    ]);
    expect(await prisma().auditLog.count({ where: { action: 'menu.status_changed', entityType: 'MenuStatus' } })).toBe(1);
  });

  it('bulk action skips menus outside the designer scope with NOT_FOUND', async () => {
    const mine = await publishedMenuIn(atelier.id, 'bulk-mine');
    const theirs = await publishedMenuIn(bistro.id, 'bulk-theirs');
    const { results } = dataOf(await run(designer, menus.bulkMenuAction, { menuIds: [theirs.menu.id, mine.menu.id, 'no-such-menu'], action: 'archive' }));
    expect(results).toEqual([
      { menuId: theirs.menu.id, ok: false, code: 'NOT_FOUND' },
      { menuId: mine.menu.id, ok: true },
      { menuId: 'no-such-menu', ok: false, code: 'NOT_FOUND' },
    ]);
    expect((await prisma().menu.findUniqueOrThrow({ where: { id: theirs.menu.id } })).status).toBe('PUBLISHED');
    // An owner holds publish but not status: each menu says so.
    const asOwner = dataOf(await run(owner, menus.bulkMenuAction, { menuIds: [mine.menu.id], action: 'restore' }));
    expect(asOwner.results).toEqual([{ menuId: mine.menu.id, ok: false, code: 'FORBIDDEN' }]);
  });

  it('takes 1 to 200 different menus and one of the actions offered', async () => {
    expect(codeOf(await run(designer, menus.bulkMenuAction, { menuIds: [], action: 'publish' }))).toBe('INVALID');
    expect(codeOf(await run(designer, menus.bulkMenuAction, { menuIds: Array.from({ length: 201 }, (_, i) => `m${i}`), action: 'publish' }))).toBe('INVALID');
    expect(codeOf(await run(designer, menus.bulkMenuAction, { menuIds: ['a', 'a'], action: 'publish' }))).toBe('INVALID');
    expect(codeOf(await run(designer, menus.bulkMenuAction, { menuIds: ['a'], action: 'delete' }))).toBe('INVALID');
    const many = dataOf(await run(designer, menus.bulkMenuAction, { menuIds: Array.from({ length: 200 }, (_, i) => `m${i}`), action: 'archive' }));
    expect(many.results).toHaveLength(200);
  });
});

describe('listMenus', () => {
  const list = async (actor: Actor, input: Record<string, unknown> = {}) => dataOf(await ask(actor, menuQueries.listMenus, input));

  it('lists unpublished menus only after a draft edit', async () => {
    const { menu } = await publishedMenuIn(atelier.id, 'list-edit');
    await publishedMenuIn(atelier.id, 'list-never', { publish: false });
    expect((await list(admin, { unpublished: true })).rows).toEqual([]);
    expect((await list(admin)).rows.find((row) => row.id === menu.id)).toMatchObject({ unpublished: false, liveRevisionNumber: 1 });

    await addProduct(menu.id, 'latte', 450);
    const page = await list(admin, { unpublished: true });
    expect(page.rows.map((row) => row.slug)).toEqual(['list-edit']);
    expect(page.rows[0]).toMatchObject({ unpublished: true, liveRevisionNumber: 1 });

    dataOf(await run(admin, menus.publish, { menuId: menu.id }));
    expect((await list(admin, { unpublished: true })).total).toBe(0);
    expect((await list(admin)).rows.find((row) => row.id === menu.id)).toMatchObject({ unpublished: false, liveRevisionNumber: 2 });
  });

  it('finds a restaurant named "مطعم مازو" when searching "مازو"', async () => {
    const mazo = await prisma().restaurant.create({ data: { name: 'مطعم مازو', city: 'أربيل' } });
    await publishedMenuIn(mazo.id, 'mazo-menu');
    await publishedMenuIn(atelier.id, 'other-menu');
    expect((await list(admin, { q: 'مازو' })).rows.map((row) => row.slug)).toEqual(['mazo-menu']);
  });

  it('searches menu names, slugs, restaurant names and client IDs, literally', async () => {
    const lunch = await publishedMenuIn(atelier.id, 'lunch-menu');
    await prisma().menu.update({ where: { id: lunch.menu.id }, data: { name: '100% Lunch' } });
    await publishedMenuIn(bistro.id, 'bistro-dinner');
    const slugs = async (q: string) => (await list(admin, { q })).rows.map((row) => row.slug);
    expect(await slugs('lunch')).toEqual(['lunch-menu']);
    expect(await slugs('BISTRO-DIN')).toEqual(['bistro-dinner']);
    expect(await slugs('bistro')).toEqual(['bistro-dinner']);
    expect(await slugs(`BZ-${String(bistro.clientNumber).padStart(4, '0')}`)).toEqual(['bistro-dinner']);
    expect(await slugs('%')).toEqual(['lunch-menu']);
    expect(await slugs('nothing like it')).toEqual([]);
  });

  it('filters by city, status and restaurant and sorts by restaurant name', async () => {
    const zeta = await prisma().restaurant.create({ data: { name: 'Zeta', city: 'Erbil' } });
    await publishedMenuIn(atelier.id, 'f-atelier');
    const suspended = await publishedMenuIn(bistro.id, 'f-bistro');
    await prisma().menu.update({ where: { id: suspended.menu.id }, data: { status: 'SUSPENDED' } });
    await publishedMenuIn(zeta.id, 'f-zeta', { publish: false });
    const archived = await publishedMenuIn(zeta.id, 'f-zeta-old');
    await prisma().menu.update({ where: { id: archived.menu.id }, data: { status: 'ARCHIVED' } });
    const slugs = async (input: Record<string, unknown>) => (await list(admin, input)).rows.map((row) => row.slug);

    // Archived menus stay out of the list unless asked for.
    expect(await slugs({ sort: 'restaurant', dir: 'asc' })).toEqual(['f-atelier', 'f-bistro', 'f-zeta']);
    expect(await slugs({ sort: 'restaurant', dir: 'desc' })).toEqual(['f-zeta', 'f-bistro', 'f-atelier']);
    expect(await slugs({ status: 'ARCHIVED' })).toEqual(['f-zeta-old']);
    expect(await slugs({ status: 'SUSPENDED' })).toEqual(['f-bistro']);
    expect(await slugs({ status: 'DRAFT' })).toEqual(['f-zeta']);
    expect(await slugs({ city: 'erbil', sort: 'restaurant' })).toEqual(['f-atelier', 'f-zeta']);
    expect(await slugs({ restaurantId: zeta.id })).toEqual(['f-zeta']);
    expect(await slugs({ city: 'Erbil', status: 'PUBLISHED' })).toEqual(['f-atelier']);
    const page = await list(admin, { restaurantId: bistro.id });
    expect(page.rows[0]).toMatchObject({ restaurant: { id: bistro.id, name: 'Bistro', city: 'Duhok', status: 'ACTIVE' }, status: 'SUSPENDED' });
    expect(page.rows[0]!.restaurant.clientId).toMatch(/^BZ-\d{4,}$/);
    expect((await list(admin)).cities).toEqual(['Duhok', 'Erbil']);
  });

  it('filters by creation date, sorts by the other columns and pages by 50', async () => {
    const menusIn = await prisma().menu.createManyAndReturn({
      data: Array.from({ length: 52 }, (_, i) => ({
        restaurantId: atelier.id,
        name: `Menu ${String(i).padStart(2, '0')}`,
        slug: `page-${i}`,
        timezone: 'Asia/Baghdad',
        locales: ['en'],
        createdAt: new Date(Date.UTC(2026, 0, 1 + i, 9)),
      })),
    });
    expect(menusIn).toHaveLength(52);
    const first = await list(admin, { sort: 'name' });
    expect([first.total, first.rows.length, first.pageSize]).toEqual([52, 50, 50]);
    expect(first.rows[0]!.name).toBe('Menu 00');
    const second = await list(admin, { sort: 'name', page: 2 });
    expect(second.rows.map((row) => row.name)).toEqual(['Menu 50', 'Menu 51']);
    expect((await list(admin, { sort: 'createdAt', dir: 'desc' })).rows[0]!.name).toBe('Menu 51');
    expect((await list(admin, { createdFrom: '2026-01-03', createdTo: '2026-01-04' })).rows.map((row) => row.name)).toEqual(['Menu 02', 'Menu 03']);
    for (const bad of [{ sort: 'password' }, { page: 0 }, { pageSize: 500 }, { status: 'GONE' }, { createdFrom: 'soon' }]) {
      expect(codeOf(await ask(admin, menuQueries.listMenus, bad)), JSON.stringify(bad)).toBe('INVALID');
    }
  });

  it('shows a designer the menus of their restaurants only, with what they may do to each', async () => {
    await publishedMenuIn(atelier.id, 'scope-mine');
    await publishedMenuIn(bistro.id, 'scope-theirs');
    const page = await list(designer);
    expect(page.rows.map((row) => row.slug)).toEqual(['scope-mine']);
    expect(page.rows[0]!.can).toEqual({ publish: true, status: true, duplicate: true });
    expect(page.cities).toEqual(['Erbil']);
    expect(page.restaurants.map((restaurant) => restaurant.name)).toEqual(['Atelier']);
    expect((await list(designer, { restaurantId: bistro.id })).total).toBe(0);
    expect((await list(designer, { q: 'scope-theirs' })).total).toBe(0);
    expect((await list(owner)).rows[0]!.can).toEqual({ publish: true, status: false, duplicate: false });
    expect(page.canCreate).toBe(true);
    expect((await list(owner)).canCreate).toBe(false);
  });
});

describe('getMenu', () => {
  it('gives the live revision, who published it, the public URL and the draft issues', async () => {
    const { menu } = await publishedMenuIn(atelier.id, 'get-menu', { publish: false });
    dataOf(await run(owner, menus.publish, { menuId: menu.id }));
    await addProduct(menu.id, 'free-thing', 0);

    const view = dataOf(await ask(owner, menuQueries.getMenu, { menuId: menu.id }));
    expect(view).toMatchObject({
      id: menu.id,
      name: menu.name,
      slug: 'get-menu',
      status: 'PUBLISHED',
      restaurant: { id: atelier.id, name: 'Atelier' },
      liveRevision: { number: 1, publishedBy: 'Olive Owner' },
      unpublished: true,
      can: { publish: true, status: false, settings: false, duplicate: false, delete: false },
    });
    expect(view.publicUrl).toMatch(/^https?:\/\/[^/]+\/get-menu$/);
    expect(view.liveRevision!.wentLiveAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(view.issues).toContainEqual(expect.objectContaining({ code: 'NO_PRICE', severity: 'block' }));
    expect(view.formerSlugs).toEqual([]);
    expect(dataOf(await ask(admin, menuQueries.getMenu, { menuId: menu.id })).can).toMatchObject({ delete: true, duplicateElsewhere: true });
    expect(codeOf(await ask(outsider, menuQueries.getMenu, { menuId: menu.id }))).toBe('NOT_FOUND');
  });
});
