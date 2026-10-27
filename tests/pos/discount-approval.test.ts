import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { addPosLine, cancelPosLine, cancelPosOrder, openPosOrder, setPosInvoiceDiscount, updatePosLine } from '@/server/studio/actions/pos-orders';
import { createPosArea, createPosTables } from '@/server/studio/actions/pos';
import { setOwnPosPin } from '@/server/studio/actions/pos-pin';
import { codeOf, dataOf, failureOf, GOOD, person, prisma, resetWorld, restaurant, run, useTestDatabase, type Person } from './fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

let a: { id: string };
let b: { id: string };
let manager: Person;
let cashier: Person;
let bManager: Person;
let managerStaffId: string;
let tableId: string;
let juice: string;

const names = (ar: string, en = ar) => ({ ar: { name: ar }, en: { name: en } });
const PIN = '2580';

beforeAll(() => {
  useTestDatabase();
});

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await resetWorld();
  a = await restaurant('Approve A');
  b = await restaurant('Approve B');
  manager = await person('manager', { staff: [a.id, 'MANAGER'] });
  cashier = await person('cashier', { staff: [a.id, 'CASHIER'] });
  bManager = await person('bmanager', { staff: [b.id, 'MANAGER'] });
  for (const who of [manager, bManager]) dataOf(await run(who, setOwnPosPin, { pin: PIN, password: GOOD }));
  managerStaffId = (await prisma().posStaff.findFirstOrThrow({ where: { userId: manager.userId } })).id;

  const menu = await prisma().menu.create({
    data: { restaurantId: a.id, name: 'm', slug: 'approve-a', currency: 'IQD', locales: ['ar', 'en'], defaultLocale: 'ar', timezone: 'Asia/Baghdad' },
  });
  await prisma().posSettings.upsert({ where: { restaurantId: a.id }, create: { restaurantId: a.id, catalogMenuId: menu.id }, update: { catalogMenuId: menu.id } });
  const category = await prisma().category.create({ data: { menuId: menu.id, slug: 'food', sortOrder: 1, translations: names('أكل', 'Food') } });
  juice = (await prisma().product.create({ data: { menuId: menu.id, categoryId: category.id, slug: 'juice', sortOrder: 1, basePrice: 2000, translations: names('عصير', 'Juice') } })).id;
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

async function withLine(who: Person = cashier) {
  const opened = dataOf(await run(who, openPosOrder, { tableId }));
  const added = dataOf(await run(who, addPosLine, { orderId: opened.orderId, productId: juice, quantity: 2, note: '', optionIds: [], expectedVersion: opened.version }));
  return { orderId: opened.orderId, lineId: added.lineId, version: added.version };
}

const good = { staffId: '', pin: PIN };
const approval = () => ({ ...good, staffId: managerStaffId });
const discount = (extra: Record<string, unknown> = {}) => ({ kind: 'PERCENT', value: 10, reason: 'COMPLAINT', ...extra });
const needsApproval = (r: Parameters<typeof failureOf>[0]) => expect(JSON.stringify(failureOf(r))).toContain('Manager approval is needed');

describe('a discount carries a reason', () => {
  it('refuses a discount without a reason, and OTHER without a note', async () => {
    const { orderId, version } = await withLine(manager);
    expect(codeOf(await run(manager, setPosInvoiceDiscount, { orderId, discount: { kind: 'PERCENT', value: 10 }, expectedVersion: version }))).toBe('INVALID');
    expect(codeOf(await run(manager, setPosInvoiceDiscount, { orderId, discount: discount({ reason: 'OTHER' }), expectedVersion: version }))).toBe('INVALID');
    expect(codeOf(await run(manager, setPosInvoiceDiscount, { orderId, discount: discount({ reason: 'OTHER', note: '   ' }), expectedVersion: version }))).toBe('INVALID');
    dataOf(await run(manager, setPosInvoiceDiscount, { orderId, discount: discount({ reason: 'OTHER', note: 'owner friend' }), expectedVersion: version }));
  });

  it('lets a manager discount alone and stores the reason with no approver', async () => {
    const { orderId, version } = await withLine(manager);
    dataOf(await run(manager, setPosInvoiceDiscount, { orderId, discount: discount(), expectedVersion: version }));
    expect(await prisma().posOrder.findUniqueOrThrow({ where: { id: orderId } })).toMatchObject({
      invoiceDiscountKind: 'PERCENT',
      invoiceDiscountReason: 'COMPLAINT',
      invoiceDiscountApprovedByStaffId: null,
    });
  });

  it('clears a discount without a reason or an approval', async () => {
    const { orderId, version } = await withLine(manager);
    const set = dataOf(await run(manager, setPosInvoiceDiscount, { orderId, discount: discount(), expectedVersion: version }));
    dataOf(await run(cashier, setPosInvoiceDiscount, { orderId, discount: null, expectedVersion: set.version }));
    expect((await prisma().posOrder.findUniqueOrThrow({ where: { id: orderId } })).invoiceDiscountKind).toBeNull();
  });
});

