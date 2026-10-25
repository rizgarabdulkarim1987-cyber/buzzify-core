import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { baghdadMonthOf } from '@/lib/baghdad';
import { aiVisibility } from '@/server/domain/pos/ai';
import { POS_ROLES } from '@/server/domain/pos/permissions';
import { AiNotEnabledError } from '@/server/ai/errors';
import { getAiPackage, requireAi, writeAiPackage } from '@/server/ai/package';
import { setPosAiPackage } from '@/server/studio/actions/pos-ai';
import { codeOf, person, prisma, resetWorld, restaurant, run, useTestDatabase, type Person } from '../fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

let a: { id: string };
let b: { id: string };
let admin: Person;
let owner: Person;

beforeAll(() => useTestDatabase());

beforeEach(async () => {
  await resetWorld();
  a = await restaurant('AI A');
  b = await restaurant('AI B');
  admin = await person('admin', { superAdmin: true });
  owner = await person('owner', { membership: [a.id, 'OWNER'] });
});

afterEach(() => vi.restoreAllMocks());

afterAll(async () => {
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

describe('the AI package switch', () => {
  it('is off for a restaurant that has no row', async () => {
    expect(await getAiPackage(prisma(), a.id)).toEqual({ enabled: false, monthlyLimit: 0, syncedAt: null });
  });

  it('writes both values and stamps syncedAt; off keeps the stored limit', async () => {
    const now = new Date('2026-10-25T10:00:00Z');
    const on = await writeAiPackage(prisma(), a.id, { enabled: true, monthlyLimit: 500, now });
    expect(on.before).toEqual({ enabled: false, monthlyLimit: 0, syncedAt: null });
    expect(on.after).toEqual({ enabled: true, monthlyLimit: 500, syncedAt: now });
    const off = await writeAiPackage(prisma(), a.id, { enabled: false });
    expect(off.after.monthlyLimit).toBe(500);
    expect(await getAiPackage(prisma(), a.id)).toMatchObject({ enabled: false, monthlyLimit: 500 });
  });

  it('requireAi refuses with AiNotEnabledError while off and passes while on', async () => {
    await expect(requireAi(prisma(), a.id)).rejects.toBeInstanceOf(AiNotEnabledError);
    await writeAiPackage(prisma(), a.id, { enabled: true, monthlyLimit: 5 });
    await expect(requireAi(prisma(), a.id)).resolves.toMatchObject({ enabled: true, monthlyLimit: 5 });
  });

  it('requireAi reads nothing but the package row', async () => {
    const seen: string[] = [];
    const spy = new Proxy(prisma(), {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof prop === 'string' && value && typeof value === 'object' && 'findUnique' in value) seen.push(prop);
        return value;
      },
    });
    await expect(requireAi(spy, a.id)).rejects.toBeInstanceOf(AiNotEnabledError);
    expect(seen).toEqual(['posAiPackage']);
  });

  it('is set by a Super Admin only, audits the change under the restaurant, and is per restaurant', async () => {
    expect(codeOf(await run(owner, setPosAiPackage, { restaurantId: a.id, enabled: true, monthlyLimit: 100 }))).toBe('FORBIDDEN');
    expect(await getAiPackage(prisma(), a.id)).toMatchObject({ enabled: false });
    expect(codeOf(await run(admin, setPosAiPackage, { restaurantId: a.id, enabled: true, monthlyLimit: 100 }))).toBe('OK');
    expect(await getAiPackage(prisma(), a.id)).toMatchObject({ enabled: true, monthlyLimit: 100 });
    expect(await getAiPackage(prisma(), b.id)).toMatchObject({ enabled: false });
    const audit = await prisma().auditLog.findFirst({ where: { action: 'pos.ai.package' } });
    expect(audit).toMatchObject({ restaurantId: a.id, entityId: a.id });
    expect(audit?.changes).toMatchObject({ enabled: { before: false, after: true }, monthlyLimit: { before: 0, after: 100 } });
    expect(codeOf(await run(admin, setPosAiPackage, { restaurantId: 'nope', enabled: true }))).toBe('NOT_FOUND');
  });

  it('rejects a limit outside 0..1,000,000', async () => {
    expect(codeOf(await run(admin, setPosAiPackage, { restaurantId: a.id, enabled: true, monthlyLimit: -1 }))).toBe('INVALID');
    expect(codeOf(await run(admin, setPosAiPackage, { restaurantId: a.id, enabled: true, monthlyLimit: 1_000_001 }))).toBe('INVALID');
  });
});

describe('visibility and the Baghdad month', () => {
  it('off: every flag is false except the package page, which only owners and managers have', () => {
    for (const role of POS_ROLES) {
      const v = aiVisibility(role, false);
      expect({ ...v, packagePage: undefined }).toEqual({ nav: false, ask: false, summary: false, alerts: false, supplyEntry: false, complaintLabels: false, packagePage: undefined });
      expect(v.packagePage).toBe(role === 'OWNER' || role === 'MANAGER');
    }
  });

  it('on: owner and manager get everything, cashier and kitchen nothing', () => {
    for (const role of ['OWNER', 'MANAGER'] as const) expect(Object.values(aiVisibility(role, true)).every(Boolean)).toBe(true);
    for (const role of ['CASHIER', 'KITCHEN'] as const) expect(Object.values(aiVisibility(role, true)).some(Boolean)).toBe(false);
  });

  it('counts the month in Baghdad time', () => {
    expect(baghdadMonthOf(new Date('2026-10-31T21:30:00Z'))).toBe('2026-11');
    expect(baghdadMonthOf(new Date('2026-10-31T20:30:00Z'))).toBe('2026-10');
  });
});
