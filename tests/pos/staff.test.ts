import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolvePosActor } from '@/server/pos/actor';
import { changePosStaffRole as changeRoleIn, deactivateIn } from '@/server/pos/staff';
import * as posActions from '@/server/studio/actions/pos';
import { changePosStaffRole, setPosStaffActive } from '@/server/studio/actions/pos';
import { createTillStaff } from '@/server/studio/actions/people';
import { posStaff } from '@/server/studio/queries/pos';
import { StudioError } from '@/server/studio/framework/result';
import { scopedClient } from '@/server/data/tenant-db';
import { ask, codeOf, dataOf, failureOf, GOOD, person, prisma, resetWorld, restaurant, run, useTestDatabase, type Person } from './fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

let a: { id: string };
let b: { id: string };
let owner: Person; // OWNER member of A
let manager: Person;
let cashier: Person;
let bManager: Person;
let admin: Person; // Super Admin

const NEW = (email: string, role: 'OWNER' | 'MANAGER' | 'CASHIER' | 'KITCHEN' = 'CASHIER', restaurantId = a.id) => ({ restaurantId, name: 'New Person', email, role, password: GOOD });
/** A till row made the way the fixture makes people: directly, since no till role may open an account. */
const staffRow = async (label: string, role: 'OWNER' | 'MANAGER' | 'CASHIER' | 'KITCHEN') => {
  const who = await person(label, { staff: [a.id, role] });
  return (await prisma().posStaff.findFirstOrThrow({ where: { restaurantId: a.id, userId: who.userId } })).id;
};

