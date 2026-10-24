import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { posOverview } from '@/server/studio/queries/pos';
import { ask, codeOf, dataOf, person, prisma, resetWorld, restaurant, useTestDatabase, type Person } from './fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

let admin: Person;
let owner: Person;
let withTill: { id: string };
let menuOnly: { id: string };

beforeAll(() => {
  useTestDatabase();
});

beforeEach(async () => {
  await resetWorld();
  withTill = await restaurant('Zeta Till');
  menuOnly = await restaurant('Alpha Menu Only', 'none');
  admin = await person('overview-admin', { superAdmin: true });
  owner = await person('overview-owner', { membership: [withTill.id, 'OWNER'] });
  await person('overview-cashier', { staff: [withTill.id, 'CASHIER'] });
  await person('overview-kitchen', { staff: [withTill.id, 'KITCHEN'] });
});

afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

describe('the Super Admin cashier overview', () => {
  it('lists only the restaurants that have a cashier subscription or till staff, with status, staff and catalog', async () => {
    const rows = dataOf(await ask(admin, posOverview, {})).rows;
    expect(rows.map((row) => row.name)).toEqual(['Zeta Till']);
    expect(rows[0]).toMatchObject({ id: withTill.id, status: 'ACTIVE', staff: 2, catalogChosen: false });
  });

  it('counts only active staff and shows a chosen catalog', async () => {
    const kitchen = await prisma().user.findUniqueOrThrow({ where: { email: 'overview-kitchen@pos-test.example' } });
    await prisma().posStaff.updateMany({ where: { userId: kitchen.id }, data: { deactivatedAt: new Date() } });
    const menu = await prisma().menu.create({
      data: { restaurantId: withTill.id, name: 'Till menu', slug: 'overview-till', currency: 'IQD', status: 'DRAFT', timezone: 'Asia/Baghdad', locales: ['ar'] },
    });
    await prisma().posSettings.create({ data: { restaurantId: withTill.id, catalogMenuId: menu.id } });
    const row = dataOf(await ask(admin, posOverview, {})).rows[0]!;
    expect(row).toMatchObject({ staff: 1, catalogChosen: true });
  });

  it('includes a restaurant whose till staff exist but whose subscription is gone, as no subscription', async () => {
    await prisma().posStaff.create({ data: { restaurantId: menuOnly.id, userId: owner.userId, role: 'MANAGER' } });
    const rows = dataOf(await ask(admin, posOverview, {})).rows;
    expect(rows.find((row) => row.id === menuOnly.id)).toMatchObject({ status: 'NONE', staff: 1 });
  });

  it('is refused to anyone who is not a Super Admin', async () => {
    expect(codeOf(await ask(owner, posOverview, {}))).toBe('FORBIDDEN');
  });
});
