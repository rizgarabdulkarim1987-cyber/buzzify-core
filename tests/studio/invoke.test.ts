import { headers } from 'next/headers';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { getPrisma } from '@/server/data/prisma';
import { getAuth } from '@/server/studio/auth/auth';
import { createPasswordUser } from '@/server/studio/auth/users';
import { defineAction } from '@/server/studio/framework/action';
import { invoke, invokeQuery, query } from '@/server/studio/framework/invoke';
import { defineQuery } from '@/server/studio/framework/query';
import { studioRoute } from '@/server/studio/framework/route';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { cookieHeader } from '../helpers/auth';
import { requireTestDb, resetTestData } from '../helpers/db';

// Server Actions and pages read the request through `headers()`, which only exists inside Next. The test stands in for it.
vi.mock('next/headers', () => ({ headers: vi.fn() }));

const PASSWORD = 'correct horse battery staple';
const ORIGIN = 'http://127.0.0.1:3100';
const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

const renameRestaurant = defineAction({
  name: 'test.invoke.rename',
  permission: 'restaurant.edit',
  input: z.object({ restaurantId: z.string().min(1), name: z.string().min(1) }),
  target: (i) => ({ kind: 'restaurant', restaurantId: i.restaurantId }),
  run: (ctx, input) =>
    ctx.transaction(async (tx) => {
      await tx.restaurant.update({ where: { id: input.restaurantId }, data: { name: input.name } });
      ctx.audit({ action: 'restaurant.rename', entityType: 'Restaurant', entityId: input.restaurantId });
      return { name: input.name };
    }),
});

const restaurantName = defineQuery({
  name: 'test.invoke.name',
  permission: 'view',
  input: z.object({ restaurantId: z.string().min(1) }),
  target: (i) => ({ kind: 'restaurant', restaurantId: i.restaurantId }),
  run: async ({ db, restaurantId }) => ({
    name: (await db.restaurant.findUniqueOrThrow({ where: { id: restaurantId as string } })).name,
  }),
});

/** What a Next interrupt carries: `NEXT_REDIRECT;<type>;<url>;<status>;` or `NEXT_HTTP_ERROR_FALLBACK;404`. */
async function interruptOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return String((error as { digest?: unknown }).digest);
  }
  throw new Error('Expected the call to throw');
}

