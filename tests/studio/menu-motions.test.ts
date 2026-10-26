import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPrisma } from '@/server/data/prisma';
import { loadDraftSnapshot } from '@/server/publish/draft';
import * as menus from '@/server/studio/actions/menus';
import * as motions from '@/server/studio/actions/motions';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { createPasswordUser } from '@/server/studio/auth/users';
import { runAction, type ActionDef } from '@/server/studio/framework/action';
import { runQuery } from '@/server/studio/framework/query';
import type { ActionResult } from '@/server/studio/framework/result';
import * as motionQueries from '@/server/studio/queries/motions';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { createMenuFixture, requireTestDb, resetTestData } from '../helpers/db';

/** The Motion tab's actions and query (spec: 2026-10-18-menu-motions-design.md, sections 8 and 10). */

const prisma = () => getPrisma();
const META = { ip: '203.0.113.8', userAgent: 'vitest' };

const dataOf = <T>(result: ActionResult<T>): T => {
  if (!result.ok) throw new Error(`expected success, got ${JSON.stringify(result.error)}`);
  return result.data;
};
const failureOf = (result: ActionResult<unknown>) => {
  if (result.ok) throw new Error(`expected a failure, got ${JSON.stringify(result.data)}`);
  return result.error;
};

let a: Awaited<ReturnType<typeof createMenuFixture>>;
let designer: Actor;
let owner: Actor;

const run = <I, O>(def: ActionDef<I, O>, input: unknown, actor: Actor = designer) => runAction(prisma(), actor, def, input, META);

/** A save of golden particles at the top of A's menu, with `overrides`. */
const hero = (overrides: Record<string, unknown> = {}) => ({
  menuId: a.menu.id,
  place: 'hero',
  motionId: 'golden-particles',
  params: { count: 200 },
  texts: {},
  version: null,
  ...overrides,
});

beforeAll(() => {
  requireTestDb();
  vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
});

beforeEach(async () => {
  await resetTestData(prisma());
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  a = await createMenuFixture(prisma(), 'motions-studio-a');
  await prisma().user.create({ data: { id: 'designer-a', name: 'Alpha Designer', email: 'designer-a@example.com' } });
  await prisma().membership.create({ data: { userId: 'designer-a', restaurantId: a.restaurant.id, role: 'DESIGNER' } });
  await prisma().user.create({ data: { id: 'owner-a', name: 'Alpha Owner', email: 'owner-a@example.com' } });
  await prisma().membership.create({ data: { userId: 'owner-a', restaurantId: a.restaurant.id, role: 'OWNER' } });
  designer = (await loadActor(prisma(), 'designer-a')) as Actor;
  owner = (await loadActor(prisma(), 'owner-a')) as Actor;
});

afterAll(async () => {
  await resetTestData(prisma());
});

