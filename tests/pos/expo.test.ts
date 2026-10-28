import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { groupExpo, type ExpoLine } from '@/server/domain/pos/expo';
import { createKitchenSection, createPosArea, createPosTables } from '@/server/studio/actions/pos';
import { markPosLinesReady, sendPosToKitchen } from '@/server/studio/actions/pos-kitchen';
import { addPosLine, openPosOrder } from '@/server/studio/actions/pos-orders';
import { payPosOrder } from '@/server/studio/actions/pos-payments';
import { openPosShift } from '@/server/studio/actions/pos-shifts';
import { posExpo } from '@/server/studio/queries/pos';
import { ask, codeOf, dataOf, person, prisma, resetWorld, restaurant, run, useTestDatabase, type Person } from './fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

const at = (minute: number) => new Date(2026, 9, 28, 12, minute);
const line = (over: Partial<ExpoLine>): ExpoLine => ({
  orderId: 'o1', orderNumber: 1, orderStatus: 'OPEN', kind: 'DINE_IN', queueNumber: null, tableNumber: 4, sectionId: 's1', sectionName: 'Grill', sentAt: at(0), ready: false, ...over,
});

describe('groupExpo', () => {
  it('shows one tile per order with each section waiting or ready', () => {
    const [order] = groupExpo([line({ sectionId: 's1', sectionName: 'Grill', ready: true }), line({ sectionId: 's2', sectionName: 'Bar', ready: false })]);
    expect(order.sections).toEqual([
      { sectionId: 's2', name: 'Bar', ready: false },
      { sectionId: 's1', name: 'Grill', ready: true },
    ]);
    expect(order.allReady).toBe(false);
  });

  it('calls a section ready only when all its lines are ready', () => {
    const [order] = groupExpo([line({ ready: true }), line({ ready: false })]);
    expect(order.sections).toEqual([{ sectionId: 's1', name: 'Grill', ready: false }]);
  });

  it('is ready to run when every section is ready, and puts those first', () => {
    const grouped = groupExpo([
      line({ orderId: 'old', orderNumber: 1, sentAt: at(0), ready: false }),
      line({ orderId: 'done', orderNumber: 2, sentAt: at(5), ready: true }),
    ]);
    expect(grouped.map((o) => o.orderId)).toEqual(['done', 'old']);
    expect(grouped[0].allReady).toBe(true);
  });

  it('sorts oldest first within a group', () => {
    const grouped = groupExpo([line({ orderId: 'b', sentAt: at(9) }), line({ orderId: 'a', sentAt: at(2) })]);
    expect(grouped.map((o) => o.orderId)).toEqual(['a', 'b']);
    expect(grouped[0].oldestAt).toEqual(at(2));
  });

  it('keeps a paid order only while some food is still being cooked', () => {
    const grouped = groupExpo([
      line({ orderId: 'paid-done', orderStatus: 'PAID', ready: true }),
      line({ orderId: 'paid-cooking', orderStatus: 'PAID', ready: false }),
    ]);
    expect(grouped.map((o) => o.orderId)).toEqual(['paid-cooking']);
  });

  it('names a section without one by an empty name, last', () => {
    const [order] = groupExpo([line({ sectionId: null, sectionName: '' }), line({ sectionId: 's1', sectionName: 'Grill' })]);
    expect(order.sections.map((s) => s.sectionId)).toEqual(['s1', null]);
  });
});

describe('posExpo', () => {
  let a: { id: string };
  let manager: Person;
  let cashier: Person;
  let sectioned: Person;
  let tableId: string;
  let productId: string;
  const names = (ar: string, en = ar) => ({ ar: { name: ar }, en: { name: en } });

  beforeAll(() => {
    useTestDatabase();
  });

  beforeEach(async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await resetWorld();
    a = await restaurant('Expo A');
    manager = await person('manager', { staff: [a.id, 'MANAGER'] });
    cashier = await person('cashier', { staff: [a.id, 'CASHIER'] });
    const menu = await prisma().menu.create({ data: { restaurantId: a.id, name: 'm', slug: 'menu-a', currency: 'IQD', locales: ['ar', 'en'], defaultLocale: 'ar', timezone: 'Asia/Baghdad' } });
    await prisma().posSettings.upsert({ where: { restaurantId: a.id }, create: { restaurantId: a.id, requireApproval: false, catalogMenuId: menu.id, kitchenScreenEnabled: true }, update: {} });
    const category = await prisma().category.create({ data: { menuId: menu.id, slug: 'food', sortOrder: 1, translations: names('أكل', 'Food') } });
    productId = (await prisma().product.create({ data: { menuId: menu.id, categoryId: category.id, slug: 'plate', sortOrder: 1, basePrice: 5000, translations: names('طبق', 'Plate') } })).id;
    const areaId = dataOf(await run(manager, createPosArea, { name: 'Hall' })).areaId;
    await run(manager, createPosTables, { areaId, from: 1, to: 1 });
    tableId = (await prisma().posTable.findFirstOrThrow({ where: { restaurantId: a.id } })).id;
    const sectionId = dataOf(await run(manager, createKitchenSection, { name: 'Grill' })).sectionId;
    sectioned = await person('grill', { staff: [a.id, 'KITCHEN'] });
    await prisma().posStaff.updateMany({ where: { restaurantId: a.id, userId: sectioned.userId }, data: { kitchenSectionId: sectionId } });
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

  it('follows an order from waiting to ready to gone once paid', async () => {
    const opened = dataOf(await run(cashier, openPosOrder, { tableId }));
    const added = dataOf(await run(cashier, addPosLine, { orderId: opened.orderId, productId, quantity: 1, note: '', optionIds: [], expectedVersion: opened.version }));
    const sent = dataOf(await run(cashier, sendPosToKitchen, { orderId: opened.orderId, expectedVersion: added.version }));

    let expo = dataOf(await ask(manager, posExpo, {})).orders;
    expect(expo).toHaveLength(1);
    expect(expo[0].allReady).toBe(false);

    const lineIds = (await prisma().posOrderLine.findMany({ where: { orderId: opened.orderId } })).map((l) => l.id);
    dataOf(await run(manager, markPosLinesReady, { lineIds }));
    expo = dataOf(await ask(manager, posExpo, {})).orders;
    expect(expo[0].allReady).toBe(true);

    const version = (await prisma().posOrder.findFirstOrThrow({ where: { id: opened.orderId } })).version;
    dataOf(await run(cashier, payPosOrder, { orderId: opened.orderId, expectedVersion: version, expectedTotal: 5000, amountReceived: 5000 }));
    expect(dataOf(await ask(manager, posExpo, {})).orders).toHaveLength(0);
    expect(sent).toBeDefined();
  });

  it('is not for a kitchen member tied to one section', async () => {
    expect(codeOf(await ask(sectioned, posExpo, {}))).toBe('FORBIDDEN');
  });

  it('is not for the cashier', async () => {
    expect(codeOf(await ask(cashier, posExpo, {}))).toBe('FORBIDDEN');
  });
});
