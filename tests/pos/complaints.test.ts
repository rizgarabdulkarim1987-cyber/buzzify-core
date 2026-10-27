import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as submit } from '@/app/api/[tenant]/complaint/route';
import { addPosComplaintNote, removePosComplaintContact, setPosComplaintStatus } from '@/server/studio/actions/pos-complaints';
import { openPosOrder } from '@/server/studio/actions/pos-orders';
import { posComplaint, posComplaintBadge, posComplaints } from '@/server/studio/queries/pos-complaints';
import { publishFixture } from '../helpers/db';
import { ask, codeOf, dataOf, failureOf, person, prisma, resetWorld, restaurant, run, useTestDatabase, type Person } from './fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };
const en = (name: string) => ({ en: { name } });

let counter = 0;
let slug = '';
let a: { id: string };
let manager: Person;
let cashier: Person;
let ip = 0;

async function world(options: { enabled?: boolean } = {}) {
  slug = `cm-a-${++counter}`;
  a = await restaurant(`Complaints ${counter}`);
  manager = await person(`manager${counter}`, { staff: [a.id, 'MANAGER'] });
  cashier = await person(`cashier${counter}`, { staff: [a.id, 'CASHIER'] });
  const menu = await prisma().menu.create({ data: { restaurantId: a.id, name: 'm', slug, currency: 'IQD', locales: ['en'], defaultLocale: 'en', timezone: 'Asia/Baghdad' } });
  await prisma().menuSlug.create({ data: { slug, menuId: menu.id } });
  const category = await prisma().category.create({ data: { menuId: menu.id, slug: 'food', sortOrder: 1, translations: en('Food') } });
  await prisma().product.create({ data: { menuId: menu.id, categoryId: category.id, slug: 'burger', sortOrder: 1, basePrice: 5000, translations: en('Burger') } });
  await publishFixture(prisma(), menu.id);
  await prisma().posSettings.create({ data: { restaurantId: a.id, catalogMenuId: menu.id, complaintsEnabled: options.enabled ?? true } });
  const areaId = (await prisma().posArea.create({ data: { restaurantId: a.id, name: 'Hall' } })).id;
  await prisma().posTable.createMany({ data: [1, 2].map((number) => ({ restaurantId: a.id, areaId, number })) });
}

const send = (body: unknown, from?: string) =>
  submit(
    new Request(`http://localhost/api/${slug}/complaint`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', 'x-forwarded-for': from ?? `10.3.0.${++ip}` } }),
    { params: Promise.resolve({ tenant: slug }) },
  );
const complaint = (extra: Record<string, unknown> = {}) => ({ table: 1, locale: 'en', clientKey: randomUUID().replace(/-/g, ''), body: 'The soup was cold', ...extra });

beforeAll(() => {
  useTestDatabase();
});

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await resetWorld();
  await world();
});

afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

