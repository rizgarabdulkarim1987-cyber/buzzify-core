import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPrisma } from '@/server/data/prisma';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { runQuery, type QueryDef } from '@/server/studio/framework/query';
import type { ActionResult } from '@/server/studio/framework/result';
import * as activityQueries from '@/server/studio/queries/activity';
import * as billingQueries from '@/server/studio/queries/billing';
import * as overviewQueries from '@/server/studio/queries/overview';
import * as peopleQueries from '@/server/studio/queries/people';
import * as restaurantQueries from '@/server/studio/queries/restaurants';
import * as searchQueries from '@/server/studio/queries/search';
import { seedApplications } from '../../prisma/seed/applications';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { requireTestDb, resetTestData } from '../helpers/db';

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };
const prisma = () => getPrisma();

const dataOf = <T>(result: ActionResult<T>): T => {
  if (!result.ok) throw new Error(`expected success, got ${JSON.stringify(result.error)}`);
  return result.data;
};
const ask = <I, O>(actor: Actor, def: QueryDef<I, O>, input: unknown = {}) => runQuery(prisma(), actor, def, input);

let admin: Actor;
let cafe: { id: string };
let clinic: { id: string };

async function person(id: string, name: string, memberships: Array<[string, 'OWNER']> = [], superAdmin = false): Promise<Actor> {
  await prisma().user.create({ data: { id, name, email: `${id}@example.com`, isSuperAdmin: superAdmin, twoFactorEnabled: superAdmin } });
  for (const [restaurantId, role] of memberships) await prisma().membership.create({ data: { userId: id, restaurantId, role } });
  return (await loadActor(prisma(), id)) as Actor;
}

beforeAll(async () => {
  requireTestDb();
  vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
  await resetTestData(prisma());
});

