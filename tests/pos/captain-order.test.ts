import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { QR_LIMITS } from '@/server/domain/pos/customer-order-rules';
import { placeCaptainOrder } from '@/server/studio/actions/pos-captain';
import { openPosOrder } from '@/server/studio/actions/pos-orders';
import { acceptPosRequest } from '@/server/studio/actions/pos-requests';
import { posOrder } from '@/server/studio/queries/pos';
import { posRequest, posRequests } from '@/server/studio/queries/pos-requests';
import { publishFixture } from '../helpers/db';
import { ask, codeOf, dataOf, person, prisma, resetWorld, restaurant, run, useTestDatabase, type Person } from './fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };
const en = (name: string) => ({ en: { name } });

let a: { id: string };
let manager: Person;
let cashier: Person;
let captain: Person;
let burger = '';
let cake = '';

beforeAll(() => {
  useTestDatabase();
});

beforeEach(async () => {
  await resetWorld();
  a = await restaurant('Captain Order A');
  manager = await person('manager', { staff: [a.id, 'MANAGER'] });
  cashier = await person('cashier', { staff: [a.id, 'CASHIER'] });
  captain = await person('captain', { staff: [a.id, 'CAPTAIN'] });

  const menu = await prisma().menu.create({
    data: { restaurantId: a.id, name: 'm', slug: 'captain-order-a', currency: 'IQD', locales: ['en'], defaultLocale: 'en', timezone: 'Asia/Baghdad' },
  });
  await prisma().menuSlug.create({ data: { slug: 'captain-order-a', menuId: menu.id } });
  const category = await prisma().category.create({ data: { menuId: menu.id, slug: 'food', sortOrder: 1, translations: en('Food') } });
  const product = (slug: string, basePrice: number, name: string) =>
    prisma().product.create({ data: { menuId: menu.id, categoryId: category.id, slug, sortOrder: 1, basePrice, translations: en(name) } });
  burger = (await product('burger', 5000, 'Burger')).id;
  cake = (await product('cake', 3000, 'Cake')).id;
  await publishFixture(prisma(), menu.id);
  await prisma().posSettings.create({ data: { restaurantId: a.id, qrOrderingEnabled: true, catalogMenuId: menu.id, captainApproval: false } });
  const areaId = (await prisma().posArea.create({ data: { restaurantId: a.id, name: 'Hall' } })).id;
  await prisma().posTable.createMany({ data: [1, 2].map((number) => ({ restaurantId: a.id, areaId, number })) });
});

afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

const setting = (data: { captainApproval?: boolean; qrOrderingEnabled?: boolean }) => prisma().posSettings.updateMany({ where: { restaurantId: a.id }, data });
const order = (over: Record<string, unknown> = {}) => ({ tableNumber: 1, lines: [{ productId: burger, quantity: 2 }], ...over });
const requests = () => prisma().posCustomerOrder.count({ where: { restaurantId: a.id } });