describe('invoke, query and studioRoute', () => {
  let alpha: string;
  let beta: string;
  let designerSession: Headers;
  let adminSession: Headers;

  /** Signs a user in and returns the cookie a browser would then send. */
  async function signIn(email: string): Promise<Headers> {
    const res = await getAuth().api.signInEmail({ body: { email, password: PASSWORD }, returnHeaders: true });
    return cookieHeader(res.headers.getSetCookie());
  }

  /** The request headers a page or Server Action would see. */
  function requestHeaders(session: Headers | null, extra: Record<string, string> = {}): Headers {
    const all = new Headers(extra);
    const cookie = session?.get('cookie');
    if (cookie) all.set('cookie', cookie);
    return all;
  }

  function asRequest(session: Headers | null, extra: Record<string, string> = {}) {
    vi.mocked(headers).mockResolvedValue(requestHeaders(session, extra) as never);
  }

  // The framework uses the application's client, which reads DATABASE_URL: point it at the test database.
  beforeAll(() => {
    requireTestDb();
    vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
    vi.stubEnv('RESEND_API_KEY', '');
  });

  beforeEach(async () => {
    const prisma = getPrisma();
    vi.mocked(headers).mockReset();
    await resetTestData(prisma);
    alpha = (await prisma.restaurant.create({ data: { name: 'Alpha' } })).id;
    beta = (await prisma.restaurant.create({ data: { name: 'Beta' } })).id;
    const { userId } = await createPasswordUser(prisma, { email: 'designer@example.com', name: 'Dana', password: PASSWORD });
    await prisma.membership.create({ data: { userId, restaurantId: alpha, role: 'DESIGNER' } });
    await createPasswordUser(prisma, { email: 'admin@example.com', name: 'Sam', password: PASSWORD, isSuperAdmin: true });
    designerSession = await signIn('designer@example.com');
    adminSession = await signIn('admin@example.com');
  });

  afterAll(async () => {
    await resetTestData(getPrisma());
    await getPrisma().$disconnect();
    delete globalForPrisma.__prisma;
    vi.unstubAllEnvs();
  });

  describe('invoke', () => {
    it('acts as the signed-in person and records the address and browser of the request', async () => {
      asRequest(designerSession, { 'x-forwarded-for': '198.51.100.4, 10.0.0.1', 'user-agent': 'Mozilla/5.0 (test)' });
      expect(await invoke(renameRestaurant, { restaurantId: alpha, name: 'Alpha Two' })).toEqual({
        ok: true,
        data: { name: 'Alpha Two' },
      });
      const row = await getPrisma().auditLog.findFirstOrThrow();
      expect(row).toMatchObject({ restaurantId: alpha, ip: '198.51.100.4', userAgent: 'Mozilla/5.0 (test)' });
      expect(row.actorId).toBe((await getPrisma().user.findFirstOrThrow({ where: { email: 'designer@example.com' } })).id);
    });

    it('caps a long address and browser string', async () => {
      asRequest(designerSession, { 'x-forwarded-for': `${'1'.repeat(80)}, 10.0.0.1`, 'user-agent': 'u'.repeat(900) });
      expect((await invoke(renameRestaurant, { restaurantId: alpha, name: 'Alpha Two' })).ok).toBe(true);
      const row = await getPrisma().auditLog.findFirstOrThrow();
      expect([row.ip.length, row.userAgent.length]).toEqual([64, 512]);
    });

    it('refuses a request without a session', async () => {
      asRequest(null);
      expect(await invoke(renameRestaurant, { restaurantId: alpha, name: 'Alpha Two' })).toMatchObject({
        ok: false,
        error: { code: 'UNAUTHENTICATED' },
      });
      expect((await getPrisma().restaurant.findUniqueOrThrow({ where: { id: alpha } })).name).toBe('Alpha');
    });
  });

  describe('invokeQuery', () => {
    it('answers within the actor’s restaurants and hides the others', async () => {
      asRequest(designerSession);
      expect(await invokeQuery(restaurantName, { restaurantId: alpha })).toEqual({ ok: true, data: { name: 'Alpha' } });
      expect(await invokeQuery(restaurantName, { restaurantId: beta })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    });
  });

  describe('query (pages)', () => {
    it('returns the data', async () => {
      asRequest(designerSession);
      expect(await query(restaurantName, { restaurantId: alpha })).toEqual({ name: 'Alpha' });
    });

    it('sends a visitor without a session to sign in', async () => {
      asRequest(null);
      expect(await interruptOf(query(restaurantName, { restaurantId: alpha }))).toMatch(/^NEXT_REDIRECT;\w+;\/studio\/sign-in;/);
    });

    it('sends a Super Admin without two-factor to set it up', async () => {
      asRequest(adminSession);
      expect(await interruptOf(query(restaurantName, { restaurantId: alpha }))).toMatch(
        /^NEXT_REDIRECT;\w+;\/studio\/setup-two-factor;/,
      );
    });

    it('answers another restaurant, a missing one or a malformed id with the 404 page', async () => {
      asRequest(designerSession);
      expect(await interruptOf(query(restaurantName, { restaurantId: beta }))).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
      expect(await interruptOf(query(restaurantName, { restaurantId: 'missing' }))).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
      expect(await interruptOf(query(restaurantName, { restaurantId: '' }))).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
    });
  });

  describe('studioRoute', () => {
    const GET = studioRoute(restaurantName, { method: 'GET' });
    const POST = studioRoute(renameRestaurant, { method: 'POST' });
    const noParams = { params: Promise.resolve({}) };

    function get(path: string, session: Headers | null) {
      return GET(new Request(`${ORIGIN}${path}`, { headers: requestHeaders(session) }), noParams);
    }

    function post(body: string, session: Headers | null, extra: Record<string, string> = {}) {
      return POST(
        new Request(`${ORIGIN}/api/studio/rename`, {
          method: 'POST',
          body,
          headers: requestHeaders(session, { 'content-type': 'application/json', origin: ORIGIN, ...extra }),
        }),
        noParams,
      );
    }

    it('answers a query as JSON and is never cached', async () => {
      const res = await get(`/api/studio/name?restaurantId=${alpha}`, designerSession);
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await res.json()).toEqual({ data: { name: 'Alpha' } });
    });

    it('maps each refusal to its status', async () => {
      expect((await get(`/api/studio/name?restaurantId=${alpha}`, null)).status).toBe(401);
      expect((await get(`/api/studio/name?restaurantId=${alpha}`, adminSession)).status).toBe(403);
      const hidden = await get(`/api/studio/name?restaurantId=${beta}`, designerSession);
      expect(hidden.status).toBe(404);
      expect(await hidden.json()).toEqual({ error: { code: 'NOT_FOUND', message: expect.any(String) } });
      const invalid = await get('/api/studio/name', designerSession);
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toMatchObject({ error: { code: 'INVALID', fields: { restaurantId: expect.any(String) } } });
    });

    it('takes the route parameters as input', async () => {
      const res = await GET(new Request(`${ORIGIN}/api/studio/restaurants/x`, { headers: requestHeaders(designerSession) }), {
        params: Promise.resolve({ restaurantId: alpha }),
      });
      expect(await res.json()).toEqual({ data: { name: 'Alpha' } });
    });

    it('runs an action from a JSON body and audits it with the request’s address', async () => {
      const res = await post(JSON.stringify({ restaurantId: alpha, name: 'Alpha Three' }), designerSession, {
        'x-forwarded-for': '192.0.2.10',
        'user-agent': 'curl/8',
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ data: { name: 'Alpha Three' } });
      expect(await getPrisma().auditLog.findFirstOrThrow()).toMatchObject({ ip: '192.0.2.10', userAgent: 'curl/8' });
    });

    it('refuses a POST from another origin, and a body that is not a JSON object', async () => {
      const forged = await post(JSON.stringify({ restaurantId: alpha, name: 'Forged' }), designerSession, {
        origin: 'https://evil.example',
      });
      expect(forged.status).toBe(403);
      expect((await getPrisma().restaurant.findUniqueOrThrow({ where: { id: alpha } })).name).toBe('Alpha');

      expect((await post('not json', designerSession)).status).toBe(400);
      expect((await post('[1, 2]', designerSession)).status).toBe(400);
    });

    it('refuses to serve an action over GET or a request with the wrong method', async () => {
      expect(() => studioRoute(renameRestaurant, { method: 'GET' })).toThrow(/POST/);
      const res = await POST(new Request(`${ORIGIN}/api/studio/rename`, { headers: requestHeaders(designerSession) }), noParams);
      expect(res.status).toBe(405);
    });
  });
});
