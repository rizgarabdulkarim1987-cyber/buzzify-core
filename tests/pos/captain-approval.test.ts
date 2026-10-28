import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCatalog, getTenant } from '@/server/data/public-menu';
import { QR_LIMITS } from '@/server/domain/pos/customer-order-rules';
import { approveRequestIn } from '@/server/pos/customer-orders';
import { readGuestRequest, submitCustomerOrder } from '@/server/pos/customer-orders-guest';
import {
  acceptPosRequest,
  addPosRequestLine,
  approvePosRequest,
  rejectPosRequest,
  removePosRequestLine,
  setPosRequestLineQuantity,
} from '@/server/studio/actions/pos-requests';
import { posQrFlags, posRequest, posRequests } from '@/server/studio/queries/pos-requests';
import { publishFixture } from '../helpers/db';
import { ask, codeOf, dataOf, failureOf, person, prisma, resetWorld, restaurant, run, useTestDatabase, type Person } from './fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };
const en = (name: string) => ({ en: { name } });
const SLUG = 'captain-a';

let a: { id: string };
let manager: Person;
let cashier: Person;
let captain: Person;
let kitchen: Person;
let burger = '';
let juice = '';
let cake = '';

beforeAll(() => {
  useTestDatabase();
});

beforeEach(async () => {
  await resetWorld();
  a = await restaurant('Captain A');
  manager = await person('manager', { staff: [a.id, 'MANAGER'] });
  cashier = await person('cashier', { staff: [a.id, 'CASHIER'] });
  captain = await person('captain', { staff: [a.id, 'CAPTAIN'] });
  kitchen = await person('kitchen', { staff: [a.id, 'KITCHEN'] });

  const menu = await prisma().menu.create({
    data: { restaurantId: a.id, name: 'm', slug: SLUG, currency: 'IQD', locales: ['en'], defaultLocale: 'en', timezone: 'Asia/Baghdad' },
  });
  await prisma().menuSlug.create({ data: { slug: SLUG, menuId: menu.id } });
  const category = await prisma().category.create({ data: { menuId: menu.id, slug: 'food', sortOrder: 1, translations: en('Food') } });
  const product = (slug: string, basePrice: number, name: string) =>
    prisma().product.create({ data: { menuId: menu.id, categoryId: category.id, slug, sortOrder: 1, basePrice, translations: en(name) } });
  burger = (await product('burger', 5000, 'Burger')).id;
  juice = (await product('juice', 2000, 'Juice')).id;
  cake = (await product('cake', 3000, 'Cake')).id;
  await publishFixture(prisma(), menu.id);
  await prisma().posSettings.create({ data: { restaurantId: a.id, qrOrderingEnabled: true, catalogMenuId: menu.id, captainApproval: false } });
  const areaId = (await prisma().posArea.create({ data: { restaurantId: a.id, name: 'Hall' } })).id;
  await prisma().posTable.createMany({ data: [1, 2, 3].map((number) => ({ restaurantId: a.id, areaId, number })) });
});

afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

const setSwitch = (on: boolean) => prisma().posSettings.updateMany({ where: { restaurantId: a.id }, data: { captainApproval: on } });

/** A guest's order sent from the table page, through the same function the route calls. */
async function guest(options: { table?: number; lines?: { productId: string; quantity?: number }[]; now?: Date } = {}) {
  const tenant = (await getTenant(SLUG))!;
  const catalog = await getCatalog(tenant);
  const lines = (options.lines ?? [{ productId: burger, quantity: 2 }]).map((line) => ({ productId: line.productId, variantId: null, optionIds: [], quantity: line.quantity ?? 1, note: '' }));
  const { publicId } = await submitCustomerOrder(prisma(), tenant, catalog, { table: options.table ?? 1, locale: 'en', lines, bundleCount: 0, note: '' }, options.now);
  const row = await prisma().posCustomerOrder.findUniqueOrThrow({ where: { publicId }, include: { lines: { orderBy: { id: 'asc' } } } });
  return { ...row, publicId };
}

const stored = (id: string) => prisma().posCustomerOrder.findUniqueOrThrow({ where: { id }, include: { lines: { orderBy: { id: 'asc' } } } });
const orders = () => prisma().posOrder.count({ where: { restaurantId: a.id } });
const guestView = async (publicId: string, table = 1) => (await readGuestRequest(prisma(), (await getTenant(SLUG))!, table, publicId))!;

