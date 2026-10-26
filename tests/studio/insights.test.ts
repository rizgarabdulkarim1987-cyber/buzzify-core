import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPrisma } from '@/server/data/prisma';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { runQuery } from '@/server/studio/framework/query';
import type { ActionResult } from '@/server/studio/framework/result';
import * as salesQueries from '@/server/studio/queries/sales';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { createMenuFixture, requireTestDb, resetTestData } from '../helpers/db';

/** The Sales tab's Overview (docs/superpowers/plans/2026-10-18-sales-tools.md, Task 12). */

const prisma = () => getPrisma();
const dataOf = <T>(result: ActionResult<T>): T => {
  if (!result.ok) throw new Error(`expected success, got ${JSON.stringify(result.error)}`);
  return result.data;
};

let a: Awaited<ReturnType<typeof createMenuFixture>>;
let b: Awaited<ReturnType<typeof createMenuFixture>>;
let owner: Actor;
const ids: Record<string, string> = {};
const DAY = 86_400_000;

const overview = () => runQuery(prisma(), owner, salesQueries.overview, { menuId: a.menu.id });

/** One guest session doing something with a dish or a suggestion, `daysAgo` days ago. */
async function event(menuId: string, session: string, type: string, extra: { productId?: string; suggestionId?: string } = {}, daysAgo = 1) {
  await prisma().analyticsEvent.create({
    data: { menuId, anonymousSessionId: session, type: type as never, ...extra, occurredAt: new Date(Date.now() - daysAgo * DAY) },
  });
}

/** `count` sessions adding the dish. */
async function adds(name: string, count: number, daysAgo = 1) {
  for (let i = 0; i < count; i++) await event(a.menu.id, `${name}-${i}`, 'ADD_TO_CART', { productId: ids[name] }, daysAgo);
}

beforeAll(() => {
  requireTestDb();
  vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
});

beforeEach(async () => {
  await resetTestData(prisma());
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  a = await createMenuFixture(prisma(), 'insights-a');
  b = await createMenuFixture(prisma(), 'insights-b');
  await prisma().product.update({ where: { id: a.product.id }, data: { cost: 100 } });
  ids.espresso = a.product.id;
  for (const [slug, price, cost] of [
    ['star', 1000, 200],
    ['plowhorse', 1000, 800],
    ['puzzle', 1000, 200],
    ['dog', 1000, 800],
  ] as const) {
    ids[slug] = (await prisma().product.create({ data: { menuId: a.menu.id, categoryId: a.category.id, slug, basePrice: price, cost, translations: { en: { name: slug } } } })).id;
  }
  await prisma().user.create({ data: { id: 'owner-a', name: 'Alpha Owner', email: 'owner-a@example.com' } });
  await prisma().membership.create({ data: { userId: 'owner-a', restaurantId: a.restaurant.id, role: 'OWNER' } });
  owner = (await loadActor(prisma(), 'owner-a')) as Actor;
});

afterAll(async () => {
  await resetTestData(prisma());
});

describe('the Sales overview', () => {
  it('classes each dish by the guests who added it in 30 days and what it earns', async () => {
    await adds('star', 40);
    await adds('plowhorse', 40);
    await adds('puzzle', 5);
    await adds('dog', 5);
    await adds('espresso', 10);
    await adds('dog', 50, 31);
    await event(b.menu.id, 'other-menu', 'ADD_TO_CART', { productId: b.product.id });
    const read = dataOf(await overview());
    const classes = Object.fromEntries(read.dishes.map((dish) => [dish.names.en, [dish.dishClass, dish.sessions]]));
    expect(classes).toMatchObject({ star: ['STAR', 40], plowhorse: ['PLOWHORSE', 40], puzzle: ['PUZZLE', 5], dog: ['DOG', 5] });
    expect(read.totalSessions).toBe(100);
    expect(read.insightsAllowed).toBe(true);
  });

  it('counts each guest once per dish, from adds and accepted pairings', async () => {
    await event(a.menu.id, 's1', 'ADD_TO_CART', { productId: ids.star });
    await event(a.menu.id, 's1', 'ADD_TO_CART', { productId: ids.star });
    await event(a.menu.id, 's2', 'PAIRING_ADD', { productId: ids.star, suggestionId: `pair:${ids.star}` });
    expect(dataOf(await overview()).dishes.find((dish) => dish.productId === ids.star)?.sessions).toBe(2);
  });

  it('counts how many guests saw and took each kind of suggestion', async () => {
    await event(a.menu.id, 's1', 'UPSELL_IMPRESSION', { suggestionId: `up:${ids.star}:SWAP:${ids.puzzle}` });
    await event(a.menu.id, 's1', 'UPSELL_ACCEPT', { suggestionId: `up:${ids.star}:SWAP:${ids.puzzle}` });
    await event(a.menu.id, 's2', 'UPSELL_IMPRESSION', { suggestionId: `up:${ids.star}:SWAP:${ids.puzzle}` });
    await event(a.menu.id, 's1', 'PAIRING_IMPRESSION', { suggestionId: `pair:${ids.dog}` });
    await event(a.menu.id, 's3', 'PAIRING_IMPRESSION', { suggestionId: `meal:${ids.dog}` });
    await event(a.menu.id, 's3', 'PAIRING_ADD', { suggestionId: `meal:${ids.dog}`, productId: ids.dog });
    await event(a.menu.id, 's4', 'BUNDLE_IMPRESSION', { suggestionId: 'bundle:x' });
    expect(dataOf(await overview()).suggestions).toEqual([
      { kind: 'upgrade', shown: 2, accepted: 1 },
      { kind: 'pairing', shown: 1, accepted: 0 },
      { kind: 'set', shown: 1, accepted: 0 },
      { kind: 'meal', shown: 1, accepted: 1 },
    ]);
  });

  it('gives the advisor for the draft on every plan, and the insights only with them in the plan', async () => {
    await adds('star', 3);
    await prisma().restaurant.update({ where: { id: a.restaurant.id }, data: { plan: 'BASIC' } });
    owner = (await loadActor(prisma(), 'owner-a')) as Actor;
    const read = dataOf(await overview());
    expect(read.insightsAllowed).toBe(false);
    expect(read.dishes).toEqual([]);
    expect(read.suggestions).toEqual([]);
    expect(read.advice.map((advice) => advice.code)).toContain('NO_RULES');
    expect(read.upgrade.allowed).not.toContain('selling.insights');
  });
});
