import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { bumpRetailForPlan, bumpRetailForUser, bumpRetailState } from '@/server/retail/outbox';
import { person, pharmacy, prisma, resetWorld, useTestDatabase } from '../pharmacy/fixture';
import { linkOf, outboxOf, retailShop } from './world';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

const bump = (restaurantId: string) => prisma().$transaction((tx) => bumpRetailState(tx, restaurantId));

beforeAll(() => useTestDatabase());
afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});
beforeEach(async () => {
  await resetWorld();
});

describe('bumpRetailState', () => {
  it('concurrent bumps are strictly increasing', async () => {
    const shop = await retailShop('Busy');
    const versions = await Promise.all(Array.from({ length: 10 }, () => bump(shop.id)));
    expect([...versions].sort((a, b) => a! - b!)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect((await linkOf(shop.id)).stateVersion).toBe(10);
    expect(await outboxOf(shop.id)).toMatchObject({ dueVersion: 10, attempts: 0, failedAt: null });
    expect(await prisma().retailOutbox.count()).toBe(1);
  });

  it('a bump on a FOOD restaurant is null and writes nothing', async () => {
    const food = await pharmacy('Food', { sector: 'FOOD', subscription: 'none' });
    expect(await bump(food.id)).toBeNull();
    expect(await prisma().retailOutbox.count()).toBe(0);
    expect(await prisma().retailLink.count()).toBe(0);
  });

  it('a bump clears failedAt and attempts', async () => {
    const shop = await retailShop('Failed');
    await bump(shop.id);
    await prisma().retailOutbox.update({
      where: { restaurantId: shop.id },
      data: { attempts: 20, failedAt: new Date(), lastError: 'HTTP_503', waitingFor: 'OWNER', nextAttemptAt: new Date(Date.now() + 3_600_000) },
    });
    const before = Date.now();
    expect(await bump(shop.id)).toBe(2);
    const row = await outboxOf(shop.id);
    expect(row).toMatchObject({ dueVersion: 2, attempts: 0, failedAt: null, lastError: null, waitingFor: null });
    expect(row!.nextAttemptAt.getTime()).toBeLessThanOrEqual(before + 1000);
  });

  it('a rolled back bump leaves nothing', async () => {
    const shop = await retailShop('Rolled');
    await expect(
      prisma().$transaction(async (tx) => {
        await bumpRetailState(tx, shop.id);
        throw new Error('refused');
      }),
    ).rejects.toThrow('refused');
    expect((await linkOf(shop.id)).stateVersion).toBe(0);
    expect(await outboxOf(shop.id)).toBeNull();
  });
});

describe('bumpRetailForUser and bumpRetailForPlan', () => {
  it('bumps every RETAIL business the user owns, and none they only design', async () => {
    const a = await retailShop('Shop A');
    const b = await retailShop('Shop B', { owner: false });
    const c = await retailShop('Shop C', { owner: false });
    const food = await pharmacy('Food', { sector: 'FOOD', subscription: 'none' });
    await prisma().membership.createMany({
      data: [
        { userId: a.owner!.userId, restaurantId: b.id, role: 'OWNER' },
        { userId: a.owner!.userId, restaurantId: c.id, role: 'DESIGNER' },
        { userId: a.owner!.userId, restaurantId: food.id, role: 'OWNER' },
      ],
    });
    await prisma().$transaction((tx) => bumpRetailForUser(tx, a.owner!.userId));
    expect((await linkOf(a.id)).stateVersion).toBe(1);
    expect((await linkOf(b.id)).stateVersion).toBe(1);
    expect((await linkOf(c.id)).stateVersion).toBe(0);
    expect(await prisma().retailOutbox.count()).toBe(2);
    const stranger = await person('stranger');
    await prisma().$transaction((tx) => bumpRetailForUser(tx, stranger.userId));
    expect(await prisma().retailOutbox.count()).toBe(2);
  });

  it('bumps every RETAIL business with a retail subscription on the code', async () => {
    const a = await retailShop('On Shop', { planCode: 'shop' });
    const b = await retailShop('Old Shop', { planCode: 'shop', subscription: 'EXPIRED' });
    const c = await retailShop('Other Plan', { planCode: 'big' });
    // A pharmacy plan with the same code is another product's.
    await pharmacy('Pharmacy', {});
    await prisma().subscription.updateMany({ where: { applicationId: 'pharmacy' }, data: { planCode: 'shop' } });
    await prisma().$transaction((tx) => bumpRetailForPlan(tx, 'shop'));
    expect((await linkOf(a.id)).stateVersion).toBe(1);
    expect((await linkOf(b.id)).stateVersion).toBe(1);
    expect((await linkOf(c.id)).stateVersion).toBe(0);
    expect(await prisma().retailOutbox.count()).toBe(2);
  });
});
