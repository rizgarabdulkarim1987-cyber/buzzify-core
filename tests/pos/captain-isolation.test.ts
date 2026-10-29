import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as billCallRoute } from '@/app/api/[tenant]/bill-call/route';
import { getCatalog, getTenant } from '@/server/data/public-menu';
import { callForBill } from '@/server/pos/bill-calls';
import { submitCustomerOrder } from '@/server/pos/customer-orders-guest';
import { markBillCallSeen, placeCaptainOrder } from '@/server/studio/actions/pos-captain';
import {
  acceptPosRequest,
  addPosRequestLine,
  approvePosRequest,
  rejectPosRequest,
  removePosRequestLine,
  setPosRequestLineQuantity,
} from '@/server/studio/actions/pos-requests';
import { posBillCalls, posRequest, posRequests } from '@/server/studio/queries/pos-requests';
import { publishFixture } from '../helpers/db';
import { ask, codeOf, dataOf, person, prisma, resetWorld, restaurant, run, useTestDatabase, type Person } from './fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };
const en = (name: string) => ({ en: { name } });

interface Side {
  id: string;
  slug: string;
  burger: string;
  captain: Person;
  manager: Person;
}

let a: Side;
let b: Side;
let ip = 0;

beforeAll(() => {
  useTestDatabase();
});

async function side(label: 'a' | 'b'): Promise<Side> {
  const row = await restaurant(`Isolation ${label}`);
  const slug = `iso-${label}`;
  const menu = await prisma().menu.create({
    data: { restaurantId: row.id, name: 'm', slug, currency: 'IQD', locales: ['en'], defaultLocale: 'en', timezone: 'Asia/Baghdad' },
  });
  await prisma().menuSlug.create({ data: { slug, menuId: menu.id } });
  const category = await prisma().category.create({ data: { menuId: menu.id, slug: 'food', sortOrder: 1, translations: en('Food') } });
  const burger = await prisma().product.create({ data: { menuId: menu.id, categoryId: category.id, slug: 'burger', sortOrder: 1, basePrice: 5000, translations: en('Burger') } });
  await publishFixture(prisma(), menu.id);
  await prisma().posSettings.create({ data: { restaurantId: row.id, qrOrderingEnabled: true, catalogMenuId: menu.id, captainApproval: true } });
  const areaId = (await prisma().posArea.create({ data: { restaurantId: row.id, name: 'Hall' } })).id;
  // The same table numbers in both restaurants: a number alone must never reach the other side.
  await prisma().posTable.createMany({ data: [1, 2].map((number) => ({ restaurantId: row.id, areaId, number })) });
  return {
    id: row.id,
    slug,
    burger: burger.id,
    captain: await person(`captain-${label}`, { staff: [row.id, 'CAPTAIN'] }),
    manager: await person(`manager-${label}`, { staff: [row.id, 'MANAGER'] }),
  };
}

