import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { addPosLine } from '@/server/studio/actions/pos-orders';
import { openPosOffPremiseOrder } from '@/server/studio/actions/pos-delivery';
import { payPosOrder } from '@/server/studio/actions/pos-payments';
import { closePosShift, openPosShift } from '@/server/studio/actions/pos-shifts';
import { posDailyReport, posReceipt } from '@/server/studio/queries/pos';
import { baghdadDayOf } from '@/lib/baghdad';
import { ask, codeOf, dataOf, person, prisma, resetWorld, restaurant, run, useTestDatabase, type Person } from './fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

let a: { id: string };
let cashier: Person;
let manager: Person;
let burger: string;

beforeAll(() => {
  useTestDatabase();
});

beforeEach(async () => {
  await resetWorld();
  a = await restaurant('Money A');
  cashier = await person('cashier', { staff: [a.id, 'CASHIER'] });
  manager = await person('manager', { staff: [a.id, 'MANAGER'] });
  const menu = await prisma().menu.create({
    data: { restaurantId: a.id, name: 'm', slug: 'menu-a', currency: 'IQD', locales: ['ar', 'en'], defaultLocale: 'ar', timezone: 'Asia/Baghdad' },
  });
  await prisma().posSettings.upsert({
    where: { restaurantId: a.id },
    create: { restaurantId: a.id, catalogMenuId: menu.id, takeawayEnabled: true, deliveryEnabled: true, serviceRatePercent: 10, taxRatePercent: 5 },
    update: { catalogMenuId: menu.id, takeawayEnabled: true, deliveryEnabled: true, serviceRatePercent: 10, taxRatePercent: 5 },
  });
  const category = await prisma().category.create({ data: { menuId: menu.id, slug: 'food', sortOrder: 1, translations: { ar: { name: 'أكل' }, en: { name: 'Food' } } } });
  burger = (await prisma().product.create({ data: { menuId: menu.id, categoryId: category.id, slug: 'burger', sortOrder: 1, basePrice: 5000, translations: { ar: { name: 'برغر' }, en: { name: 'Burger' } } } })).id;
});

afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

async function offPremise(input: Record<string, unknown>, quantity = 2) {
  const opened = dataOf(await run(cashier, openPosOffPremiseOrder, input));
  const added = dataOf(await run(cashier, addPosLine, { orderId: opened.orderId, productId: burger, quantity, note: '', optionIds: [], expectedVersion: opened.version }));
  return { orderId: opened.orderId, version: added.version };
}

const delivery = { kind: 'DELIVERY', customerName: 'Sara', customerPhone: '07701234567', address: 'Street 5', addressNote: '', zoneId: null, deliveryFee: 3000 };

describe('the delivery fee in the money', () => {
  it('adds the fee after tax, charges no service, freezes it on the payment and shows it on the receipt and report', async () => {
    dataOf(await run(cashier, openPosShift, { openingFloat: 0 }));
    const d = await offPremise(delivery);
    // 10,000 food, no service charge off the table, 5% tax = 500, fee 3,000 -> 13,500.
    expect(codeOf(await run(cashier, payPosOrder, { orderId: d.orderId, expectedVersion: d.version, expectedTotal: 10_500, amountReceived: 20_000 }))).toBe('CONFLICT');
    dataOf(await run(cashier, payPosOrder, { orderId: d.orderId, expectedVersion: d.version, expectedTotal: 13_500, amountReceived: 20_000 }));
    const receipt = dataOf(await ask(cashier, posReceipt, { orderId: d.orderId }));
    expect(receipt.snapshot).toMatchObject({ subtotal: 10_000, service: 0, tax: 500, deliveryFee: 3_000, total: 13_500 });
    expect(receipt).toMatchObject({ kind: 'DELIVERY', queueNumber: 1, change: 6_500 });
    expect(receipt.customer).toMatchObject({ name: 'Sara', address: 'Street 5' });
    const report = dataOf(await ask(manager, posDailyReport, { day: baghdadDayOf(new Date()) }));
    expect(report.totals).toMatchObject({ grossSales: 13_500, deliveryFeesTotal: 3_000 });
    expect(report.shifts[0]).toMatchObject({ deliveryFeesTotal: 3_000 });
  });

  it('keeps a takeaway free of any fee, and a fee edited after payment cannot change the frozen snapshot', async () => {
    dataOf(await run(cashier, openPosShift, { openingFloat: 0 }));
    const t = await offPremise({ kind: 'TAKEAWAY', customerName: '', customerPhone: '' });
    dataOf(await run(cashier, payPosOrder, { orderId: t.orderId, expectedVersion: t.version, expectedTotal: 10_500, amountReceived: 10_500 }));
    expect((await prisma().posPayment.findFirstOrThrow({ where: { orderId: t.orderId } })).totalsSnapshot).toMatchObject({ deliveryFee: 0, total: 10_500 });
    const d = await offPremise(delivery);
    dataOf(await run(cashier, payPosOrder, { orderId: d.orderId, expectedVersion: d.version, expectedTotal: 13_500, amountReceived: 13_500 }));
    await prisma().posOrder.update({ where: { id: d.orderId }, data: { deliveryFee: 9_999 } });
    expect(dataOf(await ask(cashier, posReceipt, { orderId: d.orderId })).snapshot.total).toBe(13_500);
  });
});
