import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPrisma } from '@/server/data/prisma';
import * as availability from '@/server/studio/actions/availability';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { runAction, type ActionDef } from '@/server/studio/framework/action';
import { runQuery } from '@/server/studio/framework/query';
import type { ActionResult } from '@/server/studio/framework/result';
import * as availabilityQueries from '@/server/studio/queries/availability';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { createMenuFixture, requireTestDb, resetTestData } from '../helpers/db';

const prisma = () => getPrisma();
const META = { ip: '203.0.113.7', userAgent: 'vitest' };
const HOUR = 3_600_000;
const inHours = (hours: number) => new Date(Date.now() + hours * HOUR).toISOString();

const dataOf = <T>(result: ActionResult<T>): T => {
  if (!result.ok) throw new Error(`expected success, got ${JSON.stringify(result.error)}`);
  return result.data;
};
const failureOf = (result: ActionResult<unknown>) => {
  if (result.ok) throw new Error(`expected a failure, got ${JSON.stringify(result.data)}`);
  return result.error;
};

let a: Awaited<ReturnType<typeof createMenuFixture>>;
let owner: Actor;

const run = <I, O>(def: ActionDef<I, O>, input: unknown) => runAction(prisma(), owner, def, input, META);
const drop = (startsAt: string | null, endsAt: string | null) => run(availability.setDrop, { menuId: a.menu.id, productId: a.product.id, startsAt, endsAt });
const row = () => prisma().product.findUniqueOrThrow({ where: { id: a.product.id } });

beforeAll(() => {
  requireTestDb();
  vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
});

beforeEach(async () => {
  await resetTestData(prisma());
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  a = await createMenuFixture(prisma(), 'limited-drops-studio');
  await prisma().user.create({ data: { id: 'owner-drops', name: 'Drops Owner', email: 'owner-drops@example.com' } });
  await prisma().membership.create({ data: { userId: 'owner-drops', restaurantId: a.restaurant.id, role: 'OWNER' } });
  owner = (await loadActor(prisma(), 'owner-drops')) as Actor;
});

afterAll(async () => {
  await resetTestData(prisma());
});

describe('setting a limited drop', () => {
  it('saves the window, audits it, and clears it again', async () => {
    const start = inHours(1);
    const end = inHours(5);
    expect(dataOf(await drop(start, end))).toEqual({ startsAt: start, endsAt: end });
    expect((await row()).dropEndsAt?.toISOString()).toBe(end);
    expect(await prisma().auditLog.count({ where: { action: 'product.drop_changed' } })).toBe(1);
    dataOf(await drop(null, null));
    expect(await row()).toMatchObject({ dropStartsAt: null, dropEndsAt: null });
  });

  it('refuses a window with one end, an end before the start, or an end already past', async () => {
    expect(failureOf(await drop(inHours(1), null)).code).toBe('INVALID');
    expect(failureOf(await drop(inHours(5), inHours(2))).code).toBe('INVALID');
    expect(failureOf(await drop(inHours(-5), inHours(-1))).code).toBe('INVALID');
    expect(await row()).toMatchObject({ dropStartsAt: null, dropEndsAt: null });
  });

  it('needs a plan with limited drops to set one, but never to take one away', async () => {
    await prisma().restaurant.update({ where: { id: a.restaurant.id }, data: { plan: 'BASIC' } });
    expect(failureOf(await drop(inHours(1), inHours(5))).code).toBe('UPGRADE_REQUIRED');
    expect(await row()).toMatchObject({ dropEndsAt: null });
    await prisma().product.update({ where: { id: a.product.id }, data: { dropStartsAt: new Date(Date.now() + HOUR), dropEndsAt: new Date(Date.now() + 5 * HOUR) } });
    dataOf(await drop(null, null));
    expect(await row()).toMatchObject({ dropEndsAt: null });
  });

  it('shows on the Availability board, with whether the plan has it', async () => {
    dataOf(await drop(inHours(1), inHours(5)));
    const board = dataOf(await runQuery(prisma(), owner, availabilityQueries.board, { menuId: a.menu.id }));
    expect(board.drops.allowed).toBe(true);
    expect(board.categories.flatMap((category) => category.products).find((product) => product.id === a.product.id)?.dropEndsAt).not.toBeNull();
    await prisma().restaurant.update({ where: { id: a.restaurant.id }, data: { plan: 'BASIC' } });
    expect(dataOf(await runQuery(prisma(), owner, availabilityQueries.board, { menuId: a.menu.id })).drops.allowed).toBe(false);
  });
});
