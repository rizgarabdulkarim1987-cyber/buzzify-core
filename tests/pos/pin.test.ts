import { createHash } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { isWeakPin, PIN_LIMITS } from '@/server/domain/pos/pin';
import { listPinStaff, resolveDevice, verifyPin, PinLockedError, PinRefusedError, DeviceLimitError } from '@/server/pos/pin';
import { clearPosStaffPin, registerPosDevice, revokePosDevice, setOwnPosPin } from '@/server/studio/actions/pos-pin';
import { posDevices } from '@/server/studio/queries/pos-pin';
import { ask, codeOf, dataOf, failureOf, GOOD, person, prisma, resetWorld, restaurant, run, useTestDatabase, type Person } from './fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };
const META = { ip: '203.0.113.7', userAgent: 'vitest' };

let a: { id: string };
let b: { id: string };
let owner: Person;
let manager: Person;
let cashier: Person;
let cashier2: Person;
let kitchen: Person;
let bManager: Person;
let device: { id: string; restaurantId: string };
let token: string;

beforeAll(() => {
  useTestDatabase();
});

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await resetWorld();
  a = await restaurant('Pin A');
  b = await restaurant('Pin B');
  owner = await person('owner', { staff: [a.id, 'OWNER'] });
  manager = await person('manager', { staff: [a.id, 'MANAGER'] });
  cashier = await person('cashier', { staff: [a.id, 'CASHIER'] });
  cashier2 = await person('cashier2', { staff: [a.id, 'CASHIER'] });
  kitchen = await person('kitchen', { staff: [a.id, 'KITCHEN'] });
  bManager = await person('bmanager', { staff: [b.id, 'MANAGER'] });
  const registered = dataOf(await run(manager, registerPosDevice, { name: 'Front till' }));
  token = registered.token;
  device = { id: registered.deviceId, restaurantId: a.id };
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
const setPin = (who: Person, pin: string, password = GOOD) => run(who, setOwnPosPin, { pin, password });
const attempt = async (who: Person, pin: string, now?: Date, dev = device) => verifyPin(prisma(), { device: dev, staffId: await staffId(who), pin, meta: META, now });
const dump = async () => JSON.stringify([await prisma().auditLog.findMany(), await prisma().posPinAttempt.findMany()]);

describe('weak PINs', () => {
  it('refuses repeats, runs and repeated pairs', () => {
    for (const weak of ['0000', '1111', '1234', '4321', '98765', '12345678', '1212', '121212', '5858']) expect(isWeakPin(weak), weak).toBe(true);
    for (const fine of ['2580', '739164', '1357', '4829', '1122']) expect(isWeakPin(fine), fine).toBe(false);
  });
});

describe('setting a PIN', () => {
  it('stores a hash, never the PIN, after the right password, and audits it without the PIN', async () => {
    dataOf(await setPin(cashier, '2580'));
    const row = await prisma().posStaff.findUniqueOrThrow({ where: { id: await staffId(cashier) } });
    expect(row.pinHash).toBeTruthy();
    expect(row.pinHash).not.toContain('2580');
    expect(row.pinSetAt).not.toBeNull();
    expect(await dump()).not.toContain('2580');
    expect(await prisma().auditLog.count({ where: { action: 'pos.staff.pin.set' } })).toBe(1);
  });

  it('refuses a wrong password, a bad shape and a weak PIN', async () => {
    expect(failureOf(await setPin(cashier, '2580', 'not the password at all'))).toMatchObject({ code: 'INVALID', fields: { password: expect.any(String) } });
    expect(failureOf(await setPin(cashier, '123'))).toMatchObject({ code: 'INVALID', fields: { pin: expect.any(String) } });
    expect(failureOf(await setPin(cashier, '123456789'))).toMatchObject({ code: 'INVALID' });
    expect(failureOf(await setPin(cashier, '1111'))).toMatchObject({ code: 'INVALID', fields: { pin: expect.any(String) } });
    expect((await prisma().posStaff.findUniqueOrThrow({ where: { id: await staffId(cashier) } })).pinHash).toBeNull();
  });

  it('is open to every role, and refused for an account that could reach the Studio', async () => {
    dataOf(await setPin(kitchen, '2580'));
    dataOf(await setPin(manager, '2580'));
    const member = await person('member', { staff: [a.id, 'CASHIER'], membership: [a.id, 'DESIGNER'] });
    expect(codeOf(await setPin(member, '2580'))).toBe('CONFLICT');
    const twoFactor = await person('twofa', { staff: [a.id, 'CASHIER'] });
    await prisma().user.update({ where: { id: twoFactor.userId }, data: { twoFactorEnabled: true } });
    expect(codeOf(await setPin(twoFactor, '2580'))).toBe('CONFLICT');
  });
});