describe('placing a motion', () => {
  it('places a motion, moves the draft hash, and writes it to the audit log', async () => {
    const before = (await prisma().menu.findUniqueOrThrow({ where: { id: a.menu.id } })).draftHash;
    expect(dataOf(await run(motions.save, hero()))).toEqual({ version: 1 });
    const row = await prisma().menuMotion.findFirstOrThrow({ where: { menuId: a.menu.id } });
    expect(row).toMatchObject({ slot: 'hero', categoryId: null, motionId: 'golden-particles', version: 1 });
    expect(row.params).toMatchObject({ count: 200 });
    expect((await prisma().menu.findUniqueOrThrow({ where: { id: a.menu.id } })).draftHash).not.toBe(before);
    const audit = await prisma().auditLog.findFirstOrThrow({ where: { action: 'motion.placed' } });
    expect(audit).toMatchObject({ entityType: 'MenuMotion', entityId: row.id, menuId: a.menu.id });
    expect(audit.changes).toMatchObject({ motionId: { before: null, after: 'golden-particles' } });
    expect((await loadDraftSnapshot(prisma(), a.menu.id)).motions).toHaveLength(1);
  });

  it('tunes a placed motion at its version, and saves texts per language', async () => {
    dataOf(await run(motions.save, hero()));
    const saved = dataOf(await run(motions.save, hero({ motionId: 'text-reveal', params: {}, texts: { text: { en: 'Fresh', ar: 'طازج', fr: 'x' } }, version: 1 })));
    expect(saved).toEqual({ version: 2 });
    const row = await prisma().menuMotion.findFirstOrThrow({ where: { menuId: a.menu.id } });
    expect(row).toMatchObject({ motionId: 'text-reveal', texts: { text: { en: 'Fresh', ar: 'طازج' } } });
  });

  it('places a motion over a category of the menu', async () => {
    dataOf(await run(motions.save, hero({ place: 'category', categoryId: a.category.id, motionId: 'coffee-steam' })));
    expect(await prisma().menuMotion.findFirstOrThrow({ where: { menuId: a.menu.id } })).toMatchObject({
      slot: `category:${a.category.id}`,
      categoryId: a.category.id,
    });
  });

  it('refuses a motion the place does not offer, and a place that does not exist', async () => {
    expect(failureOf(await run(motions.save, hero({ motionId: 'add-to-cart' })))).toMatchObject({ code: 'INVALID', fields: { motionId: expect.any(String) } });
    expect(failureOf(await run(motions.save, hero({ place: 'roof' })))).toMatchObject({ code: 'INVALID' });
    expect(failureOf(await run(motions.save, hero({ place: 'category' })))).toMatchObject({ code: 'INVALID', fields: { categoryId: expect.any(String) } });
    expect(await prisma().menuMotion.count()).toBe(0);
  });

  it('refuses a category of another menu', async () => {
    const b = await createMenuFixture(prisma(), 'motions-studio-b');
    expect(failureOf(await run(motions.save, hero({ place: 'category', categoryId: b.category.id })))).toMatchObject({ code: 'NOT_FOUND' });
    expect(await prisma().menuMotion.count()).toBe(0);
  });

  it('refuses a stale save, and a second fill of an empty place, leaving one row', async () => {
    dataOf(await run(motions.save, hero()));
    expect(failureOf(await run(motions.save, hero({ motionId: 'aurora-background' })))).toMatchObject({ code: 'CONFLICT' });
    dataOf(await run(motions.save, hero({ version: 1, params: { count: 300 } })));
    expect(failureOf(await run(motions.save, hero({ version: 1, params: { count: 100 } })))).toMatchObject({ code: 'CONFLICT', fields: { changedBy: 'Alpha Designer' } });
    expect(await prisma().menuMotion.count()).toBe(1);
  });

  it('removes a motion at its version', async () => {
    dataOf(await run(motions.save, hero()));
    expect(failureOf(await run(motions.remove, { menuId: a.menu.id, place: 'hero', version: 7 }))).toMatchObject({ code: 'CONFLICT' });
    expect(dataOf(await run(motions.remove, { menuId: a.menu.id, place: 'hero', version: 1 }))).toEqual({ removed: true });
    expect(await prisma().menuMotion.count()).toBe(0);
    expect(await prisma().auditLog.count({ where: { action: 'motion.removed' } })).toBe(1);
  });

  it('is the designers’: an owner without the brand permission is refused', async () => {
    expect(failureOf(await run(motions.save, hero(), owner))).toMatchObject({ code: 'FORBIDDEN' });
    expect(failureOf(await runQuery(prisma(), owner, motionQueries.list, { menuId: a.menu.id }))).toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('the plan', () => {
  beforeEach(async () => {
    dataOf(await run(motions.save, hero()));
    await prisma().restaurant.update({ where: { id: a.restaurant.id }, data: { plan: 'BASIC' } });
  });

  it('refuses a new motion on a plan without the feature, naming the plan that has it', async () => {
    const error = failureOf(await run(motions.save, hero({ place: 'signature', motionId: 'soft-glow' })));
    expect(error).toMatchObject({ code: 'UPGRADE_REQUIRED', upgrade: { feature: 'design.menuMotions', plan: 'PRO' } });
    expect(failureOf(await run(motions.save, hero({ motionId: 'aurora-background', version: 1 })))).toMatchObject({ code: 'UPGRADE_REQUIRED' });
  });

  it('keeps a motion already placed, even tuned, and lets it be removed', async () => {
    expect(dataOf(await run(motions.save, hero({ params: { count: 360 }, version: 1 })))).toEqual({ version: 2 });
    expect(dataOf(await run(motions.remove, { menuId: a.menu.id, place: 'hero', version: 2 }))).toEqual({ removed: true });
  });

  it('drops the motions of a menu duplicated into a restaurant without the feature', async () => {
    const { userId } = await createPasswordUser(prisma(), { email: 'admin@example.com', name: 'Admin', password: 'correct horse battery staple', isSuperAdmin: true });
    await prisma().user.update({ where: { id: userId }, data: { twoFactorEnabled: true } });
    const admin = (await loadActor(prisma(), userId)) as Actor;
    await prisma().restaurant.update({ where: { id: a.restaurant.id }, data: { plan: 'PREMIUM' } });
    const basic = await prisma().restaurant.create({ data: { name: 'Basic place', plan: 'BASIC' } });
    const premium = await prisma().restaurant.create({ data: { name: 'Premium place', plan: 'PREMIUM' } });

    const intoBasic = dataOf(await run(menus.duplicateMenu, { menuId: a.menu.id, name: 'Copy', slug: 'motions-copy-basic', targetRestaurantId: basic.id }, admin));
    expect(await prisma().menuMotion.count({ where: { menuId: intoBasic.menuId } })).toBe(0);
    const intoPremium = dataOf(await run(menus.duplicateMenu, { menuId: a.menu.id, name: 'Copy', slug: 'motions-copy-premium', targetRestaurantId: premium.id }, admin));
    expect(await prisma().menuMotion.count({ where: { menuId: intoPremium.menuId } })).toBe(1);
  });
});

describe('the Motion tab’s view', () => {
  it('lists the places in order, with the stored motions, the page colour and the plan', async () => {
    dataOf(await run(motions.save, hero()));
    const view = dataOf(await runQuery(prisma(), designer, motionQueries.list, { menuId: a.menu.id }));
    expect(view.places.map((p) => [p.place, p.categoryId ?? null, p.name, p.motion?.motionId ?? null])).toEqual([
      ['hero', null, '', 'golden-particles'],
      ['signature', null, '', null],
      ['category', a.category.id, 'Coffee', null],
    ]);
    expect(view).toMatchObject({ locales: ['en', 'ar', 'ckb'], defaultLocale: 'en', hasSignature: false, allowed: true, upgrade: null, motionIntensity: 'subtle' });
    expect(view.pageBackground).toMatch(/^#[0-9a-f]{6}$/i);
    expect(view.places[0]!.motion).toMatchObject({ version: 1, params: { count: 200 } });

    await prisma().restaurant.update({ where: { id: a.restaurant.id }, data: { plan: 'BASIC' } });
    const basic = dataOf(await runQuery(prisma(), designer, motionQueries.list, { menuId: a.menu.id }));
    expect(basic).toMatchObject({ allowed: false, upgrade: expect.objectContaining({ lowest: expect.objectContaining({ 'design.menuMotions': 'PRO' }) }) });
  });
});
