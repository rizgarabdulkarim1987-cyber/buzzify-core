import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPosArea, createPosTables } from '@/server/studio/actions/pos';
import { addPosLine, cancelPosLine, openPosOrder, setPosInvoiceDiscount } from '@/server/studio/actions/pos-orders';
import { payPosOrder, reversePosPayment } from '@/server/studio/actions/pos-payments';
import { openPosShift } from '@/server/studio/actions/pos-shifts';
import { posOrder } from '@/server/studio/queries/pos';
import { ask, codeOf, dataOf, person, prisma, resetWorld, restaurant, run, useTestDatabase, type Person } from './fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

let a: { id: string };
let cashier: Person;
let manager: Person;
let tableId: string;
let burger: string;

const names = (ar: string, en = ar) => ({ ar: { name: ar }, en: { name: en } });

beforeAll(() => {
  useTestDatabase();
});

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await resetWorld();
  a = await restaurant('Review Fixes');
  cashier = await person('cashier', { staff: [a.id, 'CASHIER'] });
  manager = await person('manager', { staff: [a.id, 'MANAGER'] });
  const menu = await prisma().menu.create({
    data: { restaurantId: a.id, name: 'm', slug: 'menu-f', currency: 'IQD', locales: ['ar', 'en'], defaultLocale: 'ar', timezone: 'Asia/Baghdad' },
  });
  await prisma().posSettings.upsert({
    where: { restaurantId: a.id },
    create: { restaurantId: a.id, requireApproval: false, catalogMenuId: menu.id },
    update: { requireApproval: false, catalogMenuId: menu.id },
  });
  const category = await prisma().category.create({ data: { menuId: menu.id, slug: 'food', sortOrder: 1, translations: names('أكل', 'Food') } });
  burger = (await prisma().product.create({ data: { menuId: menu.id, categoryId: category.id, slug: 'burger', sortOrder: 1, basePrice: 5000, translations: names('برغر', 'Burger') } })).id;
  const areaId = dataOf(await run(manager, createPosArea, { name: 'Hall' })).areaId;
  await run(manager, createPosTables, { areaId, from: 1, to: 1 });
  tableId = (await prisma().posTable.findFirstOrThrow({ where: { restaurantId: a.id } })).id;
  dataOf(await run(cashier, openPosShift, { openingFloat: 0 }));
  dataOf(await run(manager, openPosShift, { openingFloat: 0 }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

const view = async (orderId: string) => dataOf(await ask(cashier, posOrder, { orderId }));

async function twoLines() {
  const opened = dataOf(await run(cashier, openPosOrder, { tableId }));
  const one = dataOf(await run(cashier, addPosLine, { orderId: opened.orderId, productId: burger, quantity: 1, note: '', optionIds: [], expectedVersion: opened.version }));
  const two = dataOf(await run(cashier, addPosLine, { orderId: opened.orderId, productId: burger, quantity: 1, note: '', optionIds: [], expectedVersion: one.version }));
  return { orderId: opened.orderId, a: one.lineId, b: two.lineId };
}

describe('review fixes', () => {
  it('finishes a part-paid order when its last unpaid line is cancelled', async () => {
    const o = await twoLines();
    dataOf(await run(cashier, payPosOrder, { orderId: o.orderId, expectedVersion: (await view(o.orderId)).version, expectedTotal: 5_000, lineIds: [o.a], amountReceived: 5_000 }));
    dataOf(await run(cashier, cancelPosLine, { lineId: o.b, reason: 'refused', expectedVersion: (await view(o.orderId)).version }));
    expect((await view(o.orderId)).status).toBe('PAID');
  });

  it('refuses a new invoice discount once a part is paid', async () => {
    const o = await twoLines();
    dataOf(await run(cashier, payPosOrder, { orderId: o.orderId, expectedVersion: (await view(o.orderId)).version, expectedTotal: 5_000, lineIds: [o.a], amountReceived: 5_000 }));
    const refused = await run(manager, setPosInvoiceDiscount, { orderId: o.orderId, discount: { kind: 'PERCENT', value: 100, reason: 'COMP' }, expectedVersion: (await view(o.orderId)).version });
    expect(codeOf(refused)).toBe('CONFLICT');
  });

  it('takes payment for a bill that came to nothing (a comped bill), with the single-method call', async () => {
    const o = await twoLines();
    dataOf(await run(manager, setPosInvoiceDiscount, { orderId: o.orderId, discount: { kind: 'PERCENT', value: 100, reason: 'COMP' }, expectedVersion: (await view(o.orderId)).version }));
    const paid = dataOf(await run(manager, payPosOrder, { orderId: o.orderId, expectedVersion: (await view(o.orderId)).version, expectedTotal: 0, method: 'CASH', amountReceived: 0 }));
    expect(paid.total).toBe(0);
    expect((await view(o.orderId)).status).toBe('PAID');
  });

  it('reverses a part by its payment id while the order is still open', async () => {
    const o = await twoLines();
    const part = dataOf(await run(cashier, payPosOrder, { orderId: o.orderId, expectedVersion: (await view(o.orderId)).version, expectedTotal: 5_000, lineIds: [o.a], amountReceived: 5_000 }));
    const done = await run(manager, reversePosPayment, { orderId: o.orderId, paymentId: part.paymentId, expectedVersion: (await view(o.orderId)).version, reason: 'Wrong method' });
    expect(codeOf(done)).toBe('OK');
  });
});
