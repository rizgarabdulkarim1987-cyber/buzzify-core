import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RETAIL_LAST_OWNER, RETAIL_LAST_OWNER_TEXT } from '@/server/retail/owners';
import { buildRetailState } from '@/server/retail/snapshot';
import * as people from '@/server/studio/actions/people';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { runAction, type ActionDef } from '@/server/studio/framework/action';
import type { ActionResult } from '@/server/studio/framework/result';
import { acceptInvitation } from '@/server/studio/services/invitations';
import { GOOD, NOW, person, pharmacy, prisma, resetWorld, useTestDatabase } from '../pharmacy/fixture';
import { linkOf, retailPlan, retailShop } from './world';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };
const META = { ip: '203.0.113.7', userAgent: 'vitest' };

const run = <I, O>(actor: Actor, def: ActionDef<I, O>, input: unknown) => runAction(prisma(), actor, def, input, META);
const dataOf = <T>(result: ActionResult<T>): T => {
  if (!result.ok) throw new Error(`expected success, got ${JSON.stringify(result.error)}`);
  return result.data;
};
const expectLastOwner = (result: ActionResult<unknown>) => {
  if (result.ok) throw new Error('expected a refusal');
  expect(result.error).toMatchObject({ code: 'CONFLICT', message: RETAIL_LAST_OWNER_TEXT, fields: { refusalCode: RETAIL_LAST_OWNER } });
};
const isActive = async (userId: string) => (await prisma().user.findUnique({ where: { id: userId } }))?.deactivatedAt === null;
const ownerOf = async (restaurantId: string) => {
  const built = await prisma().$transaction((tx) => buildRetailState(tx, restaurantId));
  return built.ready ? built.state.owner.coreUserId : built.waitingFor;
};

let admin: Actor;

beforeAll(() => useTestDatabase());
afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});
beforeEach(async () => {
  await resetWorld();
  admin = (await loadActor(prisma(), (await person('root', { superAdmin: true })).userId)) as Actor;
});

/** A second owner, the way the Studio makes one: an owner invitation to the shop, accepted with a new account. */
async function secondOwner(restaurantId: string, label: string): Promise<string> {
  const { url } = dataOf(await run(admin, people.inviteOwner, { restaurantId, email: `${label}@rt-test.example` }));
  const { userId } = await acceptInvitation(prisma(), { token: url.slice(url.lastIndexOf('/') + 1), signedInUserId: null, name: label, password: GOOD, now: new Date() });
  return userId;
}

describe('a retail shop keeps an owner', () => {
  it('unassigning the only owner is refused', async () => {
    const shop = await retailShop('Solo');
    expectLastOwner(await run(admin, people.unassignMember, { userId: shop.owner!.userId, restaurantId: shop.id }));
    expect(await prisma().membership.count({ where: { restaurantId: shop.id, role: 'OWNER' } })).toBe(1);
    expect((await linkOf(shop.id)).stateVersion).toBe(0);
  });

  it('a deactivated co-owner does not count', async () => {
    const shop = await retailShop('Lapsed');
    await person('lapsed-co', { membership: [shop.id, 'OWNER'], deactivated: true });
    expectLastOwner(await run(admin, people.unassignMember, { userId: shop.owner!.userId, restaurantId: shop.id }));
  });

  it('deactivating the only owner is refused', async () => {
    const shop = await retailShop('Solo Off');
    expectLastOwner(await run(admin, people.deactivateUser, { userId: shop.owner!.userId }));
    expect(await isActive(shop.owner!.userId)).toBe(true);
  });

  it('deactivating someone who is the only owner of one of their shops is refused for all of them', async () => {
    const shared = await retailShop('Shared');
    const alone = await retailShop('Alone', { owner: false });
    await secondOwner(shared.id, 'co-owner');
    await prisma().membership.create({ data: { userId: shared.owner!.userId, restaurantId: alone.id, role: 'OWNER' } });
    expectLastOwner(await run(admin, people.deactivateUser, { userId: shared.owner!.userId }));
    expect(await isActive(shared.owner!.userId)).toBe(true);
  });

  it('deleting the only owner (left deactivated by older data) is refused', async () => {
    const shop = await retailShop('Legacy');
    await prisma().user.update({ where: { id: shop.owner!.userId }, data: { deactivatedAt: NOW } });
    expectLastOwner(await run(admin, people.deleteUser, { userId: shop.owner!.userId }));
    expect(await prisma().user.count({ where: { id: shop.owner!.userId } })).toBe(1);
  });

  it('with a second owner the first may go, and the snapshot names the one who stays', async () => {
    await retailPlan('shop');
    const shop = await retailShop('Handover');
    const first = shop.owner!.userId;
    const second = await secondOwner(shop.id, 'next-owner');
    expect(await prisma().membership.count({ where: { restaurantId: shop.id, role: 'OWNER' } })).toBe(2);
    expect(await ownerOf(shop.id)).toBe(first);

    dataOf(await run(admin, people.deactivateUser, { userId: first }));
    expect(await ownerOf(shop.id)).toBe(second);
    dataOf(await run(admin, people.deleteUser, { userId: first }));
    expect(await ownerOf(shop.id)).toBe(second);
    // Now the second is the only one.
    expectLastOwner(await run(admin, people.unassignMember, { userId: second, restaurantId: shop.id }));
    expectLastOwner(await run(admin, people.deactivateUser, { userId: second }));

    const third = await secondOwner(shop.id, 'third-owner');
    dataOf(await run(admin, people.unassignMember, { userId: second, restaurantId: shop.id }));
    expect(await ownerOf(shop.id)).toBe(third);
  });

  it('a food or pharmacy owner may still be removed', async () => {
    const food = await pharmacy('Food', { sector: 'FOOD', subscription: 'none' });
    const chemist = await pharmacy('Chemist');
    const cook = await person('cook', { membership: [food.id, 'OWNER'] });
    const pharmacist = await person('pharmacist', { membership: [chemist.id, 'OWNER'] });
    dataOf(await run(admin, people.unassignMember, { userId: cook.userId, restaurantId: food.id }));
    dataOf(await run(admin, people.deactivateUser, { userId: pharmacist.userId }));
    dataOf(await run(admin, people.deleteUser, { userId: pharmacist.userId }));
    expect(await prisma().membership.count()).toBe(0);
  });
});