describe('(a) with the switch off', () => {
  it('stores the guest order free of the captain and the cashier accepts it as before', async () => {
    const req = await guest();
    expect(req.requiresCaptain).toBe(false);
    expect((await guestView(req.publicId)).awaitingCaptain).toBe(false);
    const list = dataOf(await ask(cashier, posRequests, {})).requests;
    expect(list[0]).toMatchObject({ id: req.id, awaitingCaptain: false });
    const done = dataOf(await run(cashier, acceptPosRequest, { requestId: req.id }));
    expect(done.created).toBe(true);
    expect(await stored(req.id)).toMatchObject({ status: 'ACCEPTED', orderId: done.orderId, captainApprovedAt: null });
  });
});

describe('(b) with the switch on', () => {
  it('holds the order for the captain: the cashier is refused, then accepts once the captain approved', async () => {
    await setSwitch(true);
    const req = await guest();
    expect(req.requiresCaptain).toBe(true);
    expect(dataOf(await ask(cashier, posRequest, { requestId: req.id })).awaitingCaptain).toBe(true);

    const refused = failureOf(await run(cashier, acceptPosRequest, { requestId: req.id }));
    expect(refused).toMatchObject({ code: 'CONFLICT', message: 'Waiting for the captain' });
    expect(await orders()).toBe(0);
    expect((await stored(req.id)).status).toBe('PENDING');

    dataOf(await run(captain, approvePosRequest, { requestId: req.id }));
    const approved = await stored(req.id);
    expect(approved).toMatchObject({ status: 'PENDING', captainApprovedByUserId: captain.userId });
    expect(approved.captainApprovedAt).toBeInstanceOf(Date);
    const audit = await prisma().auditLog.findFirst({ where: { action: 'pos.request.approve', entityId: req.id } });
    expect(audit).toMatchObject({ actorId: captain.userId, restaurantId: a.id });
    expect(dataOf(await ask(cashier, posRequest, { requestId: req.id })).awaitingCaptain).toBe(false);

    const done = dataOf(await run(cashier, acceptPosRequest, { requestId: req.id }));
    expect(await stored(req.id)).toMatchObject({ status: 'ACCEPTED', orderId: done.orderId });
    expect(await orders()).toBe(1);
  });

  it('refuses the cashier even when the table has a live order, and leaves that order untouched', async () => {
    const req0 = await guest();
    const opened = dataOf(await run(cashier, acceptPosRequest, { requestId: req0.id }));
    await setSwitch(true);
    const req = await guest();
    const before = await prisma().posOrder.findUniqueOrThrow({ where: { id: opened.orderId } });
    expect(codeOf(await run(cashier, acceptPosRequest, { requestId: req.id, expectedOrderVersion: before.version }))).toBe('CONFLICT');
    const after = await prisma().posOrder.findUniqueOrThrow({ where: { id: opened.orderId } });
    expect(after.version).toBe(before.version);
    expect(await prisma().posOrderLine.count({ where: { orderId: opened.orderId } })).toBe(1);
  });
});

describe('(c) who may approve', () => {
  it('refuses the cashier and the kitchen, and lets a manager approve', async () => {
    await setSwitch(true);
    const req = await guest();
    expect(codeOf(await run(cashier, approvePosRequest, { requestId: req.id }))).toBe('FORBIDDEN');
    expect(codeOf(await run(kitchen, approvePosRequest, { requestId: req.id }))).toBe('FORBIDDEN');
    expect((await stored(req.id)).captainApprovedAt).toBeNull();
    dataOf(await run(manager, approvePosRequest, { requestId: req.id }));
    expect((await stored(req.id)).captainApprovedByUserId).toBe(manager.userId);
  });
});

