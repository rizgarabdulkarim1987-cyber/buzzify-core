import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { updatePosSettings } from '@/server/studio/actions/pos';
import { posSettings } from '@/server/studio/queries/pos';
import { ask, codeOf, dataOf, failureOf, person, prisma, resetWorld, restaurant, run, useTestDatabase, type Person } from './fixture';

// Server Actions read the request through `headers()` and `cookies()`, which only exist inside Next.
vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

const VALID = {
  serviceRatePercent: 10,
  taxRatePercent: 5,
  enabledPaymentMethods: ['CASH', 'ZAINCASH'],
  tableRingMinutes: 45,
  kitchenPrintEnabled: true,
  kitchenScreenEnabled: false,
  qrOrderingEnabled: false,
  takeawayEnabled: true,
  deliveryEnabled: false,
  complaintsEnabled: false,
  idleMinutes: 15,
  requireApproval: true,
  version: 0,
};

let a: { id: string };
let b: { id: string };
let owner: Person; // OWNER member of A
let manager: Person;
let cashier: Person;
let designer: Person;
let menuOnly: Person; // OWNER member of a restaurant without the cashier
let bOwner: Person;

beforeAll(() => {
  useTestDatabase();
});

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await resetWorld();
  a = await restaurant('Till A');
  b = await restaurant('Till B');
  const plain = await restaurant('Menu Only', 'none');
  owner = await person('owner', { membership: [a.id, 'OWNER'] });
  manager = await person('manager', { staff: [a.id, 'MANAGER'] });
  cashier = await person('cashier', { staff: [a.id, 'CASHIER'] });
  designer = await person('designer', { membership: [a.id, 'DESIGNER'] });
  menuOnly = await person('menuonly', { membership: [plain.id, 'OWNER'] });
  bOwner = await person('bowner', { membership: [b.id, 'OWNER'] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

describe('posSettings', () => {
  it('shows the plain defaults, at version 0, before anything was saved', async () => {
    expect(dataOf(await ask(owner, posSettings, {}))).toEqual({
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
      roundingStep: 0,
      usdEnabled: false,
      usdRate: 0,
      invoiceName: '',
      invoiceAddress: '',
      invoicePhone: '',
      invoiceTaxNumber: '',
      invoiceFooter: '',
      requireApproval: true,
      captainApproval: false,
      loyaltyEnabled: false,
      loyaltyStampsRequired: 8,
      loyaltyReward: '',
      catalogMenuId: null,
      version: 0,
    });
  });

  it('is for those who may manage settings only', async () => {
    expect(codeOf(await ask(manager, posSettings, {}))).toBe('OK');
    expect(codeOf(await ask(cashier, posSettings, {}))).toBe('FORBIDDEN');
  });
});

describe('updatePosSettings', () => {
  it('saves the first time at version 0, then moves to version 1', async () => {
    dataOf(await run(owner, updatePosSettings, VALID));
    const view = dataOf(await ask(owner, posSettings, {}));
    expect(view).toMatchObject({ serviceRatePercent: 10, taxRatePercent: 5, enabledPaymentMethods: ['CASH', 'ZAINCASH'], tableRingMinutes: 45, version: 1 });
    expect(view.kitchenPrintEnabled).toBe(true);
  });

  it('writes one audit row, filed under the restaurant, in the same transaction', async () => {
    dataOf(await run(owner, updatePosSettings, VALID));
    const rows = await prisma().auditLog.findMany({ where: { action: 'pos.settings.update' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ restaurantId: a.id, entityType: 'PosSettings', actorId: owner.userId });
  });

  it.each([
    ['a service rate over 100', { serviceRatePercent: 101 }],
    ['a negative service rate', { serviceRatePercent: -1 }],
    ['a fractional tax rate', { taxRatePercent: 2.5 }],
    ['a ring of zero minutes', { tableRingMinutes: 0 }],
    ['an unknown payment method', { enabledPaymentMethods: ['CASH', 'BITCOIN'] }],
  ])('refuses %s', async (_label, patch) => {
    expect(codeOf(await run(owner, updatePosSettings, { ...VALID, ...patch }))).toBe('INVALID');
    expect(await prisma().posSettings.count({ where: { restaurantId: a.id } })).toBe(0);
  });

  it('refuses to switch cash off', async () => {
    const error = failureOf(await run(owner, updatePosSettings, { ...VALID, enabledPaymentMethods: ['ZAINCASH'] }));
    expect(error.code).toBe('INVALID');
    expect(error.fields).toHaveProperty('enabledPaymentMethods');
  });

  it('refuses a stale version with a conflict', async () => {
    dataOf(await run(owner, updatePosSettings, VALID));
    expect(codeOf(await run(manager, updatePosSettings, { ...VALID, version: 0 }))).toBe('CONFLICT');
    expect(codeOf(await run(manager, updatePosSettings, { ...VALID, version: 1, serviceRatePercent: 12 }))).toBe('OK');
  });

  it('refuses a cashier (403), a menu-only owner (403) and a studio designer (404)', async () => {
    expect(codeOf(await run(cashier, updatePosSettings, VALID))).toBe('FORBIDDEN');
    expect(codeOf(await run(menuOnly, updatePosSettings, VALID))).toBe('FORBIDDEN');
    expect(codeOf(await run(designer, updatePosSettings, VALID))).toBe('NOT_FOUND');
  });

  it('changes only the actor’s own restaurant, whatever the input names', async () => {
    dataOf(await run(owner, updatePosSettings, { ...VALID, restaurantId: b.id }));
    expect(await prisma().posSettings.count({ where: { restaurantId: b.id } })).toBe(0);
    expect(await prisma().posSettings.count({ where: { restaurantId: a.id } })).toBe(1);
    dataOf(await run(bOwner, updatePosSettings, { ...VALID, taxRatePercent: 1 }));
    expect((await prisma().posSettings.findUnique({ where: { restaurantId: a.id } }))?.taxRatePercent).toBe(5);
  });
});

describe('currency and invoice settings', () => {
  it('saves the rounding step, the dollar rate and the business details', async () => {
    dataOf(
      await run(owner, updatePosSettings, {
        ...VALID,
        roundingStep: 250,
        usdEnabled: true,
        usdRate: 1500,
        invoiceName: 'Buzz Grill',
        invoiceTaxNumber: 'TX-77',
      }),
    );
    expect(dataOf(await ask(owner, posSettings, {}))).toMatchObject({
      roundingStep: 250,
      usdEnabled: true,
      usdRate: 1500,
      invoiceName: 'Buzz Grill',
      invoiceTaxNumber: 'TX-77',
      invoiceFooter: '',
    });
  });

  it.each([
    ['a step that is not offered', { roundingStep: 100 }],
    ['a negative step', { roundingStep: -250 }],
    ['a fractional step', { roundingStep: 250.5 }],
    ['dollars on with no rate', { usdEnabled: true, usdRate: 0 }],
    ['a fractional rate', { usdRate: 1500.5 }],
    ['a negative rate', { usdRate: -1 }],
  ])('refuses %s', async (_label, patch) => {
    expect(codeOf(await run(owner, updatePosSettings, { ...VALID, ...patch }))).toBe('INVALID');
  });
});
