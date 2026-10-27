import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { updatePosSettings } from '@/server/studio/actions/pos';
import { posSettings } from '@/server/studio/queries/pos';
import { posIdleMinutes } from '@/server/studio/queries/pos-idle';
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
let owner: Person;

beforeAll(() => {
  useTestDatabase();
});

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await resetWorld();
  a = await restaurant('Trust Settings');
  owner = await person('owner', { membership: [a.id, 'OWNER'] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

describe('trust settings', () => {
  it('start at 15 idle minutes with approval required', async () => {
    expect(dataOf(await ask(owner, posSettings, {}))).toMatchObject({ idleMinutes: 15, requireApproval: true });
  });

  it('are saved and read back', async () => {
    dataOf(await run(owner, updatePosSettings, { ...VALID, idleMinutes: 30, requireApproval: false }));
    expect(dataOf(await ask(owner, posSettings, {}))).toMatchObject({ idleMinutes: 30, requireApproval: false, version: 1 });
  });

  it('accept 0 idle minutes, which switches the sign-out off', async () => {
    dataOf(await run(owner, updatePosSettings, { ...VALID, idleMinutes: 0 }));
    expect(dataOf(await ask(owner, posSettings, {}))).toMatchObject({ idleMinutes: 0 });
  });

  it.each([
    ['more than 240 idle minutes', { idleMinutes: 241 }],
    ['negative idle minutes', { idleMinutes: -1 }],
    ['fractional idle minutes', { idleMinutes: 1.5 }],
  ])('refuse %s', async (_label, patch) => {
    expect(codeOf(await run(owner, updatePosSettings, { ...VALID, ...patch }))).toBe('INVALID');
  });

  it('can be read by every till role through posIdleMinutes (15 before any save)', async () => {
    const kitchen = await person('kitchen', { staff: [a.id, 'KITCHEN'] });
    expect(dataOf(await ask(kitchen, posIdleMinutes, {}))).toBe(15);
    dataOf(await run(owner, updatePosSettings, { ...VALID, idleMinutes: 5 }));
    expect(dataOf(await ask(kitchen, posIdleMinutes, {}))).toBe(5);
  });

  it('show up in the audit changes', async () => {
    dataOf(await run(owner, updatePosSettings, VALID));
    dataOf(await run(owner, updatePosSettings, { ...VALID, version: 1, requireApproval: false }));
    const rows = await prisma().auditLog.findMany({ where: { action: 'pos.settings.update' }, orderBy: { occurredAt: 'asc' } });
    expect(rows[1]?.changes).toMatchObject({ requireApproval: { before: true, after: false } });
  });
});