describe('a cashier needs a manager on the spot', () => {
  it('refuses an invoice discount with no approval, and changes nothing', async () => {
    const { orderId, version } = await withLine();
    needsApproval(await run(cashier, setPosInvoiceDiscount, { orderId, discount: discount(), expectedVersion: version }));
    expect((await prisma().posOrder.findUniqueOrThrow({ where: { id: orderId } })).invoiceDiscountKind).toBeNull();
  });

  it('refuses a wrong PIN and a manager of another restaurant', async () => {
    const { orderId, version } = await withLine();
    const bStaff = (await prisma().posStaff.findFirstOrThrow({ where: { userId: bManager.userId } })).id;
    expect(codeOf(await run(cashier, setPosInvoiceDiscount, { orderId, discount: discount(), approval: { staffId: managerStaffId, pin: '1357' }, expectedVersion: version }))).toBe('FORBIDDEN');
    expect(codeOf(await run(cashier, setPosInvoiceDiscount, { orderId, discount: discount(), approval: { staffId: bStaff, pin: PIN }, expectedVersion: version }))).toBe('FORBIDDEN');
    expect((await prisma().posOrder.findUniqueOrThrow({ where: { id: orderId } })).invoiceDiscountKind).toBeNull();
  });

  it('accepts a valid approval, stores who approved, and audits the approver and reason', async () => {
    const { orderId, version } = await withLine();
    dataOf(await run(cashier, setPosInvoiceDiscount, { orderId, discount: discount(), approval: approval(), expectedVersion: version }));
    expect(await prisma().posOrder.findUniqueOrThrow({ where: { id: orderId } })).toMatchObject({
      invoiceDiscountReason: 'COMPLAINT',
      invoiceDiscountApprovedByStaffId: managerStaffId,
    });
    const row = await prisma().auditLog.findFirstOrThrow({ where: { action: 'pos.order.discount.invoice', entityId: orderId } });
    expect(JSON.stringify(row.changes)).toContain(managerStaffId);
    expect(JSON.stringify(row.changes)).toContain('COMPLAINT');
  });

  it('asks nothing more of a cashier once the restaurant switches approval off, but still wants a reason', async () => {
    await prisma().posSettings.update({ where: { restaurantId: a.id }, data: { requireApproval: false } });
    const { orderId, version } = await withLine();
    expect(codeOf(await run(cashier, setPosInvoiceDiscount, { orderId, discount: { kind: 'PERCENT', value: 5 }, expectedVersion: version }))).toBe('INVALID');
    dataOf(await run(cashier, setPosInvoiceDiscount, { orderId, discount: discount(), expectedVersion: version }));
  });

  it('applies the same rules to a line discount', async () => {
    const { lineId, version } = await withLine();
    needsApproval(await run(cashier, updatePosLine, { lineId, discount: { kind: 'AMOUNT', value: 500, reason: 'STAFF_MEAL' }, expectedVersion: version }));
    expect(codeOf(await run(cashier, updatePosLine, { lineId, discount: { kind: 'AMOUNT', value: 500 }, approval: approval(), expectedVersion: version }))).toBe('INVALID');
    dataOf(await run(cashier, updatePosLine, { lineId, discount: { kind: 'AMOUNT', value: 500, reason: 'STAFF_MEAL' }, approval: approval(), expectedVersion: version }));
    expect(await prisma().posOrderLine.findUniqueOrThrow({ where: { id: lineId } })).toMatchObject({ discountReason: 'STAFF_MEAL', discountApprovedByStaffId: managerStaffId });
  });

  it('does not ask for approval when a line changes only its quantity', async () => {
    const { lineId, version } = await withLine();
    dataOf(await run(cashier, updatePosLine, { lineId, quantity: 3, expectedVersion: version }));
  });
});

describe('cancelling', () => {
  it('lets a cashier cancel an empty order and an unsent line without approval', async () => {
    const empty = dataOf(await run(cashier, openPosOrder, { tableId }));
    dataOf(await run(cashier, cancelPosOrder, { orderId: empty.orderId, reason: '', expectedVersion: empty.version }));
    const { lineId, version } = await withLine();
    dataOf(await run(cashier, cancelPosLine, { lineId, reason: 'changed mind', expectedVersion: version }));
  });

  it('needs approval to cancel a line already sent to the kitchen', async () => {
    const { lineId, version } = await withLine();
    await prisma().posOrderLine.update({ where: { id: lineId }, data: { sentAt: new Date() } });
    needsApproval(await run(cashier, cancelPosLine, { lineId, reason: 'burnt', expectedVersion: version }));
    dataOf(await run(cashier, cancelPosLine, { lineId, reason: 'burnt', approval: approval(), expectedVersion: version }));
    const row = await prisma().auditLog.findFirstOrThrow({ where: { action: 'pos.order.line.cancel', entityId: lineId } });
    expect(JSON.stringify(row.changes)).toContain(managerStaffId);
  });

  it('needs approval to cancel an order that has lines', async () => {
    const { orderId, version } = await withLine();
    needsApproval(await run(cashier, cancelPosOrder, { orderId, reason: 'guest left', expectedVersion: version }));
    dataOf(await run(cashier, cancelPosOrder, { orderId, reason: 'guest left', approval: approval(), expectedVersion: version }));
    expect((await prisma().posOrder.findUniqueOrThrow({ where: { id: orderId } })).status).toBe('CANCELLED');
  });

  it('lets a manager cancel alone', async () => {
    const { orderId, version } = await withLine(manager);
    dataOf(await run(manager, cancelPosOrder, { orderId, reason: 'guest left', expectedVersion: version }));
  });
});
