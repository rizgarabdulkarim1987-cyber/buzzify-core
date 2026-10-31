import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as menus from '@/server/studio/actions/menus';
import * as restaurants from '@/server/studio/actions/restaurants';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { runAction, type ActionDef } from '@/server/studio/framework/action';
import type { ActionResult } from '@/server/studio/framework/result';
import { RETAIL_BRANCHES_IN_RETAILS, RETAIL_NOT_DELETED } from '@/server/studio/services/restaurants';
import { person, pharmacy, prisma, resetWorld, useTestDatabase } from '../pharmacy/fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };
const META = { ip: '203.0.113.7', userAgent: 'vitest' };

const codeOf = (result: ActionResult<unknown>) => (result.ok ? 'OK' : result.error.code);
const dataOf = <T>(result: ActionResult<T>): T => {
  if (!result.ok) throw new Error(`expected success, got ${JSON.stringify(result.error)}`);
  return result.data;
};
const run = <I, O>(actor: Actor, def: ActionDef<I, O>, input: unknown) => runAction(prisma(), actor, def, input, META);
const actorOf = async (userId: string) => (await loadActor(prisma(), userId)) as Actor;

const RETAIL = {
  name: 'Rizgar Retail',
  type: 'OTHER',
  city: 'Erbil',
  sector: 'RETAIL',
  branches: [{ name: 'Main', city: 'Erbil' }, { name: 'Ankawa' }],
  currencies: ['IQD', 'USD'],
  ownerEmail: 'Boss@Retail-Test.example',
};

let admin: Actor;

beforeAll(() => useTestDatabase());
afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});
beforeEach(async () => {
  await resetWorld();
  admin = await actorOf((await person('root', { superAdmin: true })).userId);
});

