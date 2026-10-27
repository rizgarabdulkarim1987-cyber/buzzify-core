import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { person, prisma, resetWorld, restaurant, useTestDatabase } from './fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

beforeAll(() => {
  useTestDatabase();
});

let a: { id: string };
let b: { id: string };

beforeEach(async () => {
  await resetWorld();
  a = await restaurant('Trust A');
  b = await restaurant('Trust B');
});

async function shift(restaurantId: string, label: string) {
  const user = await person(label, { staff: [restaurantId, 'CASHIER'] });
  return prisma().posShift.create({ data: { restaurantId, userId: user.userId, openingFloat: 0 }, select: { id: true } });
}

describe('trust-control schema', () => {
  it('keeps one counter row per restaurant and name', async () => {
    await prisma().posCounter.create({ data: { restaurantId: a.id, name: 'z', value: 1 } });
    await expect(prisma().posCounter.create({ data: { restaurantId: a.id, name: 'z', value: 2 } })).rejects.toThrow();
    await expect(prisma().posCounter.create({ data: { restaurantId: b.id, name: 'z', value: 1 } })).resolves.toBeTruthy();
  });

  it('refuses a Z number used twice in one restaurant but allows it in another', async () => {
    const s1 = await shift(a.id, 'z1');
    const s2 = await shift(a.id, 'z2');
    const s3 = await shift(b.id, 'z3');
    await prisma().posShift.update({ where: { id: s1.id }, data: { zNumber: 1 } });
    await expect(prisma().posShift.update({ where: { id: s2.id }, data: { zNumber: 1 } })).rejects.toThrow();
    await expect(prisma().posShift.update({ where: { id: s3.id }, data: { zNumber: 1 } })).resolves.toBeTruthy();
  });

  it('defaults the trust settings to a 15 minute idle limit and approval on', async () => {
    const row = await prisma().posSettings.create({ data: { restaurantId: a.id }, select: { idleMinutes: true, requireApproval: true } });
    expect(row).toEqual({ idleMinutes: 15, requireApproval: true });
  });

  it('removes a restaurant counters with the restaurant', async () => {
    const c = await restaurant('Trust C', 'none');
    await prisma().posCounter.create({ data: { restaurantId: c.id, name: 'z', value: 3 } });
    await prisma().restaurant.delete({ where: { id: c.id } });
    expect(await prisma().posCounter.count({ where: { restaurantId: c.id } })).toBe(0);
  });
});