beforeAll(() => {
  useTestDatabase();
});

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await resetWorld();
  a = await restaurant('Till A');
  b = await restaurant('Till B');
  owner = await person('owner', { membership: [a.id, 'OWNER'] });
  manager = await person('manager', { staff: [a.id, 'MANAGER'] });
  cashier = await person('cashier', { staff: [a.id, 'CASHIER'] });
  bManager = await person('bmanager', { staff: [b.id, 'MANAGER'] });
  admin = await person('admin', { superAdmin: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

describe('creating and listing staff', () => {
  it('has no till action that opens an account: only the Super Admin makes till people', async () => {
    expect(Object.keys(posActions)).not.toContain('createPosStaff');
    expect(Object.keys(posActions).filter((name) => /create.*staff/i.test(name))).toEqual([]);
  });

  it('refuses an owner and a manager on the Super Admin path to open an account (a till-only person does not even reach the restaurant), and writes nothing', async () => {
    for (const [who, role] of [[owner, 'CASHIER'], [manager, 'KITCHEN'], [manager, 'OWNER'], [cashier, 'CASHIER']] as const) {
      expect(codeOf(await run(who, createTillStaff, NEW(`no-${role.toLowerCase()}@pos-test.example`, role))), `${who.email} ${role}`).toMatch(/^(FORBIDDEN|NOT_FOUND)$/);
      if (who === owner) expect(codeOf(await run(who, createTillStaff, NEW('no-owner2@pos-test.example', role)))).toBe('FORBIDDEN');
    }
    expect(await prisma().user.count({ where: { email: { startsWith: 'no-' } } })).toBe(0);
    expect(await prisma().posStaff.count({ where: { restaurantId: a.id } })).toBe(2);
  });

  it('lets a Super Admin make a till person, who can then sign in as that role; the list shows them and the owner who has no row', async () => {
    const { staffId } = dataOf(await run(admin, createTillStaff, NEW('till1@pos-test.example')));
    const rows = dataOf(await ask(owner, posStaff, {}));
    expect(rows.map((row) => row.email).sort()).toEqual(
      ['cashier@pos-test.example', 'manager@pos-test.example', 'owner@pos-test.example', 'till1@pos-test.example'],
    );
    expect(rows.find((row) => row.email === 'owner@pos-test.example')).toMatchObject({ role: 'OWNER', viaMembership: true, active: true });
    expect(rows.find((row) => row.id === staffId)).toMatchObject({ role: 'CASHIER', viaMembership: false, active: true });
    const created = await prisma().user.findUnique({ where: { email: 'till1@pos-test.example' } });
    expect(await resolvePosActor(prisma(), created!.id)).toMatchObject({ restaurantId: a.id, role: 'CASHIER' });
  });

  it('writes an audit row that holds no password', async () => {
    dataOf(await run(admin, createTillStaff, NEW('till2@pos-test.example')));
    const row = await prisma().auditLog.findFirst({ where: { action: 'pos.staff.create' } });
    expect(row).toMatchObject({ restaurantId: a.id, entityType: 'PosStaff' });
    expect(JSON.stringify(row?.changes)).not.toContain(GOOD);
  });

  it('refuses a weak password on the password field, and creates nothing', async () => {
    const error = failureOf(await run(admin, createTillStaff, { ...NEW('weak@pos-test.example'), password: 'short' }));
    expect(error.code).toBe('INVALID');
    expect(error.fields).toHaveProperty('password');
    expect(await prisma().user.count({ where: { email: 'weak@pos-test.example' } })).toBe(0);
  });

  it('refuses a person who already works here, and never attaches an existing account', async () => {
    expect(codeOf(await run(admin, createTillStaff, NEW('cashier@pos-test.example')))).toBe('CONFLICT');
    const user = await prisma().user.findUnique({ where: { email: 'bmanager@pos-test.example' } });
    expect(codeOf(await run(admin, createTillStaff, NEW('bmanager@pos-test.example')))).toBe('CONFLICT');
    expect(await prisma().posStaff.count({ where: { userId: user!.id, restaurantId: a.id } })).toBe(0);
  });

  it('never shows one restaurant the staff of another', async () => {
    const rows = dataOf(await ask(bManager, posStaff, {}));
    expect(rows.map((row) => row.email)).toEqual(['bmanager@pos-test.example']);
  });
});

describe('changing a role and switching a person off', () => {
  it('lets the owner change a role and a manager change a cashier', async () => {
    const staffId = await staffRow('c1', 'CASHIER');
    expect(codeOf(await run(owner, changePosStaffRole, { staffId, role: 'KITCHEN' }))).toBe('OK');
    expect(codeOf(await run(manager, changePosStaffRole, { staffId, role: 'CASHIER' }))).toBe('OK');
    expect(await prisma().auditLog.count({ where: { action: 'pos.staff.role' } })).toBe(2);
  });

  it('keeps a manager from touching an owner or manager, or promoting anyone to them', async () => {
    const staffId = await staffRow('m2', 'MANAGER');
    const cashierRow = await prisma().posStaff.findFirstOrThrow({ where: { restaurantId: a.id, role: 'CASHIER' } });
    expect(codeOf(await run(manager, changePosStaffRole, { staffId, role: 'CASHIER' }))).toBe('FORBIDDEN');
    expect(codeOf(await run(manager, setPosStaffActive, { staffId, active: false }))).toBe('FORBIDDEN');
    expect(codeOf(await run(manager, changePosStaffRole, { staffId: cashierRow.id, role: 'MANAGER' }))).toBe('FORBIDDEN');
  });

  it('lets nobody change their own role or switch themselves off', async () => {
    const own = await prisma().posStaff.findFirstOrThrow({ where: { restaurantId: a.id, userId: manager.userId } });
    expect(codeOf(await run(manager, changePosStaffRole, { staffId: own.id, role: 'CASHIER' }))).toBe('FORBIDDEN');
    expect(codeOf(await run(manager, setPosStaffActive, { staffId: own.id, active: false }))).toBe('FORBIDDEN');
  });

  it('switches a person off and on again; off, they have no till', async () => {
    const row = await prisma().posStaff.findFirstOrThrow({ where: { restaurantId: a.id, userId: cashier.userId } });
    dataOf(await run(manager, setPosStaffActive, { staffId: row.id, active: false }));
    expect(await resolvePosActor(prisma(), cashier.userId)).toBeNull();
    dataOf(await run(manager, setPosStaffActive, { staffId: row.id, active: true }));
    expect(await resolvePosActor(prisma(), cashier.userId)).toMatchObject({ role: 'CASHIER' });
    expect(await prisma().auditLog.count({ where: { action: { in: ['pos.staff.deactivate', 'pos.staff.reactivate'] } } })).toBe(2);
  });

  it('cannot reach another restaurant’s staff by id', async () => {
    const theirs = await prisma().posStaff.findFirstOrThrow({ where: { restaurantId: b.id } });
    expect(codeOf(await run(manager, changePosStaffRole, { staffId: theirs.id, role: 'CASHIER' }))).toBe('NOT_FOUND');
    expect(codeOf(await run(manager, setPosStaffActive, { staffId: theirs.id, active: false }))).toBe('NOT_FOUND');
    expect((await prisma().posStaff.findUniqueOrThrow({ where: { id: theirs.id } })).role).toBe('MANAGER');
  });

  it('keeps the last owner: the service refuses to demote or switch off the only active OWNER', async () => {
    // A restaurant whose only owner is a staff row (no OWNER membership), changed by someone else in a race.
    const c = await restaurant('Till C');
    const only = await person('onlyowner', { staff: [c.id, 'OWNER'] });
    const row = await prisma().posStaff.findFirstOrThrow({ where: { restaurantId: c.id, userId: only.userId } });
    const db = scopedClient(prisma(), { restaurantId: c.id });
    await expect(db.$transaction((tx) => changeRoleIn(tx, { restaurantId: c.id, actingUserId: 'someone-else', staffId: row.id, role: 'MANAGER' }))).rejects.toMatchObject({
      name: 'StudioError',
      code: 'CONFLICT',
    });
    await expect(db.$transaction((tx) => deactivateIn(tx, { restaurantId: c.id, actingUserId: 'someone-else', staffId: row.id }))).rejects.toBeInstanceOf(StudioError);
    expect((await prisma().posStaff.findUniqueOrThrow({ where: { id: row.id } })).role).toBe('OWNER');
  });

  it('counts an OWNER membership as an owner, so a staff-row owner may be demoted beside it', async () => {
    const extra = { staffId: await staffRow('o2', 'OWNER') };
    expect(codeOf(await run(owner, changePosStaffRole, { staffId: extra.staffId, role: 'MANAGER' }))).toBe('OK');
  });
});