describe('(d) the captain edits a waiting order', () => {
  it('changes a quantity, removes a line, adds a line priced from the catalog, and replaces one by remove + add', async () => {
    await setSwitch(true);
    const req = await guest({ lines: [{ productId: burger, quantity: 1 }, { productId: juice, quantity: 1 }] });
    const [burgerLine, juiceLine] = req.lines;
    dataOf(await run(captain, setPosRequestLineQuantity, { lineId: burgerLine!.id, quantity: 3 }));
    dataOf(await run(captain, removePosRequestLine, { lineId: juiceLine!.id }));
    // Replace the burger by a cake: remove, then add.
    dataOf(await run(captain, removePosRequestLine, { lineId: burgerLine!.id }));
    dataOf(await run(captain, addPosRequestLine, { requestId: req.id, productId: cake, quantity: 2, note: ' no sugar ' }));
    const after = await stored(req.id);
    expect(after.lines).toHaveLength(1);
    expect(after.lines[0]).toMatchObject({ productId: cake, nameSnapshot: 'Cake', unitPriceSnapshot: 3000, quantity: 2, note: 'no sugar', promoDiscountPerUnit: 0 });
    expect(after.lines[0]!.optionsSnapshot).toEqual([]);
    expect(dataOf(await ask(captain, posRequest, { requestId: req.id })).total).toBe(6000);
    const audits = await prisma().auditLog.count({ where: { action: 'pos.request.edit', actorId: captain.userId } });
    expect(audits).toBe(4);
  });

  it('refuses a sold-out product, a product of no catalog, too many lines and a quantity over the limit', async () => {
    await setSwitch(true);
    const req = await guest();
    await prisma().posProductSetting.create({ data: { restaurantId: a.id, productId: juice, soldOutOverride: true } });
    expect(failureOf(await run(captain, addPosRequestLine, { requestId: req.id, productId: juice, quantity: 1 }))).toMatchObject({ code: 'CONFLICT', message: 'This product is not available' });
    expect(codeOf(await run(captain, addPosRequestLine, { requestId: req.id, productId: 'c000000000000000000000000', quantity: 1 }))).toBe('CONFLICT');
    expect(codeOf(await run(captain, addPosRequestLine, { requestId: req.id, productId: cake, quantity: QR_LIMITS.maxQuantity + 1 }))).toBe('INVALID');
    await prisma().posCustomerOrderLine.createMany({
      data: Array.from({ length: QR_LIMITS.maxLines - 1 }, () => ({ restaurantId: a.id, requestId: req.id, productId: cake, nameSnapshot: 'Cake', unitPriceSnapshot: 3000, optionsSnapshot: [], quantity: 1 })),
    });
    expect(codeOf(await run(captain, addPosRequestLine, { requestId: req.id, productId: cake, quantity: 1 }))).toBe('CONFLICT');
    expect((await stored(req.id)).lines).toHaveLength(QR_LIMITS.maxLines);
  });

  it('lets the captain reject a waiting order', async () => {
    await setSwitch(true);
    const req = await guest();
    dataOf(await run(captain, rejectPosRequest, { requestId: req.id, reason: 'kitchen closed' }));
    expect(await stored(req.id)).toMatchObject({ status: 'REJECTED', decidedByUserId: captain.userId, captainApprovedAt: null });
  });
});

