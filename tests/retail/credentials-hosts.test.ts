import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { authFor, serverAuthFor } from '@/server/studio/auth/auth';
import { cookieHeader, totpFromUri } from '../helpers/auth';
import { GOOD, prisma, resetWorld, useTestDatabase } from '../pharmacy/fixture';
import { handoffNonce, mac, verifyHandoff } from './contract-oracle';
import { retailShop } from './world';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

/**
 * Retails' own sign-in form on a Studio that answers on several hosts (the pharmacy and super admin hosts beside the
 * Studio's, so Better Auth's base URL depends on the request's host): `serverAuthFor` is called with no request host
 * at all, falls back to the Studio origin, and the two-factor challenge cookie it names is the one Better Auth sets.
 * A file of its own: the sign-in configuration is read once per process, and this one is production's.
 */

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };
const CALLER = 'the-caller-secret-shared-with-retails';
const HANDOFF_SECRET = 'the-handoff-secret-shared-with-retails';
const STUDIO = 'https://studio.example.test';
const fresh = () => handoffNonce(randomBytes(32).toString('base64url'));

function enable() {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('BETTER_AUTH_URL', STUDIO);
  vi.stubEnv('BETTER_AUTH_SECRET', 'a-private-test-only-secret-of-forty-chars!');
  vi.stubEnv('PHARMACY_HOST', 'leaf.example.test');
  vi.stubEnv('CORE_HOST', 'core.example.test');
  vi.stubEnv('RETAIL_URL', 'https://retail.test');
  vi.stubEnv('RETAIL_SYNC_SECRET', 'the-sync-secret-shared-with-retails');
  vi.stubEnv('RETAIL_CALLER_SECRET', CALLER);
  vi.stubEnv('RETAIL_CALLER_SECRET_PREVIOUS', '');
  vi.stubEnv('RETAIL_HANDOFF_SECRET', HANDOFF_SECRET);
}

async function send(path: string, payload: unknown): Promise<Response> {
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const headers = { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.7', 'x-bz-timestamp': timestamp, 'x-bz-signature': mac('POST', path, timestamp, body, CALLER) };
  const handler =
    path === '/api/retail/v1/credentials'
      ? (await import('@/app/api/retail/v1/credentials/route')).POST
      : (await import('@/app/api/retail/v1/credentials/two-factor/route')).POST;
  return handler(new Request(`${STUDIO}${path}`, { method: 'POST', body, headers }));
}

beforeAll(() => useTestDatabase());
afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});
beforeEach(async () => {
  await resetWorld();
  enable();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe('the sign-in form on a Studio with several hosts', () => {
  it('runs on the host-dependent base URL: the password, the code, and a token for the shop', async () => {
    expect(typeof (await serverAuthFor(prisma()).$context).baseURL).toBe('string');
    const shop = await retailShop('Hosts Shop');
    await prisma().retailLink.update({ where: { restaurantId: shop.id }, data: { retailBusinessId: `rt-${shop.id}` } });

    // Two-factor on, as the Studio's account page does it.
    const auth = authFor(prisma());
    const signedIn = await auth.api.signInEmail({ body: { email: shop.owner!.email, password: GOOD }, returnHeaders: true });
    const session = cookieHeader(signedIn.headers.getSetCookie());
    const enabled = await auth.api.enableTwoFactor({ body: { password: GOOD }, headers: session });
    if (enabled.method !== 'totp') throw new Error('unexpected two-factor method');
    await auth.api.verifyTOTP({ body: { code: totpFromUri(enabled.totpURI) }, headers: session });
    await prisma().session.deleteMany({ where: { userId: shop.owner!.userId } });

    const first = await (await send('/api/retail/v1/credentials', { email: shop.owner!.email, password: GOOD, clientIp: '203.0.113.44', nonce: fresh() })).json();
    expect(first.status).toBe('needs_2fa');
    const nonce = fresh();
    const right = await send('/api/retail/v1/credentials/two-factor', { challenge: first.challenge, code: totpFromUri(enabled.totpURI), clientIp: '203.0.113.44', nonce });
    expect(right.status).toBe(200);
    expect(right.headers.getSetCookie()).toEqual([]);
    const answer = await right.json();
    expect(answer.status).toBe('ok');
    const verdict = verifyHandoff(answer.handoffToken, [HANDOFF_SECRET]);
    expect(verdict.ok && verdict.claims).toMatchObject({ coreUserId: shop.owner!.userId, coreBusinessId: shop.id, nonce });
    expect(await prisma().session.count({ where: { userId: shop.owner!.userId } })).toBe(0);
  });
});