describe('clearing a PIN', () => {
  it('lets a manager clear a cashier’s, not an owner’s, and never one’s own', async () => {
    dataOf(await setPin(cashier, '2580'));
    dataOf(await setPin(owner, '2580'));
    dataOf(await setPin(manager, '2580'));
    expect(codeOf(await run(manager, clearPosStaffPin, { staffId: await staffId(owner) }))).toBe('FORBIDDEN');
    expect(codeOf(await run(manager, clearPosStaffPin, { staffId: await staffId(manager) }))).toBe('FORBIDDEN');
    dataOf(await run(manager, clearPosStaffPin, { staffId: await staffId(cashier) }));
    expect(await prisma().posStaff.findUniqueOrThrow({ where: { id: await staffId(cashier) } })).toMatchObject({ pinHash: null, pinSetAt: null, pinFailedCount: 0 });
    dataOf(await run(owner, clearPosStaffPin, { staffId: await staffId(manager) }));
  });

  it('is for staff.manage and never reaches another restaurant', async () => {
    dataOf(await setPin(cashier, '2580'));
    expect(codeOf(await run(cashier2, clearPosStaffPin, { staffId: await staffId(cashier) }))).toBe('FORBIDDEN');
    expect(codeOf(await run(bManager, clearPosStaffPin, { staffId: await staffId(cashier) }))).toBe('NOT_FOUND');
    expect((await prisma().posStaff.findUniqueOrThrow({ where: { id: await staffId(cashier) } })).pinHash).not.toBeNull();
  });
});

