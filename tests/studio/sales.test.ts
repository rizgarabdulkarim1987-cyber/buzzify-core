import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPrisma } from '@/server/data/prisma';
import { loadDraftSnapshot } from '@/server/publish/draft';
import * as sales from '@/server/studio/actions/sales';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { runAction, type ActionDef } from '@/server/studio/framework/action';
import { runQuery } from '@/server/studio/framework/query';
import type { ActionResult } from '@/server/studio/framework/result';
import * as salesQueries from '@/server/studio/queries/sales';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { createMenuFixture, requireTestDb, resetTestData } from '../helpers/db';

const prisma = () => getPrisma();
const META = { ip: '203.0.113.7', userAgent: 'vitest' };

const dataOf = <T>(result: ActionResult<T>): T => {
  if (!result.ok) throw new Error(`expected success, got ${JSON.stringify(result.error)}`);
  return result.data;
};
const failureOf = (result: ActionResult<unknown>) => {
  if (result.ok) throw new Error(`expected a failure, got ${JSON.stringify(result.data)}`);
  return result.error;
};

let a: Awaited<ReturnType<typeof createMenuFixture>>;
let b: Awaited<ReturnType<typeof createMenuFixture>>;
let owner: Actor;
let latte: string;
let cake: string;
let cakes: string;

const run = <I, O>(def: ActionDef<I, O>, input: unknown, actor: Actor = owner) => runAction(prisma(), actor, def, input, META);
const rules = (actor: Actor = owner) => runQuery(prisma(), actor, salesQueries.rules, { menuId: a.menu.id });
const auditActions = async () => (await prisma().auditLog.findMany({ orderBy: { occurredAt: 'asc' } })).map((row) => row.action);

beforeAll(() => {
  requireTestDb();
  vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
});

beforeEach(async () => {
  await resetTestData(prisma());
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  a = await createMenuFixture(prisma(), 'sales-a');
  b = await createMenuFixture(prisma(), 'sales-b');
  latte = (await prisma().product.create({ data: { menuId: a.menu.id, categoryId: a.category.id, slug: 'latte', basePrice: 450, translations: { en: { name: 'Latte' } } } })).id;
  cakes = (await prisma().category.create({ data: { menuId: a.menu.id, slug: 'cakes', sortOrder: 1, translations: { en: { name: 'Cakes' } } } })).id;
  cake = (await prisma().product.create({ data: { menuId: a.menu.id, categoryId: cakes, slug: 'cake', basePrice: 500, translations: { en: { name: 'Cake' } } } })).id;
  await prisma().user.create({ data: { id: 'owner-a', name: 'Alpha Owner', email: 'owner-a@example.com' } });
  await prisma().membership.create({ data: { userId: 'owner-a', restaurantId: a.restaurant.id, role: 'OWNER' } });
  owner = (await loadActor(prisma(), 'owner-a')) as Actor;
});

afterAll(async () => {
  await resetTestData(prisma());
});

const upgrade = (overrides: Record<string, unknown> = {}) => ({
  menuId: a.menu.id,
  sourceProductId: a.product.id,
  targetProductId: latte,
  pitch: { en: 'Make it a latte', ar: 'اجعلها لاتيه' },
  effect: { en: 'Steamed milk and a double shot' },
  priority: 75,
  dayparts: ['BREAKFAST'],
  isActive: true,
  ...overrides,
});

