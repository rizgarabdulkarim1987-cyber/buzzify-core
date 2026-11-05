import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as people from '@/server/studio/actions/people';
import * as restaurants from '@/server/studio/actions/restaurants';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { runAction, type ActionDef } from '@/server/studio/framework/action';
import type { ActionResult } from '@/server/studio/framework/result';
import { person, prisma, resetWorld, useTestDatabase } from './fixture';

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

const PROFILE = { name: 'Space Test', type: 'RESTAURANT', city: 'Erbil' };

let admin: Actor;
let cafe: { id: string };
let clinic: { id: string };

beforeAll(() => {
  useTestDatabase();
});

afterAll(async () => {
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

beforeEach(async () => {
  await resetWorld();
  admin = await actorOf((await person('root', { superAdmin: true })).userId);
  cafe = await prisma().restaurant.create({ data: { name: 'Cafe Alpha' } });
  clinic = await prisma().restaurant.create({ data: { name: 'Clinic Beta', sector: 'PHARMACY' } });
  await prisma().branch.create({ data: { restaurantId: clinic.id, name: 'Main' } });
});

describe('a write through one space never touches the other', () => {
  it('refuses to delete a pharmacy from Menu and Cashier, and a food business from the Pharmacy', async () => {
    expect(codeOf(await run(admin, restaurants.deleteRestaurant, { restaurantId: clinic.id, confirmName: 'Clinic Beta', space: 'food' }))).toBe('NOT_FOUND');
    expect(codeOf(await run(admin, restaurants.deleteRestaurant, { restaurantId: cafe.id, confirmName: 'Cafe Alpha', space: 'pharmacy' }))).toBe('NOT_FOUND');
    expect(await prisma().restaurant.count()).toBe(2);
  });

  it('refuses a status change, a branch and an invitation across the sectors', async () => {
    expect(codeOf(await run(admin, restaurants.setRestaurantStatus, { restaurantId: cafe.id, status: 'SUSPENDED', space: 'pharmacy' }))).toBe('NOT_FOUND');
    expect((await prisma().restaurant.findUniqueOrThrow({ where: { id: cafe.id } })).status).toBe('ACTIVE');
    expect(codeOf(await run(admin, restaurants.createBranch, { restaurantId: cafe.id, name: 'Annex', space: 'pharmacy' }))).toBe('NOT_FOUND');
    expect(await prisma().branch.count({ where: { restaurantId: cafe.id } })).toBe(0);
    expect(codeOf(await run(admin, people.inviteOwner, { restaurantId: clinic.id, email: 'boss@x.test', space: 'food' }))).toBe('NOT_FOUND');
    expect(await prisma().invitation.count()).toBe(0);
  });

  it('still works inside its own space', async () => {
    dataOf(await run(admin, restaurants.setRestaurantStatus, { restaurantId: cafe.id, status: 'SUSPENDED', space: 'food' }));
    expect((await prisma().restaurant.findUniqueOrThrow({ where: { id: cafe.id } })).status).toBe('SUSPENDED');
    dataOf(await run(admin, people.inviteOwner, { restaurantId: clinic.id, email: 'boss@x.test', space: 'pharmacy' }));
    expect(await prisma().invitation.count()).toBe(1);
  });

  it('is not required of anyone who names no space', async () => {
    dataOf(await run(admin, restaurants.setRestaurantStatus, { restaurantId: clinic.id, status: 'SUSPENDED' }));
    expect((await prisma().restaurant.findUniqueOrThrow({ where: { id: clinic.id } })).status).toBe('SUSPENDED');
  });
});

describe('creating a business from a space', () => {
  it('makes a FOOD business from Menu and Cashier whatever sector the form sent', async () => {
    const { restaurantId } = dataOf(await run(admin, restaurants.createRestaurant, { ...PROFILE, sector: 'PHARMACY', space: 'food' }));
    expect((await prisma().restaurant.findUniqueOrThrow({ where: { id: restaurantId } })).sector).toBe('FOOD');
  });

  it('makes a pharmacy from the Pharmacy space, which needs a branch', async () => {
    const missing = await run(admin, restaurants.createRestaurant, { ...PROFILE, space: 'pharmacy' });
    expect(missing.ok ? 'OK' : Object.keys(missing.error.fields ?? {})).toEqual(['branches']);
    const { restaurantId } = dataOf(await run(admin, restaurants.createRestaurant, { ...PROFILE, space: 'pharmacy', branches: [{ name: 'Main' }] }));
    expect((await prisma().restaurant.findUniqueOrThrow({ where: { id: restaurantId } })).sector).toBe('PHARMACY');
  });
});