describe('shared devices', () => {
  it('stores only the hash of the token and resolves it; a revoked or unknown token resolves to nothing', async () => {
    const row = await prisma().posSharedDevice.findUniqueOrThrow({ where: { id: device.id } });
    expect(row.tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(JSON.stringify(row)).not.toContain(token);
    expect(await resolveDevice(prisma(), token)).toMatchObject({ id: device.id, restaurantId: a.id, name: 'Front till' });
    expect(await resolveDevice(prisma(), undefined)).toBeNull();
    expect(await resolveDevice(prisma(), 'x'.repeat(43))).toBeNull();
    dataOf(await run(manager, revokePosDevice, { deviceId: device.id }));
    expect(await resolveDevice(prisma(), token)).toBeNull();
  });

  it('is for settings.manage, lists live devices of the own restaurant only, and caps the count', async () => {
    expect(codeOf(await run(cashier, registerPosDevice, { name: 'Sneaky' }))).toBe('FORBIDDEN');
    const bDevice = dataOf(await run(bManager, registerPosDevice, { name: 'B till' }));
    const list = dataOf(await ask(manager, posDevices, {}));
    expect(list.map((d) => d.name)).toEqual(['Front till']);
    expect(JSON.stringify(list)).not.toContain(token);
    expect(codeOf(await run(manager, revokePosDevice, { deviceId: bDevice.deviceId }))).toBe('NOT_FOUND');
    for (let i = 0; i < 19; i += 1) dataOf(await run(manager, registerPosDevice, { name: `d${i}` }));
    expect(codeOf(await run(manager, registerPosDevice, { name: 'one too many' }))).toBe('CONFLICT');
  });

  it('lists for the picker only active, eligible staff with a PIN, with no email or hash', async () => {
    dataOf(await setPin(cashier, '2580'));
    dataOf(await setPin(kitchen, '2580'));
    await prisma().posStaff.update({ where: { id: await staffId(kitchen) }, data: { deactivatedAt: new Date() } });
    const list = await listPinStaff(prisma(), device);
    expect(list.map((s) => s.name)).toEqual(['cashier person']);
    expect(Object.keys(list[0]!).sort()).toEqual(['name', 'role', 'staffId']);
  });
});

describe('verifying a PIN', () => {
  beforeEach(async () => {
    dataOf(await setPin(cashier, '2580'));
  });

  it('answers the user, resets the counter, stamps the device and writes one ok attempt and one audit row', async () => {
    await expect(attempt(cashier, '9999')).rejects.toBeInstanceOf(PinRefusedError);
    const ok = await attempt(cashier, '2580');
    expect(ok).toEqual({ userId: cashier.userId, staffId: await staffId(cashier) });
    expect(await prisma().posStaff.findUniqueOrThrow({ where: { id: ok.staffId } })).toMatchObject({ pinFailedCount: 0, pinLockedUntil: null });
    expect((await prisma().posSharedDevice.findUniqueOrThrow({ where: { id: device.id } })).lastUsedAt).not.toBeNull();
    expect(await prisma().posPinAttempt.count({ where: { ok: true } })).toBe(1);
    expect(await prisma().auditLog.count({ where: { action: 'pos.pin.ok' } })).toBe(1);
  });

  it('locks a staff member after five wrong PINs for fifteen minutes, then lets the right one in', async () => {
    const t0 = new Date();
    for (let i = 0; i < PIN_LIMITS.staffFailures; i += 1) await expect(attempt(cashier, '1357', t0)).rejects.toBeInstanceOf(PinRefusedError);
    await expect(attempt(cashier, '2580', t0)).rejects.toBeInstanceOf(PinLockedError);
    await expect(attempt(cashier, '2580', new Date(t0.getTime() + 14 * 60_000))).rejects.toBeInstanceOf(PinLockedError);
    const later = new Date(t0.getTime() + PIN_LIMITS.staffLockMs + 1_000);
    await expect(attempt(cashier, '2580', later)).resolves.toMatchObject({ userId: cashier.userId });
  });

  it('starts counting again after a lock has expired', async () => {
    const t0 = new Date();
    for (let i = 0; i < PIN_LIMITS.staffFailures; i += 1) await expect(attempt(cashier, '1357', t0)).rejects.toBeInstanceOf(PinRefusedError);
    const later = new Date(t0.getTime() + PIN_LIMITS.staffLockMs + 1_000);
    await expect(attempt(cashier, '1357', later)).rejects.toBeInstanceOf(PinRefusedError);
    await expect(attempt(cashier, '2580', later)).resolves.toBeTruthy();
  });

  it('refuses the whole device after twenty failures across people, writing nothing more', async () => {
    dataOf(await setPin(cashier2, '4829'));
    const now = new Date();
    for (let i = 0; i < PIN_LIMITS.deviceFailures; i += 1) {
      await expect(attempt(i % 2 === 0 ? cashier : cashier2, i % 2 === 0 ? '1357' : '1358', now)).rejects.toThrow();
    }
    const before = await prisma().posPinAttempt.count();
    await expect(attempt(cashier2, '4829', now)).rejects.toBeInstanceOf(DeviceLimitError);
    expect(await prisma().posPinAttempt.count()).toBe(before);
  });

  it('answers the same refusal for unknown, no-PIN, other-restaurant, deactivated and ineligible staff', async () => {
    const refused = (staff: string) => verifyPin(prisma(), { device, staffId: staff, pin: '2580', meta: META });
    await expect(refused('nope')).rejects.toBeInstanceOf(PinRefusedError);
    await expect(refused(await staffId(cashier2))).rejects.toBeInstanceOf(PinRefusedError);
    await expect(refused(await staffId(bManager))).rejects.toBeInstanceOf(PinRefusedError);
    await prisma().posStaff.update({ where: { id: await staffId(cashier) }, data: { deactivatedAt: new Date() } });
    await expect(refused(await staffId(cashier))).rejects.toBeInstanceOf(PinRefusedError);
    await prisma().posStaff.update({ where: { id: await staffId(cashier) }, data: { deactivatedAt: null } });
    await prisma().membership.create({ data: { userId: cashier.userId, restaurantId: a.id, role: 'DESIGNER' } });
    await expect(refused(await staffId(cashier))).rejects.toBeInstanceOf(PinRefusedError);
  });

  it('keeps five concurrent wrong attempts at a count of five and a lock', async () => {
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => attempt(cashier, '1357')));
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    const row = await prisma().posStaff.findUniqueOrThrow({ where: { id: await staffId(cashier) } });
    expect(row.pinFailedCount).toBe(5);
    expect(row.pinLockedUntil).not.toBeNull();
  });

  it('charges a try before hashing: a burst of thirty parallel guesses reaches the lock, and the right PIN is then refused', async () => {
    const results = await Promise.allSettled(Array.from({ length: 30 }, () => attempt(cashier, '1357')));
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    const row = await prisma().posStaff.findUniqueOrThrow({ where: { id: await staffId(cashier) } });
    expect(row.pinFailedCount).toBeLessThanOrEqual(PIN_LIMITS.staffFailures);
    expect(row.pinLockedUntil).not.toBeNull();
    // At most the five reserved tries ever reached the hash check.
    expect(await prisma().auditLog.count({ where: { action: 'pos.pin.fail' } })).toBeLessThanOrEqual(PIN_LIMITS.staffFailures);
    await expect(attempt(cashier, '2580')).rejects.toBeInstanceOf(PinLockedError);
  });

  it('never writes a PIN into an audit row or an attempt', async () => {
    await expect(attempt(cashier, '8642')).rejects.toBeInstanceOf(PinRefusedError);
    await attempt(cashier, '2580');
    const text = await dump();
    expect(text).not.toContain('8642');
    expect(text).not.toContain('2580');
  });
});