describe('edits after the approval', () => {
  /** A held order the captain approved, with two lines. */
  async function approved() {
    await setSwitch(true);
    const req = await guest({ lines: [{ productId: burger, quantity: 1 }, { productId: juice, quantity: 1 }] });
    dataOf(await run(captain, approvePosRequest, { requestId: req.id }));
    return req;
  }

  async function expectHeldAgain(requestId: string) {
    expect(await stored(requestId)).toMatchObject({ captainApprovedAt: null, captainApprovedByUserId: null, status: 'PENDING' });
    expect(failureOf(await run(cashier, acceptPosRequest, { requestId }))).toMatchObject({ code: 'CONFLICT', message: 'Waiting for the captain' });
    expect(await orders()).toBe(0);
    dataOf(await run(captain, approvePosRequest, { requestId }));
    dataOf(await run(cashier, acceptPosRequest, { requestId }));
    expect(await orders()).toBe(1);
  }

  it('a cashier adding a line sends the order back to the captain', async () => {
    const req = await approved();
    expect(dataOf(await run(cashier, addPosRequestLine, { requestId: req.id, productId: cake, quantity: 10 })).sentBack).toBe(true);
    const audit = await prisma().auditLog.findFirst({ where: { action: 'pos.request.edit', actorId: cashier.userId } });
    expect(audit?.changes).toMatchObject({ captainApproval: { before: 'APPROVED', after: 'NEEDED' } });
    await expectHeldAgain(req.id);
  });

  it('a cashier raising a quantity sends the order back to the captain', async () => {
    const req = await approved();
    expect(dataOf(await ask(cashier, posRequest, { requestId: req.id })).captainApproved).toBe(true);
    expect(dataOf(await run(cashier, setPosRequestLineQuantity, { lineId: req.lines[0]!.id, quantity: 20 })).sentBack).toBe(true);
    expect(dataOf(await ask(cashier, posRequest, { requestId: req.id }))).toMatchObject({ captainApproved: false, awaitingCaptain: true });
    await expectHeldAgain(req.id);
  });

  it('a cashier removing a line sends the order back to the captain', async () => {
    const req = await approved();
    expect(dataOf(await run(cashier, removePosRequestLine, { lineId: req.lines[1]!.id })).sentBack).toBe(true);
    await expectHeldAgain(req.id);
  });

  it('keeps the approval when the captain or a manager edits', async () => {
    const req = await approved();
    expect(dataOf(await run(captain, setPosRequestLineQuantity, { lineId: req.lines[0]!.id, quantity: 3 })).sentBack).toBe(false);
    dataOf(await run(manager, addPosRequestLine, { requestId: req.id, productId: cake, quantity: 1 }));
    dataOf(await run(captain, removePosRequestLine, { lineId: req.lines[1]!.id }));
    expect((await stored(req.id)).captainApprovedByUserId).toBe(captain.userId);
    dataOf(await run(cashier, acceptPosRequest, { requestId: req.id }));
  });

  it('leaves an order that needs no captain alone', async () => {
    const req = await guest({ lines: [{ productId: burger, quantity: 1 }, { productId: juice, quantity: 1 }] });
    dataOf(await run(cashier, setPosRequestLineQuantity, { lineId: req.lines[0]!.id, quantity: 4 }));
    dataOf(await run(cashier, removePosRequestLine, { lineId: req.lines[1]!.id }));
    dataOf(await run(cashier, addPosRequestLine, { requestId: req.id, productId: cake, quantity: 1 }));
    expect(await stored(req.id)).toMatchObject({ requiresCaptain: false, captainApprovedAt: null });
    dataOf(await run(cashier, acceptPosRequest, { requestId: req.id }));
  });

  it('refuses approving an order with no items', async () => {
    await setSwitch(true);
    const req = await guest();
    dataOf(await run(captain, removePosRequestLine, { lineId: req.lines[0]!.id }));
    expect(failureOf(await run(captain, approvePosRequest, { requestId: req.id }))).toMatchObject({ code: 'CONFLICT', message: 'The request has no items' });
    expect((await stored(req.id)).captainApprovedAt).toBeNull();
  });
});

describe('(e) the switch is read when the order is sent', () => {
  it('keeps a waiting order held after the switch goes off, and frees the orders sent after', async () => {
    await setSwitch(true);
    const held = await guest({ table: 1 });
    await setSwitch(false);
    const free = await guest({ table: 2 });
    expect((await stored(held.id)).requiresCaptain).toBe(true);
    expect(free.requiresCaptain).toBe(false);
    expect(codeOf(await run(cashier, acceptPosRequest, { requestId: held.id }))).toBe('CONFLICT');
    dataOf(await run(cashier, acceptPosRequest, { requestId: free.id }));
  });

  it('does not hold an order sent before the switch went on', async () => {
    const before = await guest();
    await setSwitch(true);
    dataOf(await run(cashier, acceptPosRequest, { requestId: before.id }));
  });
});

