import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as billCall } from '@/app/api/[tenant]/bill-call/route';
import { getTenant } from '@/server/data/public-menu';
import { delegates, scopedClient } from '@/server/data/tenant-db';
import { callForBill, listOpenBillCalls } from '@/server/pos/bill-calls';
import { QrGateClosed, QrOrderRefusal } from '@/server/pos/customer-orders-guest';
import { markBillCallSeen } from '@/server/studio/actions/pos-captain';
import { posQrFlags } from '@/server/studio/queries/pos-requests';
import { publishFixture } from '../helpers/db';
import { ask, codeOf, dataOf, person, prisma, resetWorld, restaurant, run, useTestDatabase, type Person } from './fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };
const SLUG = 'bill-a';

let a: { id: string };
let tableIds: string[] = [];
let captain: Person;
let cashier: Person;
let kitchen: Person;
let ip = 0;

const tenant = async () => (await getTenant(SLUG))!;
const call = async (table: number, now?: Date) => callForBill(prisma(), await tenant(), { table }, now);
const calls = () => prisma().posBillCall.findMany({ where: { restaurantId: a.id }, orderBy: { createdAt: 'asc' } });
const order = (tableIndex: number, status: 'OPEN' | 'READY' | 'PAID' | 'CANCELLED' | 'PENDING_APPROVAL' | 'BILL_REQUESTED', number = tableIndex + 1) =>
  prisma().posOrder.create({ data: { restaurantId: a.id, tableId: tableIds[tableIndex]!, kind: 'DINE_IN', status, number } });
const statusOf = async (id: string) => (await prisma().posOrder.findUniqueOrThrow({ where: { id } })).status;
const markAllSeen = () => prisma().posBillCall.updateMany({ where: { restaurantId: a.id }, data: { seenAt: new Date() } });

beforeAll(() => {
  useTestDatabase();
});

