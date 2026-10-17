import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPrisma } from '@/server/data/prisma';
import { getCatalog, getTenant } from '@/server/data/public-menu';
import * as availability from '@/server/studio/actions/availability';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { runAction } from '@/server/studio/framework/action';
import { runQuery } from '@/server/studio/framework/query';
import type { ActionResult } from '@/server/studio/framework/result';
import * as availabilityQueries from '@/server/studio/queries/availability';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { createMenuFixture, publishFixture, requireTestDb, resetTestData } from '../helpers/db';

const prisma = () => getPrisma();
const META = { ip: '203.0.113.7', userAgent: 'vitest' };

const dataOf = <T>(result: ActionResult<T>): T => {
  if (!result.ok) throw new Error(`expected success, got ${JSON.stringify(result.error)}`);
  return result.data;
};

let a: Awaited<ReturnType<typeof createMenuFixture>>;
let owner: Actor;
let optionId: string;

beforeAll(() => {
  requireTestDb();
  vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
});

beforeEach(async () => {
  await resetTestData(prisma());
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  a = await createMenuFixture(prisma(), 'live-a', { publish: false });
  const group = await prisma().modifierGroup.create({
    data: { menuId: a.menu.id, productId: a.product.id, minSelect: 0, maxSelect: 1, translations: { en: { name: 'Milk' } } },
  });
  optionId = (await prisma().modifierOption.create({ data: { menuId: a.menu.id, groupId: group.id, translations: { en: { name: 'Oat' } } } })).id;
  await publishFixture(prisma(), a.menu.id);
  await prisma().user.create({ data: { id: 'owner-a', name: 'Alpha Owner', email: 'owner-a@example.com' } });
  await prisma().membership.create({ data: { userId: 'owner-a', restaurantId: a.restaurant.id, role: 'OWNER' } });
  owner = (await loadActor(prisma(), 'owner-a')) as Actor;
});

afterAll(async () => {
  await resetTestData(prisma());
});

const menuRow = () => prisma().menu.findUniqueOrThrow({ where: { id: a.menu.id } });
const catalog = async () => getCatalog((await getTenant('live-a'))!);

describe('availability', () => {
  it('shows a product sold out at once, without a publish, and changes neither the draft hash nor the version', async () => {
    const before = await menuRow();
    dataOf(await runAction(prisma(), owner, availability.setProduct, { menuId: a.menu.id, productId: a.product.id, isAvailable: false }, META));
    expect((await catalog()).products.find((product) => product.id === a.product.id)?.isAvailable).toBe(false);
    expect((await menuRow()).draftHash).toBe(before.draftHash);
    expect((await prisma().product.findUniqueOrThrow({ where: { id: a.product.id } })).version).toBe(1);
    expect(await prisma().auditLog.findFirstOrThrow({ where: { action: 'product.availability_changed' } })).toMatchObject({
      entityType: 'Product',
      entityId: a.product.id,
      changes: { isAvailable: { before: true, after: false } },
    });
  });

  it('removes a hidden product from the public catalog', async () => {
    dataOf(await runAction(prisma(), owner, availability.setProduct, { menuId: a.menu.id, productId: a.product.id, isHidden: true }, META));
    expect((await catalog()).products.some((product) => product.id === a.product.id)).toBe(false);
  });

  it('shows an option unavailable', async () => {
    dataOf(await runAction(prisma(), owner, availability.setOption, { menuId: a.menu.id, optionId, isAvailable: false }, META));
    const option = (await catalog()).products[0]!.groups[0]!.options[0]!;
    expect(option).toMatchObject({ id: optionId, isAvailable: false });
    expect((await prisma().modifierOption.findUniqueOrThrow({ where: { id: optionId } })).version).toBe(1);
  });

  it('lists the board with each product and option and their switches', async () => {
    const board = dataOf(await runQuery(prisma(), owner, availabilityQueries.board, { menuId: a.menu.id }));
    expect(board.categories[0]!.products[0]).toMatchObject({
      id: a.product.id,
      names: { en: 'Espresso' },
      isAvailable: true,
      isHidden: false,
      groups: [{ names: { en: 'Milk' }, options: [{ id: optionId, names: { en: 'Oat' }, isAvailable: true }] }],
    });
  });

  it('refuses a change that sets nothing', async () => {
    const result = await runAction(prisma(), owner, availability.setProduct, { menuId: a.menu.id, productId: a.product.id }, META);
    expect(result.ok ? null : result.error.code).toBe('INVALID');
  });
});
