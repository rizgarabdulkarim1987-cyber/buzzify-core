import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getPrisma } from '@/server/data/prisma';
import * as plans from '@/server/studio/actions/plans';
import * as restaurants from '@/server/studio/actions/restaurants';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { createPasswordUser } from '@/server/studio/auth/users';
import { runAction, type ActionDef } from '@/server/studio/framework/action';
import { runQuery, type QueryDef } from '@/server/studio/framework/query';
import type { ActionResult } from '@/server/studio/framework/result';
import * as planQueries from '@/server/studio/queries/plans';
import { listRestaurants } from '@/server/studio/queries/restaurants';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { createMenuFixture, requireTestDb, resetTestData } from '../helpers/db';
import { vi } from 'vitest';

const GOOD = 'correct horse battery staple';
const META = { ip: '203.0.113.7', userAgent: 'vitest' };

const dataOf = <T>(result: ActionResult<T>): T => {
  if (!result.ok) throw new Error(`expected success, got ${JSON.stringify(result.error)}`);
  return result.data;
};
const failureOf = (result: ActionResult<unknown>) => {
  if (result.ok) throw new Error(`expected a failure, got ${JSON.stringify(result.data)}`);
  return result.error;
};

const PROFILE = { name: 'Zhamitos', type: 'RESTAURANT' };

