import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as restaurants from '@/server/studio/actions/restaurants';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { runAction, type ActionDef } from '@/server/studio/framework/action';
import { runQuery } from '@/server/studio/framework/query';
import type { ActionResult } from '@/server/studio/framework/result';
import { listRestaurants } from '@/server/studio/queries/restaurants';
import * as invitations from '@/server/studio/services/invitations';
import { person, pharmacy, prisma, resetWorld, useTestDatabase } from './fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));
vi.mock('@/server/studio/services/invitations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/studio/services/invitations')>();
  return { ...actual, createInvitation: vi.fn(actual.createInvitation) };
});

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };
const META = { ip: '203.0.113.7', userAgent: 'vitest' };

const codeOf = (result: ActionResult<unknown>) => (result.ok ? 'OK' : result.error.code);
const dataOf = <T>(result: ActionResult<T>): T => {
  if (!result.ok) throw new Error(`expected success, got ${JSON.stringify(result.error)}`);
  return result.data;
};
const run = <I, O>(actor: Actor, def: ActionDef<I, O>, input: unknown) => runAction(prisma(), actor, def, input, META);
const actorOf = async (userId: string) => (await loadActor(prisma(), userId)) as Actor;

const PROFILE = { name: 'Rizgar Pharmacy', type: 'RESTAURANT', city: 'Erbil' };
const PHARMACY = { ...PROFILE, sector: 'PHARMACY', branches: [{ name: 'Main', city: 'Erbil' }, { name: 'Ankawa' }] };

let admin: Actor;

beforeAll(() => {
  useTestDatabase();
});

