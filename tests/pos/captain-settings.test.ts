import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readPosSettings } from '@/server/pos/settings';
import { setPosCaptainApproval } from '@/server/studio/actions/pos-captain';
import { updatePosSettings } from '@/server/studio/actions/pos';
import { posOverview } from '@/server/studio/queries/pos';
import { ask, codeOf, dataOf, person, prisma, resetWorld, restaurant, run, useTestDatabase, type Person } from './fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

const VALID = {
  serviceRatePercent: 0,
  taxRatePercent: 0,
  enabledPaymentMethods: ['CASH'],
  tableRingMinutes: 60,
  kitchenPrintEnabled: false,
  kitchenScreenEnabled: false,
  qrOrderingEnabled: false,
  takeawayEnabled: false,
  deliveryEnabled: false,
  complaintsEnabled: false,
  idleMinutes: 15,
  requireApproval: true,
  version: 0,
};

let a: { id: string };
let b: { id: string };
let admin: Person;
let owner: Person;
let manager: Person;
let cashier: Person;

beforeAll(() => useTestDatabase());

beforeEach(async () => {
  await resetWorld();
  a = await restaurant('Captain A');
  b = await restaurant('Captain B');
  admin = await person('admin', { superAdmin: true });
  owner = await person('owner', { membership: [a.id, 'OWNER'] });
  manager = await person('manager', { staff: [a.id, 'MANAGER'] });
  cashier = await person('cashier', { staff: [a.id, 'CASHIER'] });
});

afterEach(() => vi.restoreAllMocks());

afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

describe('the captain approval switch', () => {
  it('is off for a new restaurant', async () => {
    expect((await readPosSettings(prisma(), a.id)).captainApproval).toBe(false);
  });

  it('is set by a manager through the settings and reads back', async () => {
    dataOf(await run(manager, updatePosSettings, { ...VALID, captainApproval: true }));
    expect((await readPosSettings(prisma(), a.id)).captainApproval).toBe(true);
  });

  it('is set by an owner through the settings, and an omitted value means off', async () => {
    dataOf(await run(owner, updatePosSettings, { ...VALID, captainApproval: true }));
    expect((await readPosSettings(prisma(), a.id)).captainApproval).toBe(true);
    dataOf(await run(owner, updatePosSettings, { ...VALID, version: 1 }));
    expect((await readPosSettings(prisma(), a.id)).captainApproval).toBe(false);
  });

  it('is refused to a cashier', async () => {
    expect(codeOf(await run(cashier, updatePosSettings, { ...VALID, captainApproval: true }))).toBe('FORBIDDEN');
    expect((await readPosSettings(prisma(), a.id)).captainApproval).toBe(false);
  });

  it('is set by a Super Admin only, per restaurant, and audited', async () => {
    expect(codeOf(await run(owner, setPosCaptainApproval, { restaurantId: a.id, enabled: true }))).toBe('FORBIDDEN');
    expect(codeOf(await run(admin, setPosCaptainApproval, { restaurantId: a.id, enabled: true }))).toBe('OK');
    expect((await readPosSettings(prisma(), a.id)).captainApproval).toBe(true);
    expect((await readPosSettings(prisma(), b.id)).captainApproval).toBe(false);
    const audit = await prisma().auditLog.findFirst({ where: { action: 'pos.captain.approval' } });
    expect(audit).toMatchObject({ restaurantId: a.id, entityId: a.id });
    expect(audit?.changes).toMatchObject({ captainApproval: { before: false, after: true } });
    expect(codeOf(await run(admin, setPosCaptainApproval, { restaurantId: a.id, enabled: false }))).toBe('OK');
    expect((await readPosSettings(prisma(), a.id)).captainApproval).toBe(false);
    expect(codeOf(await run(admin, setPosCaptainApproval, { restaurantId: 'nope', enabled: true }))).toBe('NOT_FOUND');
  });

  it('keeps the other settings and moves the version when the Super Admin flips it', async () => {
    dataOf(await run(owner, updatePosSettings, { ...VALID, serviceRatePercent: 10 }));
    dataOf(await run(admin, setPosCaptainApproval, { restaurantId: a.id, enabled: true }));
    expect(await readPosSettings(prisma(), a.id)).toMatchObject({ serviceRatePercent: 10, captainApproval: true, version: 2 });
  });

  it('shows in the platform overview', async () => {
    dataOf(await run(admin, setPosCaptainApproval, { restaurantId: a.id, enabled: true }));
    const rows = dataOf(await ask(admin, posOverview, {})).rows;
    expect(rows.find((row) => row.id === a.id)?.captainApproval).toBe(true);
    expect(rows.find((row) => row.id === b.id)?.captainApproval).toBe(false);
  });

  it('gives guest orders the approval columns, all clear by default', async () => {
    const area = await prisma().posArea.create({ data: { restaurantId: a.id, name: 'Hall' } });
    const table = await prisma().posTable.create({ data: { restaurantId: a.id, areaId: area.id, number: 1 } });
    const request = await prisma().posCustomerOrder.create({ data: { restaurantId: a.id, tableId: table.id, tableNumber: 1, locale: 'ar' } });
    expect(request).toMatchObject({ requiresCaptain: false, captainApprovedAt: null, captainApprovedByUserId: null, createdByUserId: null });
  });
});
