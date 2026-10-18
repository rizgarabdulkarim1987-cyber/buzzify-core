import { cookies, headers } from 'next/headers';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPrisma } from '@/server/data/prisma';
import { getActor } from '@/server/studio/auth/actor';
import { getAuth } from '@/server/studio/auth/auth';
import { createPasswordUser, deactivateUser } from '@/server/studio/auth/users';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { cookieHeader, cookieStore } from '../helpers/auth';
import { requireTestDb, resetTestData } from '../helpers/db';

// `getActor` reads the session from the request's headers and cookies, which only exist inside Next. The test stands in
// for them.
vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

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

  /** Makes `headers()` answer with `sent`, and `cookies()` with its cookies (or with `jar` when given, as after an action). */
  function asRequest(sent: Headers, jar: string | null = sent.get('cookie')) {
    vi.mocked(headers).mockResolvedValue(sent as never);
    vi.mocked(cookies).mockResolvedValue(cookieStore(jar) as never);
  }

  /** Signs a user in and returns the request headers a browser would then send. */
  async function signedIn(email: string) {
    const res = await getAuth().api.signInEmail({ body: { email, password: GOOD }, returnHeaders: true });
    return cookieHeader(res.headers.getSetCookie());
  }

  it('returns nothing when the request has no session', async () => {
    asRequest(new Headers());
    expect(await getActor()).toBeNull();
  });

  it('returns the signed-in person with their memberships', async () => {
    const prisma = getPrisma();
    const { userId } = await createPasswordUser(prisma, { email: 'owner@example.com', name: 'Owner', password: GOOD, locale: 'ckb' });
    const restaurant = await prisma.restaurant.create({ data: { name: 'Alpha' } });
    await prisma.membership.create({ data: { userId, restaurantId: restaurant.id, role: 'DESIGNER' } });

    asRequest(await signedIn('owner@example.com'));
    expect(await getActor()).toEqual({
      userId,
      email: 'owner@example.com',
      name: 'Owner',
      isSuperAdmin: false,
      isPlatformOwner: false,
      twoFactorEnabled: false,
      locale: 'ckb',
      memberships: [{ restaurantId: restaurant.id, role: 'DESIGNER' }],
    });
  });

  it('returns nothing once the person is deactivated, even with a session cookie from before', async () => {
    const prisma = getPrisma();
    const { userId } = await createPasswordUser(prisma, { email: 'owner@example.com', name: 'Owner', password: GOOD });
    const session = await signedIn('owner@example.com');
    asRequest(session);
    expect(await getActor()).not.toBeNull();

    await deactivateUser(prisma, userId);
    expect(await getActor()).toBeNull();
  });

  it('reads the session from cookies(), which a Server Action that replaced it has already updated', async () => {
    // After turning on two-factor or changing the password, the page rendered with the action's answer still has the
    // browser's old cookie in headers(); cookies() has the new session.
    const { userId } = await createPasswordUser(getPrisma(), { email: 'owner@example.com', name: 'Owner', password: GOOD });
    const fresh = await signedIn('owner@example.com');
    asRequest(new Headers({ cookie: 'studio.session_token=ended.session' }), fresh.get('cookie'));
    expect((await getActor())?.userId).toBe(userId);

    // And a session the action ended is gone, whatever the browser sent.
    asRequest(fresh, '');
    expect(await getActor()).toBeNull();
  });
});