beforeEach(async () => {
  await resetTestData(prisma());
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await seedApplications(prisma());
  cafe = await prisma().restaurant.create({ data: { name: 'Cafe Alpha' } });
  clinic = await prisma().restaurant.create({ data: { name: 'Clinic Beta', sector: 'PHARMACY' } });
  admin = await person('admin', 'Sam Admin', [], true);
  await person('food-owner', 'Fay Food', [[cafe.id, 'OWNER']]);
  await person('pharm-owner', 'Pat Pharm', [[clinic.id, 'OWNER']]);
  await person('both-owner', 'Bo Both', [
    [cafe.id, 'OWNER'],
    [clinic.id, 'OWNER'],
  ]);
  await prisma().auditLog.create({ data: { restaurantId: cafe.id, action: 'restaurant.rename', entityType: 'Restaurant', entityId: cafe.id } });
  await prisma().auditLog.create({ data: { restaurantId: clinic.id, action: 'restaurant.rename', entityType: 'Restaurant', entityId: clinic.id } });
  await prisma().auditLog.create({ data: { action: 'auth.signIn', entityType: 'User', entityId: 'admin' } });
  await prisma().invitation.create({
    data: { email: 'a@x.test', restaurantId: cafe.id, role: 'OWNER', tokenHash: 'h-food', expiresAt: new Date(Date.now() + 86_400_000), invitedById: 'admin' },
  });
  await prisma().invitation.create({
    data: { email: 'b@x.test', restaurantId: clinic.id, role: 'OWNER', tokenHash: 'h-pharm', expiresAt: new Date(Date.now() + 86_400_000), invitedById: 'admin' },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await resetTestData(prisma());
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
  vi.unstubAllEnvs();
});

describe('restaurants and billing by space', () => {
  it('lists only the businesses of the space', async () => {
    const food = dataOf(await ask(admin, restaurantQueries.listRestaurants, { space: 'food' }));
    const pharmacy = dataOf(await ask(admin, restaurantQueries.listRestaurants, { space: 'pharmacy' }));
    expect(food.rows.map((row) => row.name)).toEqual(['Cafe Alpha']);
    expect(pharmacy.rows.map((row) => row.name)).toEqual(['Clinic Beta']);
  });

  it('bills only the businesses and products of the space', async () => {
    const food = dataOf(await ask(admin, billingQueries.billingRestaurants, { space: 'food' }));
    const pharmacy = dataOf(await ask(admin, billingQueries.billingRestaurants, { space: 'pharmacy' }));
    expect(food.rows.map((row) => row.name)).toEqual(['Cafe Alpha']);
    expect(food.applications.map((app) => app.id)).toEqual(['menu', 'cashier']);
    expect(pharmacy.rows.map((row) => row.name)).toEqual(['Clinic Beta']);
    expect(pharmacy.applications.map((app) => app.id)).toEqual(['pharmacy']);
    const settings = dataOf(await ask(admin, billingQueries.billingOverview, { space: 'pharmacy' }));
    expect(settings.applications.map((app) => app.id)).toEqual(['pharmacy']);
  });
});

describe('one business billing', () => {
  it('offers a pharmacy only the pharmacy product and a restaurant only Menu and Cashier', async () => {
    const pharmacy = dataOf(await ask(admin, billingQueries.restaurantBilling, { restaurantId: clinic.id }));
    const food = dataOf(await ask(admin, billingQueries.restaurantBilling, { restaurantId: cafe.id }));
    expect(pharmacy.applications.map((app) => app.id)).toEqual(['pharmacy']);
    expect(food.applications.map((app) => app.id)).toEqual(['menu', 'cashier']);
  });
});

describe('people by space', () => {
  it('shows a person with businesses in both sectors in both lists, each with only that space\'s businesses', async () => {
    const food = dataOf(await ask(admin, peopleQueries.listPeople, { space: 'food' }));
    const pharmacy = dataOf(await ask(admin, peopleQueries.listPeople, { space: 'pharmacy' }));
    expect(food.rows.map((row) => row.userId).sort()).toEqual(['both-owner', 'food-owner']);
    expect(pharmacy.rows.map((row) => row.userId).sort()).toEqual(['both-owner', 'pharm-owner']);
    expect(food.rows.find((row) => row.userId === 'both-owner')!.memberships.map((m) => m.restaurantId)).toEqual([cafe.id]);
    expect(pharmacy.rows.find((row) => row.userId === 'both-owner')!.memberships.map((m) => m.restaurantId)).toEqual([clinic.id]);
  });

  it('lists only the invitations to the space\'s businesses', async () => {
    const food = dataOf(await ask(admin, peopleQueries.listInvitations, { space: 'food' }));
    const pharmacy = dataOf(await ask(admin, peopleQueries.listInvitations, { space: 'pharmacy' }));
    expect(food.rows.map((row) => row.email)).toEqual(['a@x.test']);
    expect(pharmacy.rows.map((row) => row.email)).toEqual(['b@x.test']);
  });
});

describe('activity, overview and search by space', () => {
  it('shows each space its own audit rows; the rows with no business belong to Menu and Cashier, so none is hidden', async () => {
    const food = dataOf(await ask(admin, activityQueries.listActivity, { space: 'food' }));
    const pharmacy = dataOf(await ask(admin, activityQueries.listActivity, { space: 'pharmacy' }));
    expect(food.rows.map((row) => row.entityId).sort()).toEqual(['admin', cafe.id].sort());
    expect(pharmacy.rows.map((row) => row.entityId)).toEqual([clinic.id]);
  });

  it('counts only the space\'s businesses on the overview', async () => {
    const food = dataOf(await ask(admin, overviewQueries.overview, { space: 'food' }));
    const pharmacy = dataOf(await ask(admin, overviewQueries.overview, { space: 'pharmacy' }));
    expect(food.restaurants.ACTIVE).toBe(1);
    expect(pharmacy.restaurants.ACTIVE).toBe(1);
    expect(food.recentActivity?.map((row) => row.entityId).sort()).toEqual(['admin', cafe.id].sort());
    expect(pharmacy.recentActivity?.map((row) => row.entityId)).toEqual([clinic.id]);
  });

  it('puts the pharmacy plans and pharmacy announcements in the Pharmacy activity, not Menu and Cashier', async () => {
    const note = await prisma().announcement.create({ data: { titles: {}, bodies: {}, space: 'pharmacy' } });
    await prisma().auditLog.create({ data: { action: 'app_plan.updated', entityType: 'AppPlan', entityId: 'standard' } });
    await prisma().auditLog.create({ data: { action: 'announcement.created', entityType: 'Announcement', entityId: note.id } });
    const food = dataOf(await ask(admin, activityQueries.listActivity, { space: 'food' }));
    const pharmacy = dataOf(await ask(admin, activityQueries.listActivity, { space: 'pharmacy' }));
    expect(food.rows.map((row) => row.action)).not.toContain('app_plan.updated');
    expect(food.rows.map((row) => row.action)).not.toContain('announcement.created');
    expect(pharmacy.rows.map((row) => row.action).sort()).toEqual(['announcement.created', 'app_plan.updated', 'restaurant.rename']);
  });

  it('keeps Jump to and the pickers inside the space', async () => {
    const jump = dataOf(await ask(admin, searchQueries.jump, { q: 'a', space: 'food' }));
    expect(jump.restaurants.map((row) => row.name)).toEqual(['Cafe Alpha']);
    const picker = dataOf(await ask(admin, searchQueries.searchRestaurants, { q: '', space: 'pharmacy' }));
    expect(picker.rows.map((row) => row.name)).toEqual(['Clinic Beta']);
  });

  it('does not cut anyone but a Super Admin by space', async () => {
    const owner = (await loadActor(prisma(), 'both-owner')) as Actor;
    const mine = dataOf(await ask(owner, restaurantQueries.listRestaurants, { space: 'food' }));
    expect(mine.rows.map((row) => row.name).sort()).toEqual(['Cafe Alpha', 'Clinic Beta']);
  });
});