async function world(captainApproval: boolean) {
  await resetWorld();
  a = await restaurant('Bill A');
  captain = await person('captain', { staff: [a.id, 'CAPTAIN'] });
  cashier = await person('cashier', { staff: [a.id, 'CASHIER'] });
  kitchen = await person('kitchen', { staff: [a.id, 'KITCHEN'] });
  const menu = await prisma().menu.create({
    data: { restaurantId: a.id, name: 'm', slug: SLUG, currency: 'IQD', locales: ['en'], defaultLocale: 'en', timezone: 'Asia/Baghdad' },
  });
  await prisma().menuSlug.create({ data: { slug: SLUG, menuId: menu.id } });
  const category = await prisma().category.create({ data: { menuId: menu.id, slug: 'food', sortOrder: 1, translations: { en: { name: 'Food' } } } });
  await prisma().product.create({ data: { menuId: menu.id, categoryId: category.id, slug: 'burger', sortOrder: 1, basePrice: 5000, translations: { en: { name: 'Burger' } } } });
  await publishFixture(prisma(), menu.id);
  await prisma().posSettings.create({ data: { restaurantId: a.id, qrOrderingEnabled: true, catalogMenuId: menu.id, captainApproval } });
  const areaId = (await prisma().posArea.create({ data: { restaurantId: a.id, name: 'Hall' } })).id;
  await prisma().posTable.createMany({ data: [1, 2, 3].map((number) => ({ restaurantId: a.id, areaId, number })) });
  tableIds = (await prisma().posTable.findMany({ where: { restaurantId: a.id }, orderBy: { number: 'asc' } })).map((t) => t.id);
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

describe.each([false, true])('a guest asks for the bill (captain approval %s)', (approval) => {
  beforeEach(async () => {
    await world(approval);
  });

  it('moves an OPEN order to BILL_REQUESTED and records one unseen call', async () => {
    const open = await order(0, 'OPEN');
    await call(1);
    expect(await statusOf(open.id)).toBe('BILL_REQUESTED');
    expect((await prisma().posOrder.findUniqueOrThrow({ where: { id: open.id } })).version).toBe(open.version + 1);
    const rows = await calls();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tableNumber: 1, seenAt: null });
  });

  it('moves a READY order too', async () => {
    const ready = await order(0, 'READY');
    await call(1);
    expect(await statusOf(ready.id)).toBe('BILL_REQUESTED');
  });

  it('a second call while the first is unseen adds nothing', async () => {
    await order(0, 'OPEN');
    await call(1);
    await call(1);
    expect(await calls()).toHaveLength(1);
  });

  it('a table with no live order gets a call and no order', async () => {
    await call(2);
    expect(await calls()).toHaveLength(1);
    expect(await prisma().posOrder.count({ where: { restaurantId: a.id } })).toBe(0);
  });

  it.each(['PAID', 'CANCELLED', 'PENDING_APPROVAL'] as const)('leaves a %s order alone', async (status) => {
    const o = await order(0, status);
    await call(1);
    expect(await statusOf(o.id)).toBe(status);
    expect(await calls()).toHaveLength(1);
  });

  it('refuses a fourth call within ten minutes once earlier ones were seen', async () => {
    const t0 = new Date();
    for (let i = 0; i < 3; i += 1) {
      await call(1, new Date(t0.getTime() + i * 1000));
      await markAllSeen();
    }
    await expect(call(1, new Date(t0.getTime() + 5000))).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
    await expect(call(1, new Date(t0.getTime() + 5000))).rejects.toBeInstanceOf(QrOrderRefusal);
    expect(await calls()).toHaveLength(3);
    // Another table is not held back, and the window ends.
    await call(2, new Date(t0.getTime() + 5000));
    await call(1, new Date(t0.getTime() + 11 * 60_000));
    expect(await calls()).toHaveLength(5);
  });

  it('is closed when QR ordering is off or the table is unknown', async () => {
    await expect(call(99)).rejects.toBeInstanceOf(QrGateClosed);
    await prisma().posSettings.updateMany({ where: { restaurantId: a.id }, data: { qrOrderingEnabled: false } });
    await expect(call(1)).rejects.toBeInstanceOf(QrGateClosed);
    expect(await calls()).toHaveLength(0);
  });

  it('records the call and leaves the order alone when staff change it at the same moment', async () => {
    const open = await order(0, 'OPEN');
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held: () => void = () => undefined;
    const holding = new Promise<void>((resolve) => {
      held = resolve;
    });
    // Staff edit the order (row lock held, not yet committed) while the guest's call runs.
    const staff = prisma().$transaction(async (tx) => {
      await tx.posOrder.update({ where: { id: open.id }, data: { version: { increment: 1 }, status: 'PAID' } });
      held();
      await gate;
    });
    await holding;
    const guest = call(1);
    await new Promise((resolve) => setTimeout(resolve, 800));
    release();
    await staff;
    await expect(guest).resolves.toEqual({ ok: true });
    const after = await prisma().posOrder.findUniqueOrThrow({ where: { id: open.id } });
    expect(after.status).toBe('PAID');
    expect(after.version).toBe(open.version + 1);
    expect(await calls()).toHaveLength(1);
  });

  it('audits a call, with the order it moved, and audits nothing for a repeat', async () => {
    const open = await order(0, 'OPEN');
    await call(1);
    await call(1);
    const rows = await prisma().auditLog.findMany({ where: { restaurantId: a.id, action: 'pos.billCall.call' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorId: null, entityType: 'PosBillCall' });
    expect(rows[0]!.changes).toMatchObject({ tableNumber: { before: null, after: 1 }, orderStatus: { before: 'OPEN', after: 'BILL_REQUESTED' }, orderId: open.id });
  });

  it('is listed open and marked seen by a captain or a cashier, not by the kitchen', async () => {
    await call(1);
    await call(3);
    const db = delegates(scopedClient(prisma(), { restaurantId: a.id }));
    const open = await listOpenBillCalls(db, a.id);
    expect(open.map((c) => c.tableNumber).sort()).toEqual([1, 3]);
    expect(dataOf(await ask(captain, posQrFlags, {}))).toMatchObject({ billCalls: 2 });

    expect(codeOf(await run(kitchen, markBillCallSeen, { id: open[0]!.id }))).toBe('FORBIDDEN');
    expect(dataOf(await run(captain, markBillCallSeen, { id: open[0]!.id }))).toEqual({ ok: true });
    expect(codeOf(await run(cashier, markBillCallSeen, { id: open[1]!.id }))).toBe('OK');
    expect(await listOpenBillCalls(db, a.id)).toEqual([]);
    const seen = await calls();
    expect(seen.every((c) => c.seenAt !== null && c.seenByUserId !== null)).toBe(true);
    expect(await prisma().auditLog.count({ where: { action: 'pos.billCall.seen' } })).toBe(2);
    // A call already seen is not an error.
    expect(codeOf(await run(captain, markBillCallSeen, { id: open[0]!.id }))).toBe('OK');
  });

  it('answers the route like the order route', async () => {
    const post = (body: unknown) =>
      billCall(
        new Request(`http://localhost/api/${SLUG}/bill-call`, {
          method: 'POST',
          body: JSON.stringify(body),
          headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.3.0.${++ip}` },
        }),
        { params: Promise.resolve({ tenant: SLUG }) },
      );
    expect((await post({ table: 1 })).status).toBe(200);
    expect((await post({ table: 99 })).status).toBe(404);
    expect((await post({ table: 'x' })).status).toBe(400);
    await markAllSeen();
    await post({ table: 1 });
    await markAllSeen();
    await post({ table: 1 });
    await markAllSeen();
    const limited = await post({ table: 1 });
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('60');
  });
});
