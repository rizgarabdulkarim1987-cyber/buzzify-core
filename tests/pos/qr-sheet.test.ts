import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPosArea, createPosTables } from '@/server/studio/actions/pos';
import { ensurePosMenuTables } from '@/server/studio/actions/pos-requests';
import { posQrSheet } from '@/server/studio/queries/pos-requests';
import { readQrFlags } from '@/server/pos/qr-sheet';
import { ask, codeOf, dataOf, person, prisma, resetWorld, restaurant, run, useTestDatabase, type Person } from './fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

let a: { id: string };
let menuId: string;
let manager: Person;
let cashier: Person;
let bManager: Person;

beforeAll(() => {
  useTestDatabase();
});

beforeEach(async () => {
  await resetWorld();
  a = await restaurant('Sheet A');
  const b = await restaurant('Sheet B');
  manager = await person('manager', { staff: [a.id, 'MANAGER'] });
  cashier = await person('cashier', { staff: [a.id, 'CASHIER'] });
  bManager = await person('bmanager', { staff: [b.id, 'MANAGER'] });
  menuId = (
    await prisma().menu.create({ data: { restaurantId: a.id, name: 'm', slug: 'sheet-a', currency: 'IQD', locales: ['ar', 'en'], defaultLocale: 'ar', timezone: 'Asia/Baghdad' } })
  ).id;
  await prisma().posSettings.create({ data: { restaurantId: a.id, catalogMenuId: menuId, qrOrderingEnabled: true } });
  const areaId = dataOf(await run(manager, createPosArea, { name: 'Hall' })).areaId;
  await run(manager, createPosTables, { areaId, from: 1, to: 3 });
});

afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

describe('the table QR sheet', () => {
  it('has one code per table pointing at the Menu table page, and says which tables have no Menu page', async () => {
    await prisma().table.create({ data: { menuId, number: 2, label: 'Two' } });
    const sheet = dataOf(await ask(manager, posQrSheet, {}));
    expect(sheet.enabled).toBe(true);
    expect(sheet.menu).toMatchObject({ slug: 'sheet-a', published: false });
    expect(sheet.tables.map((t) => [t.number, t.hasMenuPage])).toEqual([[1, false], [2, true], [3, false]]);
    expect(sheet.tables[0]!.url).toMatch(/\/sheet-a\/t\/1$/);
    expect(sheet.tables[0]!.svg.startsWith('<svg')).toBe(true);
    expect(sheet.tables[0]!.svg).not.toMatch(/href=|src=/);
  });

  it('makes the missing Menu table pages once, with an audit row, and not again', async () => {
    await prisma().table.create({ data: { menuId, number: 2, label: 'Two' } });
    expect(dataOf(await run(manager, ensurePosMenuTables, {})).created).toBe(2);
    expect(await prisma().table.count({ where: { menuId } })).toBe(3);
    expect(dataOf(await run(manager, ensurePosMenuTables, {})).created).toBe(0);
    expect(await prisma().auditLog.count({ where: { action: 'pos.qr.tables', restaurantId: a.id } })).toBe(1);
  });

  it('is for managers: the cashier is refused and another restaurant sees nothing of it', async () => {
    expect(codeOf(await run(cashier, ensurePosMenuTables, {}))).toBe('FORBIDDEN');
    expect((await ask(cashier, posQrSheet, {})).ok).toBe(false);
    expect(codeOf(await run(bManager, ensurePosMenuTables, {}))).toBe('NOT_FOUND');
    expect(await prisma().table.count({ where: { menuId } })).toBe(0);
  });
});

describe('the flags of the till frame', () => {
  it('is off with no settings or the switch off, and counts waiting requests when on', async () => {
    const other = await restaurant('Sheet C');
    expect(await readQrFlags(prisma(), other.id)).toEqual({ qrOrdering: false, delivery: false, pendingRequests: 0, billCalls: 0, captainApproval: false });
    expect(await readQrFlags(prisma(), a.id)).toEqual({ qrOrdering: true, delivery: false, pendingRequests: 0, billCalls: 0, captainApproval: false });
    const table = await prisma().posTable.findFirstOrThrow({ where: { restaurantId: a.id, number: 1 } });
    await prisma().posCustomerOrder.create({ data: { restaurantId: a.id, tableId: table.id, tableNumber: 1, locale: 'en' } });
    await prisma().posCustomerOrder.create({ data: { restaurantId: a.id, tableId: table.id, tableNumber: 1, locale: 'en', createdAt: new Date(Date.now() - 90 * 60_000) } });
    expect(await readQrFlags(prisma(), a.id)).toEqual({ qrOrdering: true, delivery: false, pendingRequests: 1, billCalls: 0, captainApproval: false });
    await prisma().posSettings.updateMany({ where: { restaurantId: a.id }, data: { qrOrderingEnabled: false } });
    expect(await readQrFlags(prisma(), a.id)).toEqual({ qrOrdering: false, delivery: false, pendingRequests: 0, billCalls: 0, captainApproval: false });
    // The captain switch is carried even with QR ordering off: it decides whether owners and managers see the captain page.
    await prisma().posSettings.updateMany({ where: { restaurantId: a.id }, data: { captainApproval: true } });
    expect(await readQrFlags(prisma(), a.id)).toMatchObject({ qrOrdering: false, captainApproval: true });
  });
});
