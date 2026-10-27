import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PIN_LIMITS } from '@/server/domain/pos/pin';
import { approversFor } from '@/server/pos/approval';
import { PinLockedError, PinRefusedError, verifyApproverPin } from '@/server/pos/pin';
import { setOwnPosPin } from '@/server/studio/actions/pos-pin';
import { dataOf, person, prisma, resetWorld, restaurant, run, useTestDatabase, type Person } from './fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };
const META = { ip: '203.0.113.7', userAgent: 'vitest' };

let a: { id: string };
let b: { id: string };
let manager: Person;
let owner: Person;
let cashier: Person;
let bManager: Person;

beforeAll(() => {
  useTestDatabase();
});

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await resetWorld();
  a = await restaurant('Approval A');
  b = await restaurant('Approval B');
  owner = await person('owner', { staff: [a.id, 'OWNER'] });
  manager = await person('manager', { staff: [a.id, 'MANAGER'] });
  cashier = await person('cashier', { staff: [a.id, 'CASHIER'] });
  bManager = await person('bmanager', { staff: [b.id, 'MANAGER'] });
  for (const who of [owner, manager, cashier, bManager]) dataOf(await run(who, setOwnPosPin, { pin: '2580', password: 'correct horse battery staple' }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

const staffId = async (who: Person) => (await prisma().posStaff.findFirstOrThrow({ where: { userId: who.userId } })).id;
const approve = async (restaurantId: string, who: Person, pin: string, now?: Date) =>
  verifyApproverPin(prisma(), { restaurantId, staffId: await staffId(who), pin, meta: META, now });

describe('verifyApproverPin', () => {
  it('accepts a manager and an owner with the right PIN and says who approved', async () => {
    expect(await approve(a.id, manager, '2580')).toEqual({ staffId: await staffId(manager), userId: manager.userId });
    expect(await approve(a.id, owner, '2580')).toEqual({ staffId: await staffId(owner), userId: owner.userId });
  });

  it('refuses a wrong PIN', async () => {
    await expect(approve(a.id, manager, '1357')).rejects.toBeInstanceOf(PinRefusedError);
  });

  it('refuses a cashier, even with the right PIN', async () => {
    await expect(approve(a.id, cashier, '2580')).rejects.toBeInstanceOf(PinRefusedError);
  });

  it('refuses a manager of another restaurant', async () => {
    await expect(approve(a.id, bManager, '2580')).rejects.toBeInstanceOf(PinRefusedError);
  });

  it('refuses a deactivated manager', async () => {
    await prisma().posStaff.update({ where: { id: await staffId(manager) }, data: { deactivatedAt: new Date() } });
    await expect(approve(a.id, manager, '2580')).rejects.toBeInstanceOf(PinRefusedError);
  });

  it('locks the approver after the allowed wrong tries, and the right PIN no longer works', async () => {
    for (let i = 0; i < PIN_LIMITS.staffFailures; i++) await expect(approve(a.id, manager, '1357')).rejects.toBeInstanceOf(PinRefusedError);
    await expect(approve(a.id, manager, '2580')).rejects.toBeInstanceOf(PinLockedError);
  });

  it('creates no session and writes audit rows without the PIN', async () => {
    const sessions = await prisma().session.count();
    await approve(a.id, manager, '2580');
    await expect(approve(a.id, manager, '1357')).rejects.toBeInstanceOf(PinRefusedError);
    expect(await prisma().session.count()).toBe(sessions);
    expect(await prisma().auditLog.count({ where: { action: 'pos.approval.ok', restaurantId: a.id } })).toBe(1);
    expect(await prisma().auditLog.count({ where: { action: 'pos.approval.fail', restaurantId: a.id } })).toBe(1);
    const dump = JSON.stringify(await prisma().auditLog.findMany());
    expect(dump).not.toContain('2580');
    expect(dump).not.toContain('1357');
  });
});

describe('who is asking', () => {
  it('names the cashier on a wrong-PIN audit row', async () => {
    await expect(verifyApproverPin(prisma(), { restaurantId: a.id, staffId: await staffId(manager), pin: '1357', meta: META, requestedByUserId: cashier.userId })).rejects.toBeInstanceOf(PinRefusedError);
    const row = await prisma().auditLog.findFirstOrThrow({ where: { action: 'pos.approval.fail', restaurantId: a.id } });
    expect(row.actorId).toBe(cashier.userId);
  });

  it('stops one cashier after 10 wrong tries in 15 minutes, even with the right PIN', async () => {
    for (let i = 0; i < 10; i += 1) {
      await prisma().auditLog.create({ data: { actorId: cashier.userId, restaurantId: a.id, action: 'pos.approval.fail', entityType: 'PosStaff', entityId: 'x', changes: {} } });
    }
    await expect(verifyApproverPin(prisma(), { restaurantId: a.id, staffId: await staffId(manager), pin: '2580', meta: META, requestedByUserId: cashier.userId })).rejects.toBeInstanceOf(PinLockedError);
  });
});

describe('approversFor', () => {
  it('lists active managers and owners with a PIN for a cashier, and nobody for a manager', async () => {
    const forCashier = await approversFor(prisma(), a.id, 'CASHIER');
    expect(forCashier?.map((p) => p.staffId).sort()).toEqual([await staffId(manager), await staffId(owner)].sort());
    expect(await approversFor(prisma(), a.id, 'MANAGER')).toBeNull();
  });

  it('leaves out staff without a PIN, deactivated staff, cashiers and other restaurants', async () => {
    const noPin = await person('nopin', { staff: [a.id, 'MANAGER'] });
    await prisma().posStaff.update({ where: { id: await staffId(owner) }, data: { deactivatedAt: new Date() } });
    const ids = (await approversFor(prisma(), a.id, 'CASHIER'))?.map((p) => p.staffId) ?? [];
    expect(ids).toEqual([await staffId(manager)]);
    expect(ids).not.toContain(await staffId(noPin));
    expect(ids).not.toContain(await staffId(cashier));
    expect(ids).not.toContain(await staffId(bManager));
  });

  it('is null for a cashier when the restaurant switched approval off', async () => {
    await prisma().posSettings.upsert({ where: { restaurantId: a.id }, create: { restaurantId: a.id, requireApproval: false }, update: { requireApproval: false } });
    expect(await approversFor(prisma(), a.id, 'CASHIER')).toBeNull();
  });
});
