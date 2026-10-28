import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPosArea, createPosTables } from '@/server/studio/actions/pos';
import { addPosLine, openPosOrder } from '@/server/studio/actions/pos-orders';
import { payPosOrder } from '@/server/studio/actions/pos-payments';
import { openPosShift } from '@/server/studio/actions/pos-shifts';
import { posReceipt } from '@/server/studio/queries/pos';
import { ask, dataOf, person, prisma, resetWorld, restaurant, run, useTestDatabase, type Person } from './fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

let a: { id: string };
let cashier: Person;
let manager: Person;
let tableId: string;
let productId: string;

const names = (ar: string, en = ar) => ({ ar: { name: ar }, en: { name: en } });

beforeAll(() => {
  useTestDatabase();
});

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await resetWorld();
  a = await restaurant('Receipt A');
  cashier = await person('cashier', { staff: [a.id, 'CASHIER'] });
  manager = await person('manager', { staff: [a.id, 'MANAGER'] });
  const menu = await prisma().menu.create({
    data: { restaurantId: a.id, name: 'm', slug: 'menu-a', currency: 'IQD', locales: ['ar', 'en'], defaultLocale: 'ar', timezone: 'Asia/Baghdad' },
  });
  await prisma().posSettings.upsert({
    where: { restaurantId: a.id },
    create: { restaurantId: a.id, requireApproval: false, catalogMenuId: menu.id, invoiceName: 'Buzz Grill', invoiceAddress: 'Street 5, Erbil', invoicePhone: '0750 000 0000', invoiceTaxNumber: 'TX-77', invoiceFooter: 'Thank you, come again' },
    update: {},
  });
  const category = await prisma().category.create({ data: { menuId: menu.id, slug: 'food', sortOrder: 1, translations: names('أكل', 'Food') } });
  productId = (await prisma().product.create({ data: { menuId: menu.id, categoryId: category.id, slug: 'plate', sortOrder: 1, basePrice: 5000, translations: names('طبق', 'Plate') } })).id;
  const areaId = dataOf(await run(manager, createPosArea, { name: 'Hall' })).areaId;
  await run(manager, createPosTables, { areaId, from: 1, to: 1 });
  tableId = (await prisma().posTable.findFirstOrThrow({ where: { restaurantId: a.id } })).id;
  dataOf(await run(cashier, openPosShift, { openingFloat: 0 }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

async function paidOrder(): Promise<string> {
  const opened = dataOf(await run(cashier, openPosOrder, { tableId }));
  const added = dataOf(await run(cashier, addPosLine, { orderId: opened.orderId, productId, quantity: 1, note: '', optionIds: [], expectedVersion: opened.version }));
  dataOf(await run(cashier, payPosOrder, { orderId: opened.orderId, expectedVersion: added.version, expectedTotal: 5000, amountReceived: 5000 }));
  return opened.orderId;
}

describe('the receipt carries the business details', () => {
  it('shows the name, address, phone and footer from the settings and the tax number from the payment', async () => {
    const orderId = await paidOrder();
    const receipt = dataOf(await ask(cashier, posReceipt, { orderId }));
    expect(receipt.business).toEqual({ name: 'Buzz Grill', address: 'Street 5, Erbil', phone: '0750 000 0000', footer: 'Thank you, come again' });
    expect(receipt.snapshot.taxNumber).toBe('TX-77');
  });

  it('keeps the tax number it was paid with when the setting changes later', async () => {
    const orderId = await paidOrder();
    await prisma().posSettings.update({ where: { restaurantId: a.id }, data: { invoiceTaxNumber: 'TX-99', invoiceName: 'New Name' } });
    const receipt = dataOf(await ask(cashier, posReceipt, { orderId }));
    expect(receipt.snapshot.taxNumber).toBe('TX-77');
    expect(receipt.business.name).toBe('New Name');
  });

  it('reads plain empty details for a restaurant that never set them', async () => {
    await prisma().posSettings.update({ where: { restaurantId: a.id }, data: { invoiceName: '', invoiceAddress: '', invoicePhone: '', invoiceTaxNumber: '', invoiceFooter: '' } });
    const orderId = await paidOrder();
    const receipt = dataOf(await ask(cashier, posReceipt, { orderId }));
    expect(receipt.business).toEqual({ name: '', address: '', phone: '', footer: '' });
    expect(receipt.snapshot.taxNumber).toBeUndefined();
  });
});
