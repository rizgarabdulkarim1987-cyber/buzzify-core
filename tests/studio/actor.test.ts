import { headers } from 'next/headers';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPrisma } from '@/server/data/prisma';
import { getActor } from '@/server/studio/auth/actor';
import { getAuth } from '@/server/studio/auth/auth';
import { createPasswordUser, deactivateUser } from '@/server/studio/auth/users';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { cookieHeader } from '../helpers/auth';
import { requireTestDb, resetTestData } from '../helpers/db';

// `getActor` reads the session from the request's headers, which only exist inside Next. The test stands in for them.
vi.mock('next/headers', () => ({ headers: vi.fn() }));

const GOOD = 'correct horse battery staple';
const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

describe('getActor', () => {
  // getActor uses the application's client, which reads DATABASE_URL: point it at the test database, never development.
  beforeAll(() => {
    requireTestDb();
    vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
    vi.stubEnv('RESEND_API_KEY', '');
  });

  beforeEach(async () => {
    vi.mocked(headers).mockReset();
    await resetTestData(getPrisma());
  });

  afterAll(async () => {
    await resetTestData(getPrisma());
    await getPrisma().$disconnect();
    delete globalForPrisma.__prisma;
    vi.unstubAllEnvs();
  });

  /** Signs a user in and returns the request headers a browser would then send. */
  async function signedIn(email: string) {
    const res = await getAuth().api.signInEmail({ body: { email, password: GOOD }, returnHeaders: true });
    return cookieHeader(res.headers.getSetCookie());
  }

  it('returns nothing when the request has no session', async () => {
    vi.mocked(headers).mockResolvedValue(new Headers() as never);
    expect(await getActor()).toBeNull();
  });

  it('returns the signed-in person with their memberships', async () => {
    const prisma = getPrisma();
    const { userId } = await createPasswordUser(prisma, { email: 'owner@example.com', name: 'Owner', password: GOOD, locale: 'ckb' });
    const restaurant = await prisma.restaurant.create({ data: { name: 'Alpha' } });
    await prisma.membership.create({ data: { userId, restaurantId: restaurant.id, role: 'DESIGNER' } });

    vi.mocked(headers).mockResolvedValue((await signedIn('owner@example.com')) as never);
    expect(await getActor()).toEqual({
      userId,
      email: 'owner@example.com',
      name: 'Owner',
      isSuperAdmin: false,
      twoFactorEnabled: false,
      locale: 'ckb',
      memberships: [{ restaurantId: restaurant.id, role: 'DESIGNER' }],
    });
  });

  it('returns nothing once the person is deactivated, even with a session cookie from before', async () => {
    const prisma = getPrisma();
    const { userId } = await createPasswordUser(prisma, { email: 'owner@example.com', name: 'Owner', password: GOOD });
    const session = await signedIn('owner@example.com');
    vi.mocked(headers).mockResolvedValue(session as never);
    expect(await getActor()).not.toBeNull();

    await deactivateUser(prisma, userId);
    expect(await getActor()).toBeNull();
  });
});