describe('(f) one approval only', () => {
  it('refuses a second approval and changes nothing', async () => {
    await setSwitch(true);
    const req = await guest();
    dataOf(await run(captain, approvePosRequest, { requestId: req.id }));
    const first = await stored(req.id);
    expect(codeOf(await run(manager, approvePosRequest, { requestId: req.id }))).toBe('CONFLICT');
    const second = await stored(req.id);
    expect(second.captainApprovedAt).toEqual(first.captainApprovedAt);
    expect(second.captainApprovedByUserId).toBe(captain.userId);
    expect(await prisma().auditLog.count({ where: { action: 'pos.request.approve' } })).toBe(1);
  });

  it('lets exactly one of two simultaneous approvals win', async () => {
    await setSwitch(true);
    const req = await guest();
    const results = await Promise.all([run(captain, approvePosRequest, { requestId: req.id }), run(manager, approvePosRequest, { requestId: req.id })]);
    expect(results.map(codeOf).sort()).toEqual(['CONFLICT', 'OK']);
  });

  it('refuses approving a rejected order and an order that needs no captain', async () => {
    await setSwitch(true);
    const req = await guest();
    dataOf(await run(cashier, rejectPosRequest, { requestId: req.id, reason: '' }));
    expect(failureOf(await run(captain, approvePosRequest, { requestId: req.id }))).toMatchObject({ code: 'CONFLICT', message: 'This request was already decided' });
    expect(await stored(req.id)).toMatchObject({ status: 'REJECTED', captainApprovedAt: null });
    await setSwitch(false);
    const free = await guest({ table: 2 });
    expect(codeOf(await run(captain, approvePosRequest, { requestId: free.id }))).toBe('CONFLICT');
    expect((await stored(free.id)).captainApprovedAt).toBeNull();
  });
});

describe('(g) an expired order', () => {
  it('refuses the approval and every edit', async () => {
    await setSwitch(true);
    const req = await guest({ now: new Date(Date.now() - (QR_LIMITS.expiryMinutes + 1) * 60_000) });
    expect(req.requiresCaptain).toBe(true);
    expect(failureOf(await run(captain, approvePosRequest, { requestId: req.id }))).toMatchObject({ code: 'CONFLICT', message: 'This request expired' });
    expect(codeOf(await run(captain, setPosRequestLineQuantity, { lineId: req.lines[0]!.id, quantity: 4 }))).toBe('CONFLICT');
    expect(codeOf(await run(captain, removePosRequestLine, { lineId: req.lines[0]!.id }))).toBe('CONFLICT');
    expect(codeOf(await run(captain, addPosRequestLine, { requestId: req.id, productId: cake, quantity: 1 }))).toBe('CONFLICT');
    const after = await stored(req.id);
    expect(after.captainApprovedAt).toBeNull();
    expect(after.lines).toHaveLength(1);
    expect(after.lines[0]!.quantity).toBe(2);
  });

  it('refuses approving once the clock passed the expiry', async () => {
    await setSwitch(true);
    const req = await guest();
    const later = new Date(Date.now() + (QR_LIMITS.expiryMinutes + 1) * 60_000);
    await expect(approveRequestIn(prisma(), a.id, { requestId: req.id, userId: captain.userId }, later)).rejects.toMatchObject({ code: 'CONFLICT', message: 'This request expired' });
    expect((await stored(req.id)).captainApprovedAt).toBeNull();
  });
});

describe('(h) the guest sees the captain step', () => {
  it('shows awaitingCaptain until the captain approved', async () => {
    await setSwitch(true);
    const req = await guest();
    expect(await guestView(req.publicId)).toMatchObject({ status: 'PENDING', awaitingCaptain: true });
    dataOf(await run(captain, approvePosRequest, { requestId: req.id }));
    expect(await guestView(req.publicId)).toMatchObject({ status: 'PENDING', awaitingCaptain: false });
    dataOf(await run(cashier, acceptPosRequest, { requestId: req.id }));
    expect(await guestView(req.publicId)).toMatchObject({ status: 'ACCEPTED', awaitingCaptain: false });
  });
});

describe('(i) the captain cannot accept', () => {
  it('refuses the captain the cashier step but lets them read the requests', async () => {
    const req = await guest();
    expect(codeOf(await run(captain, acceptPosRequest, { requestId: req.id }))).toBe('FORBIDDEN');
    expect(await orders()).toBe(0);
    expect(dataOf(await ask(captain, posRequests, {})).requests.map((r) => r.id)).toEqual([req.id]);
    expect(dataOf(await ask(captain, posRequest, { requestId: req.id })).id).toBe(req.id);
    expect(dataOf(await ask(captain, posQrFlags, {})).qrOrdering).toBe(true);
    expect((await ask(kitchen, posRequests, {})).ok).toBe(false);
  });
});