describe('a guest sends a complaint', () => {
  it('stores it, once, however often the same key arrives', async () => {
    const body = complaint();
    expect((await send(body)).status).toBe(201);
    expect((await send(body)).status).toBe(201);
    expect(await prisma().posComplaint.count({ where: { restaurantId: a.id } })).toBe(1);
  });

  it('is closed (404) only when the menu switched its box off or the subscription is gone', async () => {
    await prisma().menu.updateMany({ where: { slug }, data: { feedbackEnabled: false } });
    expect((await send(complaint())).status).toBe(404);
    await prisma().menu.updateMany({ where: { slug }, data: { feedbackEnabled: true } });
    expect((await send(complaint())).status).toBe(201);
  });

  it('links the table whatever the old till switch says', async () => {
    await prisma().posSettings.update({ where: { restaurantId: a.id }, data: { complaintsEnabled: false } });
    expect((await send(complaint())).status).toBe(201);
    expect(await prisma().posComplaint.findFirstOrThrow({ where: { restaurantId: a.id } })).toMatchObject({ tableNumber: 1 });
  });

  it('is kept without a table link when the table is unknown to the till', async () => {
    expect((await send(complaint({ table: 99 }))).status).toBe(201);
    expect(await prisma().posComplaint.findFirstOrThrow({ where: { restaurantId: a.id } })).toMatchObject({ tableId: null, tableNumber: null });
  });

  it('takes a suggestion with no table at all, on a menu with no till', async () => {
    await prisma().posSettings.deleteMany({ where: { restaurantId: a.id } });
    expect((await send(complaint({ table: undefined, category: 'SUGGESTION', body: 'Add a kids menu' }))).status).toBe(201);
    expect(await prisma().posComplaint.findFirstOrThrow({ where: { restaurantId: a.id } })).toMatchObject({ category: 'SUGGESTION', tableId: null, tableNumber: null, orderId: null });
  });

  it('limits a menu with no table to sixty an hour', async () => {
    for (let i = 0; i < 60; i += 1) await prisma().posComplaint.create({ data: { restaurantId: a.id, clientKey: `seed-${i}-xxxxxxxxxxxxxxxx`, body: 'x', locale: 'en' } });
    expect((await send(complaint({ table: undefined }))).status).toBe(429);
  });

  it('answers the honeypot as accepted without storing anything', async () => {
    expect((await send(complaint({ website: 'http://spam.example' }))).status).toBe(201);
    expect(await prisma().posComplaint.count()).toBe(0);
  });

  it('refuses text with no letter or digit, an unknown field, and a name or phone without consent', async () => {
    expect((await send(complaint({ body: ' ​ ... ' }))).status).toBe(400);
    expect((await send(complaint({ price: 1 }))).status).toBe(400);
    expect((await send(complaint({ contactName: 'Sara' }))).status).toBe(400);
    expect((await send(complaint({ contactPhone: 'not a phone', consent: true }))).status).toBe(400);
    expect(await prisma().posComplaint.count()).toBe(0);
  });

  it('keeps the contact on the complaint with the time of consent, and out of the audit row', async () => {
    expect((await send(complaint({ contactName: 'Sara', contactPhone: '+964 770 123 4567', consent: true, body: 'Rude waiter' }))).status).toBe(201);
    const row = await prisma().posComplaint.findFirstOrThrow({ where: { restaurantId: a.id } });
    expect(row).toMatchObject({ contactName: 'Sara', contactPhone: '+964 770 123 4567' });
    expect(row.contactConsentAt).not.toBeNull();
    const audit = JSON.stringify(await prisma().auditLog.findMany({ where: { action: 'pos.complaint.submit' } }));
    expect(audit).not.toContain('Sara');
    expect(audit).not.toContain('770');
    expect(audit).not.toContain('Rude waiter');
  });

  it('limits a table to three in ten minutes, answering 429', async () => {
    for (let i = 0; i < 3; i += 1) expect((await send(complaint())).status).toBe(201);
    expect((await send(complaint())).status).toBe(429);
    expect((await send(complaint({ table: 2 }))).status).toBe(201);
  });

  it('links the live order of the table, and only a live one', async () => {
    expect((await send(complaint())).status).toBe(201);
    const tableId = (await prisma().posTable.findFirstOrThrow({ where: { restaurantId: a.id, number: 2 } })).id;
    const opened = dataOf(await run(cashier, openPosOrder, { tableId }));
    expect((await send(complaint({ table: 2 }))).status).toBe(201);
    const rows = await prisma().posComplaint.findMany({ where: { restaurantId: a.id }, orderBy: { createdAt: 'asc' } });
    expect(rows[0]?.orderId).toBeNull();
    expect(rows[1]?.orderId).toBe(opened.orderId);
  });
});

describe('the box for managers', () => {
  async function one(extra: Record<string, unknown> = {}) {
    expect((await send(complaint(extra))).status).toBe(201);
    return (await prisma().posComplaint.findFirstOrThrow({ where: { restaurantId: a.id }, orderBy: { createdAt: 'desc' } })).id;
  }

  it('lists without any contact, shows the contact on the detail, and shuts out a cashier', async () => {
    const id = await one({ contactName: 'Sara', contactPhone: '0770 123 4567', consent: true });
    const list = dataOf(await ask(manager, posComplaints, {}));
    expect(list).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain('Sara');
    expect(list[0]).toMatchObject({ hasContact: true, status: 'NEW' });
    expect(dataOf(await ask(manager, posComplaint, { complaintId: id })).contact).toMatchObject({ name: 'Sara' });
    expect(codeOf(await ask(cashier, posComplaints, {}))).not.toBe('OK');
    expect(dataOf(await ask(manager, posComplaintBadge, {}))).toEqual({ show: true, count: 1 });
  });

  it('moves a status only along the allowed path, and refuses a stale screen', async () => {
    const id = await one();
    dataOf(await run(manager, setPosComplaintStatus, { complaintId: id, from: 'NEW', to: 'IN_PROGRESS' }));
    expect(failureOf(await run(manager, setPosComplaintStatus, { complaintId: id, from: 'NEW', to: 'RESOLVED' }))).toMatchObject({ code: 'CONFLICT' });
    expect(codeOf(await run(manager, setPosComplaintStatus, { complaintId: id, from: 'IN_PROGRESS', to: 'NEW' }))).not.toBe('OK');
    dataOf(await run(manager, setPosComplaintStatus, { complaintId: id, from: 'IN_PROGRESS', to: 'RESOLVED' }));
    expect(dataOf(await ask(manager, posComplaintBadge, {})).count).toBe(0);
  });

  it('adds notes that stay, and removes the contact for good', async () => {
    const id = await one({ contactName: 'Sara', consent: true });
    dataOf(await run(manager, addPosComplaintNote, { complaintId: id, body: 'Called her back' }));
    expect(dataOf(await ask(manager, posComplaint, { complaintId: id })).notes.map((note) => note.body)).toEqual(['Called her back']);
    dataOf(await run(manager, removePosComplaintContact, { complaintId: id }));
    const row = await prisma().posComplaint.findFirstOrThrow({ where: { id } });
    expect(row).toMatchObject({ contactName: null, contactPhone: null });
    expect(dataOf(await ask(manager, posComplaint, { complaintId: id })).contact).toBeNull();
  });
});