beforeEach(async () => {
  await resetWorld();
  a = await side('a');
  b = await side('b');
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

/** A guest order of restaurant B, held for its captain. */
async function guestOfB() {
  const tenant = (await getTenant(b.slug))!;
  const catalog = await getCatalog(tenant);
  const lines = [{ productId: b.burger, variantId: null, optionIds: [], quantity: 2, note: '' }];
  const { publicId } = await submitCustomerOrder(prisma(), tenant, catalog, { table: 1, locale: 'en', lines, bundleCount: 0, note: '' });
  return prisma().posCustomerOrder.findUniqueOrThrow({ where: { publicId }, include: { lines: true } });
}

const post = (slug: string, body: unknown) =>
  billCallRoute(
    new Request(`http://localhost/api/${slug}/bill-call`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.9.0.${++ip}` } }),
    { params: Promise.resolve({ tenant: slug }) },
  );

describe.each([
  ['a captain', () => a.captain, 'FORBIDDEN'],
  ['a manager', () => a.manager, 'NOT_FOUND'],
])('%s of restaurant A and the guest order of restaurant B', (_label, who, acceptCode) => {
  it('cannot approve, edit, reject or accept it, and nothing changes', async () => {
    const req = await guestOfB();
    const line = req.lines[0]!;
    const me = who();
    expect(codeOf(await run(me, approvePosRequest, { requestId: req.id }))).toBe('NOT_FOUND');
    expect(codeOf(await run(me, setPosRequestLineQuantity, { lineId: line.id, quantity: 5 }))).toBe('NOT_FOUND');
    expect(codeOf(await run(me, removePosRequestLine, { lineId: line.id }))).toBe('NOT_FOUND');
    expect(codeOf(await run(me, addPosRequestLine, { requestId: req.id, productId: b.burger, quantity: 1 }))).toBe('CONFLICT');
    expect(codeOf(await run(me, rejectPosRequest, { requestId: req.id, reason: 'x' }))).toBe('NOT_FOUND');
    // Accepting is the cashier's step: a captain is refused outright, a manager reaches the lookup and finds nothing.
    expect(codeOf(await run(me, acceptPosRequest, { requestId: req.id }))).toBe(acceptCode);

    const after = await prisma().posCustomerOrder.findUniqueOrThrow({ where: { id: req.id }, include: { lines: true } });
    expect(after).toMatchObject({ status: 'PENDING', captainApprovedAt: null, requiresCaptain: true });
    expect(after.lines).toHaveLength(1);
    expect(after.lines[0]).toMatchObject({ quantity: 2 });
    expect(await prisma().posOrder.count({ where: { restaurantId: b.id } })).toBe(0);
  });

  it('does not see it in the list or by id', async () => {
    const req = await guestOfB();
    const me = who();
    expect(dataOf(await ask(me, posRequests, {})).requests).toEqual([]);
    expect(codeOf(await ask(me, posRequest, { requestId: req.id }))).toBe('NOT_FOUND');
    // Its own side still sees it: the empty list above is isolation, not an empty world.
    expect(dataOf(await ask(b.manager, posRequests, {})).requests).toHaveLength(1);
  });

  it('cannot order for the table of B: a table number and a product resolve inside A only', async () => {
    const me = who();
    expect(codeOf(await run(me, placeCaptainOrder, { tableNumber: 1, lines: [{ productId: b.burger, quantity: 1 }] }))).toBe('CONFLICT');
    expect(await prisma().posCustomerOrder.count()).toBe(0);
    const ok = dataOf(await run(me, placeCaptainOrder, { tableNumber: 1, lines: [{ productId: a.burger, quantity: 1 }] }));
    expect((await prisma().posCustomerOrder.findUniqueOrThrow({ where: { id: ok.requestId } })).restaurantId).toBe(a.id);
    expect(await prisma().posCustomerOrder.count({ where: { restaurantId: b.id } })).toBe(0);
  });
});

describe('bill calls', () => {
  it('a bill call of B is invisible to A, and A cannot mark it seen', async () => {
    await callForBill(prisma(), (await getTenant(b.slug))!, { table: 1 });
    const call = await prisma().posBillCall.findFirstOrThrow({ where: { restaurantId: b.id } });

    expect(dataOf(await ask(a.captain, posBillCalls, {}))).toEqual([]);
    expect(dataOf(await ask(a.manager, posBillCalls, {}))).toEqual([]);
    expect(dataOf(await ask(b.captain, posBillCalls, {}))).toHaveLength(1);

    // Marking is idempotent and says OK to anyone, so the proof is that the row does not change.
    await run(a.captain, markBillCallSeen, { id: call.id });
    await run(a.manager, markBillCallSeen, { id: call.id });
    expect((await prisma().posBillCall.findUniqueOrThrow({ where: { id: call.id } })).seenAt).toBeNull();
    // Positive control: B's own captain can mark it, so the unchanged row above is isolation, not a broken action.
    await run(b.captain, markBillCallSeen, { id: call.id });
    expect((await prisma().posBillCall.findUniqueOrThrow({ where: { id: call.id } })).seenAt).not.toBeNull();
    expect(dataOf(await ask(b.captain, posBillCalls, {}))).toEqual([]);
  });

  it('a guest asking for the bill at the table of B makes a call for B only, never for A', async () => {
    expect((await post(b.slug, { table: 1 })).status).toBe(200);
    expect(await prisma().posBillCall.count({ where: { restaurantId: a.id } })).toBe(0);
    expect(await prisma().posBillCall.count({ where: { restaurantId: b.id } })).toBe(1);
    expect(dataOf(await ask(a.captain, posBillCalls, {}))).toEqual([]);
  });

  it('the same table number in A and B is two tables: a call at one does not touch the order of the other', async () => {
    const table = await prisma().posTable.findFirstOrThrow({ where: { restaurantId: a.id, number: 1 } });
    const orderA = await prisma().posOrder.create({ data: { restaurantId: a.id, tableId: table.id, kind: 'DINE_IN', status: 'OPEN', number: 1 } });
    await callForBill(prisma(), (await getTenant(b.slug))!, { table: 1 });
    expect((await prisma().posOrder.findUniqueOrThrow({ where: { id: orderA.id } })).status).toBe('OPEN');
  });
});
