import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readShiftReport } from '@/server/pos/report';
import { createPosArea, createPosTables } from '@/server/studio/actions/pos';
import { addPosLine, openPosOrder, setPosInvoiceDiscount, updatePosLine } from '@/server/studio/actions/pos-orders';
import { payPosOrder } from '@/server/studio/actions/pos-payments';
import { setOwnPosPin } from '@/server/studio/actions/pos-pin';
import { openPosShift } from '@/server/studio/actions/pos-shifts';
import { codeOf, dataOf, failureOf, GOOD, person, prisma, resetWorld, restaurant, run, useTestDatabase, type Person } from './fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

let a: { id: string };
let manager: Person;
let cashier: Person;
let managerStaffId: string;
let tableId: string;
let juice: string;
let burger: string;

const names = (ar: string, en = ar) => ({ ar: { name: ar }, en: { name: en } });
const PIN = '2580';
const comp = (extra: Record<string, unknown> = {}) => ({ kind: 'PERCENT', value: 100, reason: 'COMP', ...extra });

beforeAll(() => {
  useTestDatabase();
});

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await resetWorld();
  a = await restaurant('Comp A');
  manager = await person('manager', { staff: [a.id, 'MANAGER'] });
  cashier = await person('cashier', { staff: [a.id, 'CASHIER'] });
  dataOf(await run(manager, setOwnPosPin, { pin: PIN, password: GOOD }));
  managerStaffId = (await prisma().posStaff.findFirstOrThrow({ where: { userId: manager.userId } })).id;
  const menu = await prisma().menu.create({
    data: { restaurantId: a.id, name: 'm', slug: 'comp-a', currency: 'IQD', locales: ['ar', 'en'], defaultLocale: 'ar', timezone: 'Asia/Baghdad' },
  });
  // Approval is switched OFF: a comp must still need a manager.
  await prisma().posSettings.upsert({ where: { restaurantId: a.id }, create: { restaurantId: a.id, catalogMenuId: menu.id, requireApproval: false }, update: { catalogMenuId: menu.id, requireApproval: false } });
  const category = await prisma().category.create({ data: { menuId: menu.id, slug: 'food', sortOrder: 1, translations: names('أكل', 'Food') } });
  juice = (await prisma().product.create({ data: { menuId: menu.id, categoryId: category.id, slug: 'juice', sortOrder: 1, basePrice: 2000, translations: names('عصير', 'Juice') } })).id;
  burger = (await prisma().product.create({ data: { menuId: menu.id, categoryId: category.id, slug: 'burger', sortOrder: 2, basePrice: 5000, translations: names('برغر', 'Burger') } })).id;
  const areaId = dataOf(await run(manager, createPosArea, { name: 'Hall' })).areaId;
  await run(manager, createPosTables, { areaId, from: 1, to: 2 });
  tableId = (await prisma().posTable.findFirstOrThrow({ where: { restaurantId: a.id }, orderBy: { number: 'asc' } })).id;
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

/** Two juices (4,000) and a burger (5,000) on one order. */
async function order(who: Person = cashier, table: string = tableId) {
  const opened = dataOf(await run(who, openPosOrder, { tableId: table }));
  const first = dataOf(await run(who, addPosLine, { orderId: opened.orderId, productId: juice, quantity: 2, note: '', optionIds: [], expectedVersion: opened.version }));
  const second = dataOf(await run(who, addPosLine, { orderId: opened.orderId, productId: burger, quantity: 1, note: '', optionIds: [], expectedVersion: first.version }));
  return { orderId: opened.orderId, juiceLine: first.lineId, version: second.version };
}

describe('a comp (ضيافة)', () => {
  it('needs a manager PIN from a cashier even when approval is switched off', async () => {
    const { juiceLine, version } = await order();
    const refused = await run(cashier, updatePosLine, { lineId: juiceLine, discount: comp(), expectedVersion: version });
    expect(JSON.stringify(failureOf(refused))).toContain('Manager approval is needed');
    const done = await run(cashier, updatePosLine, { lineId: juiceLine, discount: comp(), approval: { staffId: managerStaffId, pin: PIN }, expectedVersion: version });
    dataOf(done);
    const line = await prisma().posOrderLine.findFirstOrThrow({ where: { id: juiceLine } });
    expect(line).toMatchObject({ discountKind: 'PERCENT', discountValue: 100, discountReason: 'COMP', discountApprovedByStaffId: managerStaffId });
  });

  it('is always a full discount, whatever value was sent', async () => {
    const { juiceLine, version } = await order(manager);
    dataOf(await run(manager, updatePosLine, { lineId: juiceLine, discount: comp({ kind: 'AMOUNT', value: 10 }), expectedVersion: version }));
    const line = await prisma().posOrderLine.findFirstOrThrow({ where: { id: juiceLine } });
    expect(line).toMatchObject({ discountKind: 'PERCENT', discountValue: 100, discountReason: 'COMP' });
  });

  it('lets a manager comp the whole bill without a second person, and a cashier needs the PIN for that too', async () => {
    const { orderId, version } = await order(manager);
    expect(codeOf(await run(manager, setPosInvoiceDiscount, { orderId, discount: comp(), expectedVersion: version }))).toBe('OK');
    const second = await prisma().posTable.findFirstOrThrow({ where: { restaurantId: a.id }, orderBy: { number: 'desc' } });
    const other = await order(cashier, second.id);
    const refused = await run(cashier, setPosInvoiceDiscount, { orderId: other.orderId, discount: comp(), expectedVersion: other.version });
    expect(JSON.stringify(failureOf(refused))).toContain('Manager approval is needed');
  });

  it('is counted on its own in the shift report, apart from other discounts', async () => {
    const shiftId = dataOf(await run(manager, openPosShift, { openingFloat: 0 })).shiftId;
    const { orderId, juiceLine, version } = await order(manager);
    const compd = dataOf(await run(manager, updatePosLine, { lineId: juiceLine, discount: comp(), expectedVersion: version }));
    dataOf(await run(manager, payPosOrder, { orderId, expectedVersion: compd.version, expectedTotal: 5_000, amountReceived: 5_000 }));
    const report = await readShiftReport(prisma(), a.id, shiftId);
    expect(report.compsTotal).toBe(4_000);
    expect(report.discountsTotal).toBe(4_000);
    expect(report.grossSales).toBe(5_000);
  });
});