describe('upgrade rules', () => {
  it('creates a rule the published menu carries, and audits it', async () => {
    const saved = dataOf(await run(sales.saveUpgrade, upgrade()));
    expect(saved.version).toBe(1);
    const row = await prisma().upsellRule.findUniqueOrThrow({ where: { id: saved.id } });
    expect(row).toMatchObject({
      sourceProductId: a.product.id,
      targetProductId: latte,
      priority: 75,
      dayparts: ['BREAKFAST'],
      isActive: true,
      translations: { en: { pitch: 'Make it a latte', effect: 'Steamed milk and a double shot' }, ar: { pitch: 'اجعلها لاتيه' } },
    });
    const draft = await loadDraftSnapshot(prisma(), a.menu.id);
    expect(draft.catalog.upsellRules.map((rule) => rule.id)).toEqual([saved.id]);
    const menu = await prisma().menu.findUniqueOrThrow({ where: { id: a.menu.id } });
    expect(menu.draftHash).not.toBe(menu.liveHash);
    expect(await auditActions()).toContain('upgrade.created');
  });

  it('edits a rule at the version read and refuses an older one', async () => {
    const saved = dataOf(await run(sales.saveUpgrade, upgrade()));
    const edited = dataOf(await run(sales.saveUpgrade, upgrade({ ruleId: saved.id, version: 1, priority: 100, isActive: false })));
    expect(edited.version).toBe(2);
    expect(await prisma().upsellRule.findUniqueOrThrow({ where: { id: saved.id } })).toMatchObject({ priority: 100, isActive: false, version: 2 });
    expect(failureOf(await run(sales.saveUpgrade, upgrade({ ruleId: saved.id, version: 1 }))).code).toBe('CONFLICT');
    expect(await auditActions()).toContain('upgrade.updated');
  });

  it('deletes a rule at its version', async () => {
    const saved = dataOf(await run(sales.saveUpgrade, upgrade()));
    expect(failureOf(await run(sales.deleteUpgrade, { menuId: a.menu.id, ruleId: saved.id, version: 3 })).code).toBe('CONFLICT');
    dataOf(await run(sales.deleteUpgrade, { menuId: a.menu.id, ruleId: saved.id, version: 1 }));
    expect(await prisma().upsellRule.count()).toBe(0);
    expect(await auditActions()).toContain('upgrade.deleted');
  });

  it('refuses an upgrade to the same dish, a second one between the same dishes, and a dish of another menu', async () => {
    expect(failureOf(await run(sales.saveUpgrade, upgrade({ targetProductId: a.product.id }))).fields).toHaveProperty('targetProductId');
    dataOf(await run(sales.saveUpgrade, upgrade()));
    expect(failureOf(await run(sales.saveUpgrade, upgrade())).fields).toHaveProperty('targetProductId');
    expect(failureOf(await run(sales.saveUpgrade, upgrade({ targetProductId: b.product.id }))).code).toBe('NOT_FOUND');
  });

  it('needs smart selling in the plan', async () => {
    await prisma().restaurant.update({ where: { id: a.restaurant.id }, data: { plan: 'BASIC' } });
    owner = (await loadActor(prisma(), 'owner-a')) as Actor;
    expect(failureOf(await run(sales.saveUpgrade, upgrade())).code).toBe('UPGRADE_REQUIRED');
  });

  it('is not found for someone outside the restaurant', async () => {
    await prisma().user.create({ data: { id: 'owner-b', name: 'Beta Owner', email: 'owner-b@example.com' } });
    await prisma().membership.create({ data: { userId: 'owner-b', restaurantId: b.restaurant.id, role: 'OWNER' } });
    const stranger = (await loadActor(prisma(), 'owner-b')) as Actor;
    expect(failureOf(await run(sales.saveUpgrade, upgrade(), stranger)).code).toBe('NOT_FOUND');
  });
});

const pairing = (overrides: Record<string, unknown> = {}) => ({
  menuId: a.menu.id,
  source: { kind: 'CATEGORY', id: a.category.id },
  targetProductId: cake,
  reason: { en: 'Coffee loves cake' },
  weight: 50,
  dayparts: [],
  isActive: true,
  ...overrides,
});

describe('pairing rules', () => {
  it('pairs a category with a dish, edits and deletes the pairing', async () => {
    const saved = dataOf(await run(sales.savePairing, pairing()));
    expect(await prisma().pairingRule.findUniqueOrThrow({ where: { id: saved.id } })).toMatchObject({
      sourceType: 'CATEGORY',
      sourceCategoryId: a.category.id,
      sourceProductId: null,
      targetProductId: cake,
      weight: 50,
      translations: { en: { reason: 'Coffee loves cake' } },
    });
    const edited = dataOf(await run(sales.savePairing, pairing({ ruleId: saved.id, version: 1, source: { kind: 'PRODUCT', id: latte }, weight: 100 })));
    expect(await prisma().pairingRule.findUniqueOrThrow({ where: { id: saved.id } })).toMatchObject({
      sourceType: 'PRODUCT',
      sourceProductId: latte,
      sourceCategoryId: null,
      weight: 100,
      version: edited.version,
    });
    dataOf(await run(sales.deletePairing, { menuId: a.menu.id, ruleId: saved.id, version: edited.version }));
    expect(await prisma().pairingRule.count()).toBe(0);
    expect(await auditActions()).toEqual(expect.arrayContaining(['pairing.created', 'pairing.updated', 'pairing.deleted']));
  });

  it('refuses a dish paired with itself and a category of another menu', async () => {
    expect(failureOf(await run(sales.savePairing, pairing({ source: { kind: 'PRODUCT', id: cake } }))).fields).toHaveProperty('targetProductId');
    expect(failureOf(await run(sales.savePairing, pairing({ source: { kind: 'CATEGORY', id: b.category.id } }))).code).toBe('NOT_FOUND');
  });
});

describe('the rules the Sales tab reads', () => {
  it('lists the dishes, categories and both kinds of rule with their texts', async () => {
    const up = dataOf(await run(sales.saveUpgrade, upgrade()));
    const pair = dataOf(await run(sales.savePairing, pairing()));
    const read = dataOf(await rules());
    expect(read.currency).toBe('USD');
    expect(read.products.map((p) => p.id).sort()).toEqual([a.product.id, latte, cake].sort());
    expect(read.categories.map((c) => c.id)).toEqual([a.category.id, cakes]);
    expect(read.upgrades).toEqual([
      {
        id: up.id,
        version: 1,
        sourceProductId: a.product.id,
        targetProductId: latte,
        pitch: { en: 'Make it a latte', ar: 'اجعلها لاتيه' },
        effect: { en: 'Steamed milk and a double shot' },
        priority: 75,
        dayparts: ['BREAKFAST'],
        isActive: true,
      },
    ]);
    expect(read.pairings).toEqual([
      { id: pair.id, version: 1, sourceType: 'CATEGORY', sourceId: a.category.id, targetProductId: cake, reason: { en: 'Coffee loves cake' }, weight: 50, dayparts: [], isActive: true },
    ]);
  });
});