describe('plans', () => {
  const prisma = () => getPrisma();
  let a: Awaited<ReturnType<typeof createMenuFixture>>;
  let owner: Actor;
  let otherAdmin: Actor;
  let designer: Actor;
  let restaurantOwner: Actor;

  const act = <I, O>(actor: Actor, def: ActionDef<I, O>, input: unknown) => runAction(prisma(), actor, def, input, META);
  const read = <I, O>(actor: Actor, def: QueryDef<I, O>, input: unknown) => runQuery(prisma(), actor, def, input);

  async function superAdmin(email: string, isPlatformOwner: boolean): Promise<Actor> {
    const { userId } = await createPasswordUser(prisma(), { email, name: email.split('@')[0]!, password: GOOD, isSuperAdmin: true, isPlatformOwner });
    await prisma().user.update({ where: { id: userId }, data: { twoFactorEnabled: true } });
    return (await loadActor(prisma(), userId))!;
  }

  async function member(email: string, role: 'DESIGNER' | 'OWNER'): Promise<Actor> {
    const { userId } = await createPasswordUser(prisma(), { email, name: email.split('@')[0]!, password: GOOD });
    await prisma().membership.create({ data: { userId, restaurantId: a.restaurant.id, role } });
    return (await loadActor(prisma(), userId))!;
  }

  const auditRow = (action: string) => prisma().auditLog.findFirstOrThrow({ where: { action }, orderBy: { occurredAt: 'desc' } });

  beforeEach(async () => {
    requireTestDb();
    vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
    await resetTestData(prisma());
    a = await createMenuFixture(prisma(), 'plans-a');
    owner = await superAdmin('owner@buzzify.test', true);
    otherAdmin = await superAdmin('staff@buzzify.test', false);
    designer = await member('designer@zhamitos.test', 'DESIGNER');
    restaurantOwner = await member('boss@zhamitos.test', 'OWNER');
  });

  afterAll(async () => {
    await resetTestData(prisma());
    vi.unstubAllEnvs();
  });

  const storedPlan = () => prisma().restaurant.findUniqueOrThrow({ where: { id: a.restaurant.id }, select: { plan: true, planExtras: true, planNote: true } });

  it('lets the platform owner move a restaurant to Basic, with a note', async () => {
    expect(dataOf(await act(owner, plans.setRestaurantPlan, { restaurantId: a.restaurant.id, plan: 'BASIC', extras: {}, note: 'Paid until March' }))).toEqual({
      plan: 'BASIC',
      extras: {},
      note: 'Paid until March',
    });
    expect(await storedPlan()).toEqual({ plan: 'BASIC', planExtras: { features: {} }, planNote: 'Paid until March' });
    expect(await auditRow('restaurant.plan_changed')).toMatchObject({
      entityType: 'RestaurantPlan',
      entityId: a.restaurant.id,
      restaurantId: a.restaurant.id,
      changes: { plan: { before: 'PREMIUM', after: 'BASIC' }, note: { before: '', after: 'Paid until March' } },
    });
  });

  it('keeps extras for one restaurant, dropping keys that are not features', async () => {
    const saved = dataOf(await act(owner, plans.setRestaurantPlan, { restaurantId: a.restaurant.id, plan: 'BASIC', extras: { 'immersive.stage': true, 'made.up': true }, note: '' }));
    expect(saved.extras).toEqual({ 'immersive.stage': true });
    expect((await storedPlan()).planExtras).toEqual({ features: { 'immersive.stage': true } });
  });

  it('refuses every plan change to another Super Admin, a designer and an owner', async () => {
    for (const actor of [otherAdmin, designer, restaurantOwner]) {
      expect(failureOf(await act(actor, plans.setRestaurantPlan, { restaurantId: a.restaurant.id, plan: 'BASIC', extras: {}, note: '' })).code).toBe('FORBIDDEN');
      expect(failureOf(await act(actor, plans.updatePlans, { plans: {}, whatsapp: '' })).code).toBe('FORBIDDEN');
    }
    expect((await prisma().restaurant.findUniqueOrThrow({ where: { id: a.restaurant.id } })).plan).toBe('PREMIUM');
  });

  it('shows the Plan tab to everyone in the restaurant, the note to Super Admins only, and the controls to the owner only', async () => {
    await act(owner, plans.setRestaurantPlan, { restaurantId: a.restaurant.id, plan: 'PRO', extras: {}, note: 'Deal' });
    const asOwner = dataOf(await read(owner, planQueries.restaurantPlan, { restaurantId: a.restaurant.id }));
    expect(asOwner).toMatchObject({ plan: 'PRO', note: 'Deal', canEdit: true });
    expect(asOwner.features.map((f) => f.key)).toHaveLength(19);
    expect(asOwner.features.find((f) => f.key === 'immersive.explore')).toMatchObject({ allowed: false, inPlan: false, extra: null, lowestPlan: 'PREMIUM' });
    expect(dataOf(await read(otherAdmin, planQueries.restaurantPlan, { restaurantId: a.restaurant.id }))).toMatchObject({ note: 'Deal', canEdit: false });
    expect(dataOf(await read(restaurantOwner, planQueries.restaurantPlan, { restaurantId: a.restaurant.id }))).toMatchObject({ note: null, canEdit: false });
  });

  it('changes what a plan holds for every restaurant on it, and keeps the WhatsApp number as digits', async () => {
    await act(owner, plans.setRestaurantPlan, { restaurantId: a.restaurant.id, plan: 'BASIC', extras: {}, note: '' });
    const names = { en: 'Starter', ar: 'البداية', ckb: 'دەستپێک' };
    dataOf(await act(owner, plans.updatePlans, { plans: { BASIC: { names, features: { 'immersive.explore': true } } }, whatsapp: '+964 750 123 4567' }));
    const tab = dataOf(await read(restaurantOwner, planQueries.restaurantPlan, { restaurantId: a.restaurant.id }));
    expect(tab.features.find((f) => f.key === 'immersive.explore')).toMatchObject({ allowed: true, inPlan: true });
    expect(tab.planNames.BASIC).toBe('Starter');
    const settings = dataOf(await read(otherAdmin, planQueries.getPlans, {}));
    expect(settings).toMatchObject({ whatsapp: '9647501234567', canEdit: false });
    expect(settings.plans.BASIC.names).toEqual(names);
    expect(await auditRow('plans.updated')).toMatchObject({ entityType: 'Plans', entityId: 'plans' });
  });

  it('refuses a WhatsApp number that is not digits with a country code', async () => {
    const refused = failureOf(await act(owner, plans.updatePlans, { plans: {}, whatsapp: '0750 abc' }));
    expect(refused).toMatchObject({ code: 'INVALID', fields: { whatsapp: 'Enter the number with its country code, digits only' } });
  });

  it('creates a restaurant on the owner’s chosen plan, and on Basic for anyone else', async () => {
    const mine = dataOf(await act(owner, restaurants.createRestaurant, { ...PROFILE, plan: 'PRO' }));
    expect((await prisma().restaurant.findUniqueOrThrow({ where: { id: mine.restaurantId } })).plan).toBe('PRO');
    const theirs = dataOf(await act(otherAdmin, restaurants.createRestaurant, { ...PROFILE, name: 'Other', plan: 'PREMIUM' }));
    expect((await prisma().restaurant.findUniqueOrThrow({ where: { id: theirs.restaurantId } })).plan).toBe('BASIC');
    const unsaid = dataOf(await act(owner, restaurants.createRestaurant, { ...PROFILE, name: 'Unsaid' }));
    expect((await prisma().restaurant.findUniqueOrThrow({ where: { id: unsaid.restaurantId } })).plan).toBe('BASIC');
  });

  it('filters the restaurant list by plan and shows each one’s plan', async () => {
    await act(owner, plans.setRestaurantPlan, { restaurantId: a.restaurant.id, plan: 'BASIC', extras: {}, note: '' });
    await createMenuFixture(prisma(), 'plans-b');
    const basic = dataOf(await read(otherAdmin, listRestaurants, { plan: 'BASIC' }));
    expect(basic.rows.map((row) => [row.id, row.plan])).toEqual([[a.restaurant.id, 'BASIC']]);
    expect(dataOf(await read(otherAdmin, listRestaurants, {})).rows).toHaveLength(2);
  });
});
