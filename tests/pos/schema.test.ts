import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { resetTestData, testPrisma } from '../helpers/db';

process.env.DATABASE_URL = databaseUrl(TEST_DB);
const prisma = testPrisma();

let restaurantId = '';
let otherId = '';

beforeAll(async () => {
  await resetTestData(prisma);
  restaurantId = (await prisma.restaurant.create({ data: { name: 'Till One' } })).id;
  otherId = (await prisma.restaurant.create({ data: { name: 'Till Two' } })).id;
  await prisma.user.createMany({
    data: [
      { id: 'pos-u1', name: 'One', email: 'one@pos.test' },
      { id: 'pos-u2', name: 'Two', email: 'two@pos.test' },
    ],
  });
});

afterAll(async () => {
  await resetTestData(prisma);
  await prisma.$disconnect();
});

describe('PosSettings', () => {
  it('starts with the plain defaults: rates 0, only cash, ring 60, every switch off', async () => {
    const row = await prisma.posSettings.create({ data: { restaurantId } });
    expect(row).toMatchObject({
      serviceRatePercent: 0,
      taxRatePercent: 0,
      enabledPaymentMethods: ['CASH'],
      kitchenPrintEnabled: false,
      kitchenScreenEnabled: false,
      qrOrderingEnabled: false,
      takeawayEnabled: false,
      deliveryEnabled: false,
      complaintsEnabled: false,
      tableRingMinutes: 60,
      catalogMenuId: null,
      version: 1,
    });
  });

  it('is unique per restaurant', async () => {
    await expect(prisma.posSettings.create({ data: { restaurantId } })).rejects.toThrow();
  });
});

describe('PosStaff', () => {
  it('is unique per restaurant and user, and one user may work in two restaurants', async () => {
    await prisma.posStaff.create({ data: { restaurantId, userId: 'pos-u1', role: 'CASHIER' } });
    await expect(prisma.posStaff.create({ data: { restaurantId, userId: 'pos-u1', role: 'MANAGER' } })).rejects.toThrow();
    await prisma.posStaff.create({ data: { restaurantId: otherId, userId: 'pos-u1', role: 'KITCHEN' } });
  });

  it('refuses a role the enum does not have', async () => {
    await expect(
      // eslint-disable-next-line no-restricted-properties -- the test goes around the client on purpose, to prove the database refuses
      prisma.$executeRawUnsafe(`INSERT INTO "PosStaff" ("id","restaurantId","userId","role") VALUES ('x','${restaurantId}','pos-u2','BOSS')`),
    ).rejects.toThrow();
  });

  it('goes with its restaurant and with its user', async () => {
    await prisma.posStaff.create({ data: { restaurantId: otherId, userId: 'pos-u2', role: 'MANAGER' } });
    await prisma.user.delete({ where: { id: 'pos-u2' } });
    expect(await prisma.posStaff.count({ where: { userId: 'pos-u2' } })).toBe(0);
    await prisma.restaurant.delete({ where: { id: otherId } });
    expect(await prisma.posStaff.count({ where: { restaurantId: otherId } })).toBe(0);
    expect(await prisma.posStaff.count({ where: { restaurantId } })).toBe(1);
  });
});

describe('floor, orders, payments and shifts', () => {
  const live = { restaurantId: '', tableId: '' };

  async function order(status: 'OPEN' | 'PAID', number: number) {
    return prisma.posOrder.create({ data: { restaurantId: live.restaurantId, tableId: live.tableId, number, status } });
  }

  it('lets a table hold one live order, while finished ones stay as history', async () => {
    live.restaurantId = restaurantId;
    const area = await prisma.posArea.create({ data: { restaurantId, name: 'Hall' } });
    live.tableId = (await prisma.posTable.create({ data: { restaurantId, areaId: area.id, number: 1 } })).id;
    await order('PAID', 1);
    await order('OPEN', 2);
    await expect(order('OPEN', 3)).rejects.toMatchObject({ code: 'P2002' });
  });

  it('numbers tables once per restaurant', async () => {
    const area = await prisma.posArea.findFirstOrThrow({ where: { restaurantId } });
    await expect(prisma.posTable.create({ data: { restaurantId, areaId: area.id, number: 1 } })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('lets a person hold one open shift per restaurant and a closed one beside it', async () => {
    const closed = await prisma.posShift.create({ data: { restaurantId, userId: 'pos-u1', openingFloat: 0, closedAt: new Date() } });
    await prisma.posShift.create({ data: { restaurantId, userId: 'pos-u1', openingFloat: 5000 } });
    await expect(prisma.posShift.create({ data: { restaurantId, userId: 'pos-u1', openingFloat: 1 } })).rejects.toMatchObject({ code: 'P2002' });
    expect(closed.id).toBeTruthy();
  });

  it('takes one payment per order', async () => {
    const paid = await prisma.posOrder.findFirstOrThrow({ where: { restaurantId, status: 'PAID' } });
    const base = { restaurantId, orderId: paid.id, method: 'CASH' as const, amountReceived: 1000, totalsSnapshot: {} };
    await prisma.posPayment.create({ data: base });
    await expect(prisma.posPayment.create({ data: base })).rejects.toMatchObject({ code: 'P2002' });
  });
});