describe('creating a RETAIL business', () => {
  it('a Super Admin creates a RETAIL business with two branches, IQD+USD and an owner invitation', async () => {
    const { restaurantId } = dataOf(await run(admin, restaurants.createRestaurant, RETAIL));

    const row = await prisma().restaurant.findUniqueOrThrow({ where: { id: restaurantId } });
    expect(row).toMatchObject({ name: 'Rizgar Retail', sector: 'RETAIL', status: 'ACTIVE' });
    const branches = await prisma().branch.findMany({ where: { restaurantId }, orderBy: { sortOrder: 'asc' } });
    expect(branches.map((b) => [b.name, b.city, b.sortOrder])).toEqual([
      ['Main', 'Erbil', 0],
      ['Ankawa', '', 1],
    ]);
    const link = await prisma().retailLink.findUniqueOrThrow({ where: { restaurantId } });
    expect(link).toMatchObject({ currencies: ['IQD', 'USD'], stateVersion: 0, acceptedVersion: 0, retailBusinessId: null });
    // Nothing is queued yet, and there are no PhSettings: it is not a pharmacy.
    expect(await prisma().retailOutbox.count({ where: { restaurantId } })).toBe(0);
    expect(await prisma().phSettings.count({ where: { restaurantId } })).toBe(0);

    const invitations = await prisma().invitation.findMany();
    expect(invitations).toHaveLength(1);
    expect(invitations[0]).toMatchObject({ email: 'boss@retail-test.example', restaurantId, role: 'OWNER', asSuperAdmin: false, invitedById: admin.userId });

    const created = await prisma().auditLog.findFirstOrThrow({ where: { action: 'restaurant.created' } });
    expect(created).toMatchObject({ actorId: admin.userId, restaurantId, entityType: 'Restaurant', entityId: restaurantId });
    expect(created.changes).toMatchObject({ sector: { before: null, after: 'RETAIL' }, branches: { before: null, after: ['Main', 'Ankawa'] } });
    const invited = await prisma().auditLog.findFirstOrThrow({ where: { action: 'invitation.created' } });
    expect(invited.restaurantId).toBe(restaurantId);
    expect(JSON.stringify(invited.changes)).not.toMatch(/token|http/i);
    // Billing starts the retail subscription, not creation.
    expect(await prisma().subscription.count({ where: { restaurantId } })).toBe(0);
  });

  it('refuses duplicate branch names', async () => {
    const result = await run(admin, restaurants.createRestaurant, { ...RETAIL, branches: [{ name: 'Main' }, { name: ' main ' }] });
    expect(result.ok ? 'OK' : Object.keys(result.error.fields ?? {})).toEqual(['branches']);
    expect(await prisma().restaurant.count({ where: { sector: 'RETAIL' } })).toBe(0);
  });

  it('refuses a branch name of 81 characters', async () => {
    const long = 'b'.repeat(81);
    expect(codeOf(await run(admin, restaurants.createRestaurant, { ...RETAIL, branches: [{ name: long }] }))).toBe('INVALID');
    expect(await prisma().restaurant.count({ where: { sector: 'RETAIL' } })).toBe(0);
    // 80 is fine.
    expect(codeOf(await run(admin, restaurants.createRestaurant, { ...RETAIL, branches: [{ name: 'b'.repeat(80) }] }))).toBe('OK');
  });

  it('refuses without an owner email', async () => {
    const without: Record<string, unknown> = { ...RETAIL };
    delete without.ownerEmail;
    const result = await run(admin, restaurants.createRestaurant, without);
    expect(result.ok ? 'OK' : Object.keys(result.error.fields ?? {})).toEqual(['ownerEmail']);
    expect(await prisma().restaurant.count({ where: { sector: 'RETAIL' } })).toBe(0);
  });

  it('refuses without a branch', async () => {
    const result = await run(admin, restaurants.createRestaurant, { ...RETAIL, branches: [] });
    expect(result.ok ? 'OK' : Object.keys(result.error.fields ?? {})).toEqual(['branches']);
  });

  it('a non-Super-Admin cannot create', async () => {
    const food = await pharmacy('Some cafe', { sector: 'FOOD' });
    const owner = await person('owner1', { membership: [food.id, 'OWNER'] });
    expect(codeOf(await run(await actorOf(owner.userId), restaurants.createRestaurant, RETAIL))).toBe('FORBIDDEN');
    expect(await prisma().restaurant.count({ where: { sector: 'RETAIL' } })).toBe(0);
  });

  it('deleting a RETAIL business is refused', async () => {
    const { restaurantId } = dataOf(await run(admin, restaurants.createRestaurant, RETAIL));
    const refused = await run(admin, restaurants.deleteRestaurant, { restaurantId, confirmName: 'Rizgar Retail' });
    expect(refused).toMatchObject({ ok: false, error: { code: 'CONFLICT', message: RETAIL_NOT_DELETED } });
    expect(await prisma().restaurant.count({ where: { id: restaurantId } })).toBe(1);
    expect(await prisma().retailLink.count({ where: { restaurantId } })).toBe(1);
  });

  it('branches of a RETAIL business are managed in Retails: Studio neither adds nor deletes them', async () => {
    const { restaurantId } = dataOf(await run(admin, restaurants.createRestaurant, RETAIL));
    const [main] = await prisma().branch.findMany({ where: { restaurantId }, orderBy: { sortOrder: 'asc' } });
    const added = await run(admin, restaurants.createBranch, { restaurantId, name: 'Third' });
    expect(added).toMatchObject({ ok: false, error: { code: 'CONFLICT', message: RETAIL_BRANCHES_IN_RETAILS } });
    const removed = await run(admin, restaurants.deleteBranch, { restaurantId, branchId: main!.id });
    expect(removed).toMatchObject({ ok: false, error: { code: 'CONFLICT', message: RETAIL_BRANCHES_IN_RETAILS } });
    expect(await prisma().branch.count({ where: { restaurantId } })).toBe(2);
  });

  it('branches of a RETAIL business are not renamed or reordered in Studio either', async () => {
    const { restaurantId } = dataOf(await run(admin, restaurants.createRestaurant, RETAIL));
    const [main, ankawa] = await prisma().branch.findMany({ where: { restaurantId }, orderBy: { sortOrder: 'asc' } });
    const renamed = await run(admin, restaurants.updateBranch, { restaurantId, branchId: main!.id, version: main!.version, name: 'Renamed' });
    expect(renamed).toMatchObject({ ok: false, error: { code: 'CONFLICT', message: RETAIL_BRANCHES_IN_RETAILS } });
    const reordered = await run(admin, restaurants.reorderBranches, { restaurantId, order: [ankawa!.id, main!.id] });
    expect(reordered).toMatchObject({ ok: false, error: { code: 'CONFLICT', message: RETAIL_BRANCHES_IN_RETAILS } });
    const after = await prisma().branch.findMany({ where: { restaurantId }, orderBy: { sortOrder: 'asc' } });
    expect(after.map((b) => b.name)).toEqual(['Main', 'Ankawa']);
  });

  it('a menu is created only in a FOOD business', async () => {
    const { restaurantId } = dataOf(await run(admin, restaurants.createRestaurant, RETAIL));
    const refused = await run(admin, menus.createMenu, { restaurantId, name: 'Menu', slug: 'retail-menu' });
    expect(refused).toMatchObject({ ok: false, error: { code: 'CONFLICT', message: menus.MENUS_FOOD_ONLY } });
    const ph = await pharmacy('Some pharmacy');
    expect(codeOf(await run(admin, menus.createMenu, { restaurantId: ph.id, name: 'Menu', slug: 'ph-menu' }))).toBe('CONFLICT');
    const food = await pharmacy('Some cafe', { sector: 'FOOD' });
    expect(codeOf(await run(admin, menus.createMenu, { restaurantId: food.id, name: 'Menu', slug: 'food-menu' }))).toBe('OK');
    expect(await prisma().menu.count({ where: { restaurantId: { in: [restaurantId, ph.id] } } })).toBe(0);
  });

  it('a FOOD create is unchanged', async () => {
    const { restaurantId } = dataOf(
      await run(admin, restaurants.createRestaurant, { name: 'A cafe', type: 'RESTAURANT', branches: [{ name: 'Ignored' }], currencies: ['USD'] }),
    );
    expect(await prisma().restaurant.findUniqueOrThrow({ where: { id: restaurantId } })).toMatchObject({ sector: 'FOOD', plan: 'BASIC' });
    expect(await prisma().retailLink.count({ where: { restaurantId } })).toBe(0);
    expect(await prisma().branch.count({ where: { restaurantId } })).toBe(0);
    expect(await prisma().invitation.count()).toBe(0);
  });
});