describe('the captain orders for a table', () => {
  it('reaches the cashier already approved, who accepts it into an order', async () => {
    const { requestId } = dataOf(await run(captain, placeCaptainOrder, order({ note: 'by mouth' })));
    const row = await prisma().posCustomerOrder.findUniqueOrThrow({ where: { id: requestId }, include: { lines: true } });
    expect(row).toMatchObject({ status: 'PENDING', tableNumber: 1, requiresCaptain: false, captainApprovedByUserId: captain.userId, createdByUserId: captain.userId, customerNote: 'by mouth', locale: 'en' });
    expect(row.captainApprovedAt).toBeInstanceOf(Date);
    expect(row.lines).toHaveLength(1);
    expect(row.lines[0]).toMatchObject({ nameSnapshot: 'Burger', unitPriceSnapshot: 5000, quantity: 2 });

    const list = dataOf(await ask(cashier, posRequests, {})).requests;
    expect(list[0]).toMatchObject({ id: requestId, awaitingCaptain: false });
    const done = dataOf(await run(cashier, acceptPosRequest, { requestId }));
    expect(await prisma().posOrderLine.count({ where: { orderId: done.orderId } })).toBe(1);
    const audit = await prisma().auditLog.findFirst({ where: { action: 'pos.request.captain', entityId: requestId } });
    expect(audit).toMatchObject({ actorId: captain.userId, restaurantId: a.id });
  });

  it('joins the live order of the table when the cashier accepts it with the order version', async () => {
    const table = await prisma().posTable.findFirstOrThrow({ where: { restaurantId: a.id, number: 1 } });
    const opened = dataOf(await run(cashier, openPosOrder, { tableId: table.id }));
    const { requestId } = dataOf(await run(captain, placeCaptainOrder, order({ lines: [{ productId: cake, quantity: 2 }] })));
    const detail = dataOf(await ask(cashier, posRequest, { requestId }));
    expect(detail).toMatchObject({ liveOrderId: opened.orderId, liveOrderVersion: opened.version });
    const done = dataOf(await run(cashier, acceptPosRequest, { requestId, expectedOrderVersion: opened.version }));
    expect(done).toMatchObject({ orderId: opened.orderId, created: false });
    const joined = await prisma().posOrder.findUniqueOrThrow({ where: { id: opened.orderId } });
    expect(joined.version).toBeGreaterThan(opened.version);
    expect(await prisma().posOrder.count({ where: { restaurantId: a.id } })).toBe(1);
    const view = dataOf(await ask(cashier, posOrder, { orderId: opened.orderId }));
    expect(view.lines).toHaveLength(1);
    expect(view.totals.subtotal).toBe(6000);
  });

  it('works with the approval switch on and off, and for a manager', async () => {
    await setting({ captainApproval: true });
    const { requestId } = dataOf(await run(captain, placeCaptainOrder, order()));
    expect(dataOf(await run(cashier, acceptPosRequest, { requestId })).created).toBe(true);
    await setting({ captainApproval: false });
    dataOf(await run(manager, placeCaptainOrder, order({ tableNumber: 2 })));
    expect(await requests()).toBe(2);
  });

  it('is not held back by the guests rate limits', async () => {
    for (let i = 0; i < QR_LIMITS.pendingPerTable + 1; i += 1) dataOf(await run(captain, placeCaptainOrder, order()));
    expect(await requests()).toBe(QR_LIMITS.pendingPerTable + 1);
  });

  it('refuses a cashier', async () => {
    expect(codeOf(await run(cashier, placeCaptainOrder, order()))).toBe('FORBIDDEN');
    expect(await requests()).toBe(0);
  });

  it('refuses an unknown table, no lines, a sold-out or unknown product and too many', async () => {
    expect(codeOf(await run(captain, placeCaptainOrder, order({ tableNumber: 9 })))).toBe('NOT_FOUND');
    expect(codeOf(await run(captain, placeCaptainOrder, order({ lines: [] })))).toBe('INVALID');
    expect(codeOf(await run(captain, placeCaptainOrder, order({ lines: [{ productId: burger, quantity: QR_LIMITS.maxQuantity + 1 }] })))).toBe('INVALID');
    expect(codeOf(await run(captain, placeCaptainOrder, order({ lines: [{ productId: burger, quantity: 1, note: 'x'.repeat(QR_LIMITS.maxNote + 1) }] })))).toBe('INVALID');
    expect(codeOf(await run(captain, placeCaptainOrder, order({ lines: Array.from({ length: QR_LIMITS.maxLines + 1 }, () => ({ productId: burger, quantity: 1 })) })))).toBe('INVALID');
    await prisma().posProductSetting.create({ data: { restaurantId: a.id, productId: cake, soldOutOverride: true } });
    expect(codeOf(await run(captain, placeCaptainOrder, order({ lines: [{ productId: cake, quantity: 1 }] })))).toBe('CONFLICT');
    expect(codeOf(await run(captain, placeCaptainOrder, order({ lines: [{ productId: 'ckzzzzzzzzzzzzzzzzzzzzzzz', quantity: 1 }] })))).toBe('CONFLICT');
    expect(await requests()).toBe(0);
  });

  it('is refused while ordering from the table is off', async () => {
    await setting({ qrOrderingEnabled: false });
    expect(codeOf(await run(captain, placeCaptainOrder, order()))).toBe('CONFLICT');
    expect(await requests()).toBe(0);
  });
});