afterAll(async () => {
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

beforeEach(async () => {
  await resetWorld();
  vi.mocked(invitations.createInvitation).mockClear();
  admin = await actorOf((await person('root', { superAdmin: true })).userId);
});

describe('creating a pharmacy', () => {
  it('creating a pharmacy makes the business, its branches and settings in one transaction and audits it under the business', async () => {
    const { restaurantId } = dataOf(await run(admin, restaurants.createRestaurant, { ...PHARMACY, currencies: ['IQD', 'USD'] }));

    const row = await prisma().restaurant.findUniqueOrThrow({ where: { id: restaurantId } });
    expect(row).toMatchObject({ name: 'Rizgar Pharmacy', sector: 'PHARMACY', status: 'ACTIVE' });
    const branches = await prisma().branch.findMany({ where: { restaurantId }, orderBy: { sortOrder: 'asc' } });
    expect(branches.map((b) => [b.name, b.city, b.sortOrder])).toEqual([
      ['Main', 'Erbil', 0],
      ['Ankawa', '', 1],
    ]);
    const settings = await prisma().phSettings.findUniqueOrThrow({ where: { restaurantId } });
    expect(settings).toMatchObject({ enabledCurrencies: ['IQD', 'USD'], defaultCurrency: 'IQD', rxRetentionDays: null });

    const audit = await prisma().auditLog.findFirstOrThrow({ where: { action: 'restaurant.created' } });
    expect(audit).toMatchObject({ actorId: admin.userId, restaurantId, entityType: 'Restaurant', entityId: restaurantId });
    expect(audit.changes).toMatchObject({ sector: { before: null, after: 'PHARMACY' }, branches: { before: null, after: ['Main', 'Ankawa'] } });
    // The pharmacy subscription is started by the billing screens, not here.
    expect(await prisma().subscription.count({ where: { restaurantId } })).toBe(0);
  });

  it('a pharmacy needs at least one branch', async () => {
    for (const branches of [undefined, []]) {
      const result = await run(admin, restaurants.createRestaurant, { ...PROFILE, sector: 'PHARMACY', ...(branches ? { branches } : {}) });
      expect(result.ok ? 'OK' : Object.keys(result.error.fields ?? {})).toEqual(['branches']);
    }
    expect(await prisma().restaurant.count({ where: { sector: 'PHARMACY' } })).toBe(0);
  });

  it('an unknown currency is refused', async () => {
    const result = await run(admin, restaurants.createRestaurant, { ...PHARMACY, currencies: ['IQD', 'EUR'] });
    expect(codeOf(result)).toBe('INVALID');
    expect(await prisma().restaurant.count({ where: { sector: 'PHARMACY' } })).toBe(0);
  });

  it('a failure inside provisioning leaves no business behind', async () => {
    vi.mocked(invitations.createInvitation).mockRejectedValueOnce(new Error('mail table on fire'));
    const result = await run(admin, restaurants.createRestaurant, { ...PHARMACY, ownerEmail: 'boss@ph-test.example' });
    expect(codeOf(result)).not.toBe('OK');
    expect(await prisma().restaurant.count({ where: { name: PROFILE.name } })).toBe(0);
    expect(await prisma().branch.count()).toBe(0);
    expect(await prisma().phSettings.count()).toBe(0);
    expect(await prisma().auditLog.count({ where: { action: 'restaurant.created' } })).toBe(0);
  });

  it('a FOOD restaurant is created exactly as before (same rows, same audit)', async () => {
    const { restaurantId } = dataOf(await run(admin, restaurants.createRestaurant, { ...PROFILE, branches: [{ name: 'Ignored' }], currencies: ['USD'] }));
    const row = await prisma().restaurant.findUniqueOrThrow({ where: { id: restaurantId } });
    expect(row).toMatchObject({ sector: 'FOOD', plan: 'BASIC' });
    expect(await prisma().branch.count({ where: { restaurantId } })).toBe(0);
    expect(await prisma().phSettings.count({ where: { restaurantId } })).toBe(0);
    expect(await prisma().invitation.count()).toBe(0);
    const audit = await prisma().auditLog.findFirstOrThrow({ where: { action: 'restaurant.created' } });
    expect(Object.keys(audit.changes as object).sort()).toEqual(['city', 'name', 'plan', 'type']);
  });

  it('only a Super Admin can create a pharmacy', async () => {
    const food = await pharmacy('Some cafe', { sector: 'FOOD' });
    const owner = await person('owner1', { membership: [food.id, 'OWNER'] });
    const designer = await person('design1', { membership: [food.id, 'DESIGNER'] });
    for (const who of [owner, designer]) {
      expect(codeOf(await run(await actorOf(who.userId), restaurants.createRestaurant, PHARMACY))).toBe('FORBIDDEN');
    }
    expect(await prisma().restaurant.count({ where: { sector: 'PHARMACY' } })).toBe(0);
  });

  it('the owner invitation is created for the email and carries the business id', async () => {
    const { restaurantId } = dataOf(await run(admin, restaurants.createRestaurant, { ...PHARMACY, ownerEmail: ' Boss@Ph-Test.example ' }));
    const rows = await prisma().invitation.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ email: 'boss@ph-test.example', restaurantId, role: 'OWNER', asSuperAdmin: false, invitedById: admin.userId });
    const audit = await prisma().auditLog.findFirstOrThrow({ where: { action: 'invitation.created' } });
    expect(audit.restaurantId).toBe(restaurantId);
    expect(JSON.stringify(audit.changes)).not.toMatch(/token|http/i);
  });

  it('the restaurants list says each business sector and filters by it', async () => {
    dataOf(await run(admin, restaurants.createRestaurant, PHARMACY));
    dataOf(await run(admin, restaurants.createRestaurant, { ...PROFILE, name: 'A cafe' }));
    const all = dataOf(await runQuery(prisma(), admin, listRestaurants, {}));
    expect(all.rows.map((r) => [r.name, r.sector]).sort()).toEqual([
      ['A cafe', 'FOOD'],
      ['Rizgar Pharmacy', 'PHARMACY'],
    ]);
    const only = dataOf(await runQuery(prisma(), admin, listRestaurants, { sector: 'PHARMACY' }));
    expect(only.rows.map((r) => r.name)).toEqual(['Rizgar Pharmacy']);
  });

  it('a pharmacy with an email already owning another business is allowed (same person, two businesses)', async () => {
    const first = dataOf(await run(admin, restaurants.createRestaurant, { ...PHARMACY, ownerEmail: 'twice@ph-test.example' })).restaurantId;
    const second = dataOf(await run(admin, restaurants.createRestaurant, { ...PHARMACY, name: 'Second', ownerEmail: 'twice@ph-test.example' })).restaurantId;
    expect(second).not.toBe(first);
    expect((await prisma().invitation.findMany({ select: { restaurantId: true } })).map((i) => i.restaurantId).sort()).toEqual([first, second].sort());
  });
});
