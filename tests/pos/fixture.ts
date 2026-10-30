import { vi } from 'vitest';
import { getPrisma } from '@/server/data/prisma';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { createPasswordUser } from '@/server/studio/auth/users';
import { runAction, type ActionDef } from '@/server/studio/framework/action';
import { runQuery, type QueryDef } from '@/server/studio/framework/query';
import type { ActionResult } from '@/server/studio/framework/result';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { requireTestDb, resetTestData } from '../helpers/db';

export const GOOD = 'correct horse battery staple';
export const META = { ip: '203.0.113.7', userAgent: 'vitest' };
export const prisma = () => getPrisma();

const DAY = 86_400_000;

export interface Person {
  userId: string;
  email: string;
}

/** The framework uses the application's client, which reads DATABASE_URL: point it at the test database. */
export function useTestDatabase(): void {
  requireTestDb();
  vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
  vi.stubEnv('RESEND_API_KEY', '');
}

/** Wipes the data and makes the two applications every restaurant can subscribe to. */
export async function resetWorld(): Promise<void> {
  await resetTestData(prisma());
  await prisma().application.createMany({
    data: [
      { id: 'menu', name: { en: 'Menu' } },
      { id: 'cashier', name: { en: 'Cashier' } },
    ],
  });
}

/** A restaurant, with a live Cashier subscription unless told otherwise. */
export async function restaurant(name: string, cashier: 'ACTIVE' | 'none' = 'ACTIVE'): Promise<{ id: string }> {
  const row = await prisma().restaurant.create({ data: { name }, select: { id: true } });
  if (cashier === 'ACTIVE') {
    const now = Date.now();
    await prisma().subscription.create({
      data: {
        restaurantId: row.id,
        applicationId: 'cashier',
        planCode: 'standard',
        status: 'ACTIVE',
        period: 'MONTHLY',
        currency: 'IQD',
        priceMinor: 0,
        currentPeriodStart: new Date(now - 5 * DAY),
        currentPeriodEnd: new Date(now + 25 * DAY),
        version: 1,
      },
    });
  }
  return row;
}

export async function person(
  label: string,
  flags: {
    membership?: [string, 'DESIGNER' | 'OWNER'];
    staff?: [string, 'OWNER' | 'MANAGER' | 'CASHIER' | 'KITCHEN' | 'CAPTAIN'];
    superAdmin?: boolean;
  } = {},
): Promise<Person> {
  const email = `${label}@pos-test.example`;
  const { userId } = await createPasswordUser(prisma(), { email, name: `${label} person`, password: GOOD, isSuperAdmin: flags.superAdmin });
  if (flags.superAdmin) await prisma().user.update({ where: { id: userId }, data: { twoFactorEnabled: true } });
  if (flags.membership) await prisma().membership.create({ data: { userId, restaurantId: flags.membership[0], role: flags.membership[1] } });
  if (flags.staff) await prisma().posStaff.create({ data: { userId, restaurantId: flags.staff[0], role: flags.staff[1] } });
  return { userId, email };
}

const actorOf = async (who: Person) => (await loadActor(prisma(), who.userId)) as Actor;

export const run = async <I, O>(who: Person, def: ActionDef<I, O>, input: unknown) =>
  runAction(prisma(), await actorOf(who), def, input, META);
export const ask = async <I, O>(who: Person, def: QueryDef<I, O>, input: unknown) =>
  runQuery(prisma(), await actorOf(who), def, input);

export const codeOf = (result: ActionResult<unknown>) => (result.ok ? 'OK' : result.error.code);
export const dataOf = <T>(result: ActionResult<T>): T => {
  if (!result.ok) throw new Error(`expected success, got ${JSON.stringify(result.error)}`);
  return result.data;
};
export const failureOf = (result: ActionResult<unknown>) => {
  if (result.ok) throw new Error(`expected a failure, got ${JSON.stringify(result.data)}`);
  return result.error;
};
