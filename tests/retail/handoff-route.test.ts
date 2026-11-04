import { cookies, headers as nextHeaders } from 'next/headers';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { HANDOFF_TTL_SECONDS, HOP_COOKIE, issueHandoff, PICK_COOKIE, RESUME_COOKIE } from '@/server/retail/handoff';
import { loadActor } from '@/server/studio/auth/actor';
import { authFor } from '@/server/studio/auth/auth';
import { cookieHeader, cookieStore } from '../helpers/auth';
import { GOOD, person, prisma, resetWorld, useTestDatabase, type Person } from '../pharmacy/fixture';
import { handoffNonce, verifyHandoff } from './contract-oracle';
import { retailShop } from './world';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

/**
 * The sign-in handoff to Retails, through its three Route Handlers: `/api/retail/v1/handoff` (Retails sends the browser
 * here with return, state and nonce), `/studio/retail/continue` (back from sign-in) and `/studio/retail/open/[id]` (the
 * owner's "Open Retails"). Every token is judged by Retails' own verifyHandoff (the oracle).
 */

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };
const HANDOFF_SECRET = 'the-handoff-secret-shared-with-retails';
const RETAIL = 'https://retail.test';
const CALLBACK = `${RETAIL}/api/core/v1/handoff/callback`;
const STUDIO = 'https://studio.example.test';
const IP = '203.0.113.21';
const STATE = 'c3RhdGUtZnJvbS1yZXRhaWxzLXJhbmRvbS0zMi1ieXRlcw';
const NONCE = handoffNonce(STATE);
/** The three Retail products' own addresses (as planned: supermarket., electronics., clothing.buzzify.tech). */
const SUPERMARKET = 'https://supermarket.retail.test';
const ELECTRONICS = 'https://electronics.retail.test';
const CLOTHING = 'https://clothing.retail.test';
const PRODUCT_VARIABLES = ['RETAIL_URL_SUPERMARKET', 'RETAIL_URL_ELECTRONICS', 'RETAIL_URL_CLOTHING'] as const;
const callbackAt = (origin: string) => `${origin}/api/core/v1/handoff/callback`;

function enableRetail() {
  vi.stubEnv('RETAIL_URL', RETAIL);
  vi.stubEnv('RETAIL_SYNC_SECRET', 'the-sync-secret-shared-with-retails');
  vi.stubEnv('RETAIL_CALLER_SECRET', 'the-caller-secret-shared-with-retails');
  vi.stubEnv('RETAIL_CALLER_SECRET_PREVIOUS', '');
  vi.stubEnv('RETAIL_HANDOFF_SECRET', HANDOFF_SECRET);
}

let logged: string[] = [];
function silence() {
  logged = [];
  for (const level of ['info', 'warn', 'error', 'log', 'debug'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    });
  }
}

/** A browser: its cookies across calls. */
type Jar = Map<string, string>;
const cookieOf = (jar: Jar) => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');

async function signIn(who: Person, jar: Jar = new Map()): Promise<Jar> {
  const res = await authFor(prisma()).api.signInEmail({ body: { email: who.email, password: GOOD }, returnHeaders: true });
  cookieHeader(res.headers.getSetCookie(), jar);
  return jar;
}

async function call(path: string, jar: Jar = new Map(), ip = IP): Promise<Response> {
  const url = new URL(path, STUDIO);
  const headers = new Headers({ 'x-forwarded-for': ip });
  const cookie = cookieOf(jar);
  if (cookie) headers.set('cookie', cookie);
  // Better Auth's Next plugin reads the request through next/headers, as a Route Handler gives it.
  vi.mocked(nextHeaders).mockResolvedValue(headers as never);
  vi.mocked(cookies).mockResolvedValue(cookieStore(headers.get('cookie')) as never);
  const request = new Request(url, { headers });
  let response: Response;
  if (url.pathname === '/api/retail/v1/handoff') {
    response = await (await import('@/app/api/retail/v1/handoff/route')).GET(request);
  } else if (url.pathname === '/studio/retail/continue') {
    response = await (await import('@/app/studio/retail/continue/route')).GET(request);
  } else if (url.pathname.startsWith('/studio/retail/open/')) {
    const restaurantId = decodeURIComponent(url.pathname.slice('/studio/retail/open/'.length));
    response = await (await import('@/app/studio/retail/open/[restaurantId]/route')).GET(request, { params: Promise.resolve({ restaurantId }) });
  } else {
    throw new Error(`no route for ${url.pathname}`);
  }
  cookieHeader(response.headers.getSetCookie(), jar);
  return response;
}

const handoffPath = (over: { return?: string | null; state?: string | null; nonce?: string | null } = {}) => {
  const q = new URLSearchParams();
  const ret = over.return === undefined ? CALLBACK : over.return;
  const state = over.state === undefined ? STATE : over.state;
  const nonce = over.nonce === undefined ? NONCE : over.nonce;
  if (ret !== null) q.set('return', ret);
  if (state !== null) q.set('state', state);
  if (nonce !== null) q.set('nonce', nonce);
  return `/api/retail/v1/handoff?${q}`;
};

/** The token a 302 to the callback carries, checked by Retails' verifyHandoff. */
function tokenFrom(response: Response) {
  expect(response.status).toBe(302);
  const location = response.headers.get('location') ?? '';
  expect(location.startsWith(`${CALLBACK}?`)).toBe(true);
  const target = new URL(location);
  expect([...target.searchParams.keys()].sort()).toEqual(['state', 'token']);
  expect(target.searchParams.get('state')).toBe(STATE);
  const token = target.searchParams.get('token')!;
  const verdict = verifyHandoff(token, [HANDOFF_SECRET]);
  if (!verdict.ok) throw new Error(`oracle refused: ${verdict.reason}`);
  return { token, claims: verdict.claims };
}

/** Whether the answer carries no token anywhere: not in a Location, not in the body. */
async function noToken(response: Response) {
  const location = response.headers.get('location') ?? '';
  expect(location).not.toContain('token=');
  expect(location.startsWith(RETAIL)).toBe(false);
  expect(await response.clone().text()).not.toMatch(/token=|[A-Za-z0-9_-]{40,}\.[A-Za-z0-9_-]{43}/);
}

const provision = (restaurantId: string) =>
  prisma().retailLink.update({ where: { restaurantId }, data: { retailBusinessId: `rt-${restaurantId}` } });

function setCookieLine(response: Response, name: string): string | undefined {
  return response.headers.getSetCookie().find((line) => line.startsWith(`${name}=`));
}

beforeAll(() => useTestDatabase());
afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});
beforeEach(async () => {
  await resetWorld();
  enableRetail();
  silence();
});
afterEach(() => {
  vi.restoreAllMocks();
  // Not unstubAllEnvs: it would also drop the test database's DATABASE_URL.
  vi.stubEnv('RETAIL_URL', '');
  for (const name of PRODUCT_VARIABLES) vi.stubEnv(name, '');
  vi.stubEnv('NODE_ENV', 'test');
});

describe('GET /api/retail/v1/handoff', () => {
  it('signed-in owner of one provisioned shop is redirected to the callback with a valid token', async () => {
    const shop = await retailShop('Corner Shop');
    await provision(shop.id);
    const jar = await signIn(shop.owner!);
    const before = Math.floor(Date.now() / 1000);

    const response = await call(handoffPath(), jar);
    const { token, claims } = tokenFrom(response);
    expect(claims).toMatchObject({
      aud: 'retail',
      nonce: NONCE,
      coreUserId: shop.owner!.userId,
      email: shop.owner!.email,
      emailVerified: true,
      name: 'corner-shop-owner person',
      coreBusinessId: shop.id,
    });
    expect(claims.exp - claims.iat).toBe(HANDOFF_TTL_SECONDS);
    expect(claims.iat).toBeGreaterThanOrEqual(before);
    expect(claims.jti).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    // Both cookies are cleared on the answer that carries the token.
    for (const name of [RESUME_COOKIE, PICK_COOKIE]) expect(setCookieLine(response, name)).toMatch(/Max-Age=0/);

    // A fresh jti every time.
    const again = tokenFrom(await call(handoffPath(), jar));
    expect(again.claims.jti).not.toBe(claims.jti);
    // Nothing logged the token.
    expect(logged.join('\n')).not.toContain(token);
  });

  it('nonce is copied byte for byte from the query', async () => {
    const shop = await retailShop('Nonce Shop');
    await provision(shop.id);
    const jar = await signIn(shop.owner!);
    const state = 'another_state-of-Retails_0123456789abcdefghij';
    const response = await call(handoffPath({ state, nonce: handoffNonce(state) }), jar);
    const target = new URL(response.headers.get('location')!);
    const verdict = verifyHandoff(target.searchParams.get('token')!, [HANDOFF_SECRET]);
    expect(verdict.ok && verdict.claims.nonce).toBe(handoffNonce(state));
    expect(target.searchParams.get('state')).toBe(state);
  });

  it('no session parks the request and resumes after sign-in', async () => {
    const shop = await retailShop('Parked Shop');
    await provision(shop.id);
    const jar: Jar = new Map();

    const parked = await call(handoffPath(), jar);
    expect(parked.status).toBe(302);
    const signInUrl = new URL(parked.headers.get('location')!, STUDIO);
    expect(signInUrl.origin).toBe(STUDIO);
    expect(signInUrl.pathname).toBe('/studio/sign-in');
    expect(signInUrl.searchParams.get('next')).toBe('/studio/retail/continue');
    await noToken(parked);
    const resume = setCookieLine(parked, RESUME_COOKIE)!;
    expect(resume).toMatch(/HttpOnly/);
    expect(resume).toMatch(/SameSite=Lax/);
    expect(resume).toMatch(/Path=\//);
    expect(resume).toMatch(/Max-Age=600/);
    expect(resume).not.toMatch(/Secure/);

    await signIn(shop.owner!, jar);
    const resumed = await call('/studio/retail/continue', jar);
    expect(resumed.status).toBe(302);
    const back = new URL(resumed.headers.get('location')!, STUDIO);
    expect(back.origin).toBe(STUDIO);
    expect(back.pathname).toBe('/api/retail/v1/handoff');
    expect(back.searchParams.get('return')).toBe(CALLBACK);
    expect(back.searchParams.get('state')).toBe(STATE);
    expect(back.searchParams.get('nonce')).toBe(NONCE);
    await noToken(resumed);

    const done = await call(back.pathname + back.search, jar);
    expect(tokenFrom(done).claims.coreBusinessId).toBe(shop.id);
    expect(jar.has(RESUME_COOKIE)).toBe(false);
  });

  it('the resume cookie is Secure in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const parked = await call(handoffPath());
    expect(setCookieLine(parked, RESUME_COOKIE)).toMatch(/; Secure/);
  });

  it('owner of two shops goes to the chooser, the pick cookie selects', async () => {
    const a = await retailShop('Shop A');
    const b = await retailShop('Shop B', { owner: false });
    await prisma().membership.create({ data: { userId: a.owner!.userId, restaurantId: b.id, role: 'OWNER' } });
    await provision(a.id);
    await provision(b.id);
    const jar = await signIn(a.owner!);

    const choose = await call(handoffPath(), jar);
    expect(choose.status).toBe(302);
    expect(choose.headers.get('location')).toBe('/studio/retail/choose');
    await noToken(choose);
    expect(jar.has(RESUME_COOKIE)).toBe(true);

    const picked = await call(`/studio/retail/open/${b.id}`, jar);
    expect(picked.status).toBe(302);
    expect(picked.headers.get('location')).toBe('/studio/retail/continue');
    const pick = setCookieLine(picked, PICK_COOKIE)!;
    expect(pick).toMatch(/HttpOnly/);
    expect(pick).toMatch(/SameSite=Lax/);
    expect(pick).toMatch(/Max-Age=600/);

    const resumed = await call('/studio/retail/continue', jar);
    const back = new URL(resumed.headers.get('location')!, STUDIO);
    const done = await call(back.pathname + back.search, jar);
    expect(tokenFrom(done).claims.coreBusinessId).toBe(b.id);
    expect(jar.has(PICK_COOKIE)).toBe(false);
    expect(jar.has(RESUME_COOKIE)).toBe(false);
  });

  it("a pick cookie for someone else's shop is ignored", async () => {
    const mine = await retailShop('Mine');
    const theirs = await retailShop('Theirs');
    await provision(mine.id);
    await provision(theirs.id);
    const jar = await signIn(mine.owner!);
    jar.set(PICK_COOKIE, theirs.id);
    expect(tokenFrom(await call(handoffPath(), jar)).claims.coreBusinessId).toBe(mine.id);

    // A DESIGNER of a retail shop does not own it: a pick for it is ignored too.
    await prisma().membership.create({ data: { userId: mine.owner!.userId, restaurantId: theirs.id, role: 'DESIGNER' } });
    jar.set(PICK_COOKIE, theirs.id);
    expect(tokenFrom(await call(handoffPath(), jar)).claims.coreBusinessId).toBe(mine.id);
  });

  it('a pick cookie for a non-retail shop the actor owns is ignored', async () => {
    const shop = await retailShop('Retail One');
    await provision(shop.id);
    const food = await prisma().restaurant.create({ data: { name: 'Food', sector: 'FOOD' } });
    await prisma().membership.create({ data: { userId: shop.owner!.userId, restaurantId: food.id, role: 'OWNER' } });
    const jar = await signIn(shop.owner!);
    jar.set(PICK_COOKIE, food.id);
    expect(tokenFrom(await call(handoffPath(), jar)).claims.coreBusinessId).toBe(shop.id);
  });

  it('not provisioned shows the preparing page', async () => {
    const shop = await retailShop('Fresh Shop');
    const jar = await signIn(shop.owner!);
    const response = await call(handoffPath(), jar);
    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('content-type')).toMatch(/text\/html/);
    await noToken(response);
    expect(await response.text()).toContain('Your shop is being prepared');
    for (const name of [RESUME_COOKIE, PICK_COOKIE]) expect(setCookieLine(response, name)).toMatch(/Max-Age=0/);
  });

  it('its pages lead back to Buzzify Retail and never name the Studio', async () => {
    const shop = await retailShop('Quiet Shop');
    const html = await (await call(handoffPath(), await signIn(shop.owner!))).text();
    expect(html).toContain(`href="${RETAIL}"`);
    expect(html).not.toContain('href="/studio');
    expect(html).not.toMatch(/studio|core/i);
  });

  it('a signed-in person with no retail shop of their own gets a staff token without a business', async () => {
    const shop = await retailShop('Staffed Shop');
    await provision(shop.id);
    const designer = await person('designer', { membership: [shop.id, 'DESIGNER'] });
    const nobody = await person('nobody');
    for (const who of [designer, nobody]) {
      const { claims } = tokenFrom(await call(handoffPath(), await signIn(who)));
      expect(claims.coreUserId).toBe(who.userId);
      expect(claims.emailVerified).toBe(true);
      expect('coreBusinessId' in claims).toBe(false);
    }
  });

  it('an identity-only account that set its password gets a staff token', async () => {
    const who = await person('identity');
    await prisma().user.update({ where: { id: who.userId }, data: { identityOnly: true } });
    const { claims } = tokenFrom(await call(handoffPath(), await signIn(who)));
    expect(claims.coreUserId).toBe(who.userId);
    expect('coreBusinessId' in claims).toBe(false);
  });

  it('deactivated user gets no token', async () => {
    const shop = await retailShop('Gone Shop');
    await provision(shop.id);
    const jar = await signIn(shop.owner!);
    await prisma().user.update({ where: { id: shop.owner!.userId }, data: { deactivatedAt: new Date() } });
    const response = await call(handoffPath(), jar);
    await noToken(response);
  });

  it('emailVerified false is never sent: an unverified person gets a page and no token, read from the database at issue time', async () => {
    const shop = await retailShop('Unverified Shop');
    await provision(shop.id);
    const jar = await signIn(shop.owner!);
    // After sign-in, so the session's own copy of the user still says verified.
    await prisma().user.update({ where: { id: shop.owner!.userId }, data: { emailVerified: false } });
    const response = await call(handoffPath(), jar);
    expect(response.status).toBe(403);
    expect(response.headers.get('location')).toBeNull();
    await noToken(response);
  });

  it('issueHandoff refuses a person deactivated or unverified between the session check and the token', async () => {
    const shop = await retailShop('Race Shop');
    await provision(shop.id);
    const actor = (await loadActor(prisma(), shop.owner!.userId))!;
    expect(await issueHandoff(prisma(), actor, shop.id, NONCE, new Date())).toEqual(expect.any(String));
    await prisma().user.update({ where: { id: actor.userId }, data: { emailVerified: false } });
    expect(await issueHandoff(prisma(), actor, shop.id, NONCE, new Date())).toBeNull();
    await prisma().user.update({ where: { id: actor.userId }, data: { emailVerified: true, deactivatedAt: new Date() } });
    expect(await issueHandoff(prisma(), actor, null, NONCE, new Date())).toBeNull();
  });

  it('bad return is 400 and not a redirect, signed in or not', async () => {
    const shop = await retailShop('Return Shop');
    await provision(shop.id);
    const signed = await signIn(shop.owner!);
    for (const jar of [signed, new Map<string, string>()]) {
      for (const ret of [null, 'https://evil.test/api/core/v1/handoff/callback', `${CALLBACK}?x=1`, `${CALLBACK}/`, '//evil.test/x', 'https://retail.test@evil.test/api/core/v1/handoff/callback']) {
        const response = await call(handoffPath({ return: ret }), new Map(jar));
        expect(response.status).toBe(400);
        expect(response.headers.get('location')).toBeNull();
        expect(setCookieLine(response, RESUME_COOKIE)).toBeUndefined();
        await noToken(response);
      }
    }
  });

  it('oversized state is 400', async () => {
    const shop = await retailShop('State Shop');
    await provision(shop.id);
    const jar = await signIn(shop.owner!);
    const state = 'a'.repeat(257);
    for (const path of [
      handoffPath({ state, nonce: handoffNonce(state) }),
      handoffPath({ state: null }),
      handoffPath({ nonce: null }),
      handoffPath({ nonce: handoffNonce('something else entirely') }),
      handoffPath({ state: 'short', nonce: handoffNonce('short') }),
    ]) {
      const response = await call(path, jar);
      expect(response.status).toBe(400);
      expect(response.headers.get('location')).toBeNull();
    }
  });

  it('rate limited is 429', async () => {
    await prisma().authRateLimit.create({ data: { key: `retail-handoff:ip:${IP}`, windowStart: new Date(), count: 300 } });
    const response = await call(handoffPath());
    expect(response.status).toBe(429);
    expect(response.headers.get('location')).toBeNull();
    expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
    // Another address is not limited.
    expect((await call(handoffPath(), new Map(), '198.51.100.7')).status).toBe(302);
  });

  it('link disabled is 404 on every handoff route', async () => {
    const shop = await retailShop('Off Shop');
    await provision(shop.id);
    const jar = await signIn(shop.owner!);
    vi.stubEnv('RETAIL_URL', '');
    for (const path of [handoffPath(), '/studio/retail/continue', `/studio/retail/open/${shop.id}`]) {
      const response = await call(path, jar);
      expect(response.status).toBe(404);
      expect(response.headers.get('location')).toBeNull();
    }
  });

  it('a misconfigured link answers 503 and never redirects', async () => {
    vi.stubEnv('RETAIL_HANDOFF_SECRET', 'short');
    const shop = await retailShop('Broken Shop');
    await provision(shop.id);
    const response = await call(handoffPath(), await signIn(shop.owner!));
    expect(response.status).toBe(503);
    expect(response.headers.get('location')).toBeNull();
  });
});

describe('GET /studio/retail/continue', () => {
  it('a missing or tampered resume cookie is 400 and not a redirect', async () => {
    const shop = await retailShop('Tamper Shop');
    await provision(shop.id);
    const signed = await signIn(shop.owner!);
    const b64 = (v: unknown) => Buffer.from(JSON.stringify(v), 'utf8').toString('base64url');
    for (const value of [
      undefined,
      'not-base64-json',
      b64({ state: STATE }),
      b64({ state: 'short', nonce: handoffNonce('short') }),
      b64({ state: STATE, nonce: handoffNonce('other state value here') }),
      b64({ state: STATE, nonce: `${NONCE}&return=https://evil.test` }),
      b64(['x']),
    ]) {
      const jar = new Map(signed);
      if (value !== undefined) jar.set(RESUME_COOKIE, value);
      const response = await call('/studio/retail/continue', jar);
      expect(response.status).toBe(400);
      expect(response.headers.get('location')).toBeNull();
      expect(setCookieLine(response, RESUME_COOKIE)).toMatch(/Max-Age=0/);
    }
  });
});

describe('GET /studio/retail/open/[restaurantId]', () => {
  it('sends an owner to Retails to start a handoff, with the pick cookie', async () => {
    const shop = await retailShop('Open Shop');
    const jar = await signIn(shop.owner!);
    const response = await call(`/studio/retail/open/${shop.id}`, jar);
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(`${RETAIL}/api/core/v1/handoff/start`);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(setCookieLine(response, PICK_COOKIE)).toBe(`${PICK_COOKIE}=${shop.id}; Path=/; Max-Age=600; HttpOnly; SameSite=Lax`);
  });

  it('is 404 for anyone but an owner of that retail shop', async () => {
    const shop = await retailShop('Closed Shop');
    const other = await retailShop('Other Shop');
    const designer = await person('designer', { membership: [shop.id, 'DESIGNER'] });
    const admin = await person('admin', { superAdmin: true });
    await prisma().user.update({ where: { id: admin.userId }, data: { twoFactorEnabled: false } });
    const food = await prisma().restaurant.create({ data: { name: 'Food Place', sector: 'FOOD' } });
    await prisma().membership.create({ data: { userId: shop.owner!.userId, restaurantId: food.id, role: 'OWNER' } });

    const cases: Array<[Jar, string]> = [
      [new Map(), shop.id],
      [await signIn(other.owner!), shop.id],
      [await signIn(designer), shop.id],
      [await signIn(admin), shop.id],
      [await signIn(shop.owner!), food.id],
      [await signIn(shop.owner!), 'no-such-shop'],
    ];
    for (const [jar, id] of cases) {
      const response = await call(`/studio/retail/open/${encodeURIComponent(id)}`, jar);
      expect(response.status).toBe(404);
      expect(response.headers.get('location')).toBeNull();
      expect(setCookieLine(response, PICK_COOKIE)).toBeUndefined();
    }
  });
});

describe('the three Retail product addresses', () => {
  function enableProducts() {
    vi.stubEnv('RETAIL_URL_SUPERMARKET', SUPERMARKET);
    vi.stubEnv('RETAIL_URL_ELECTRONICS', ELECTRONICS);
    vi.stubEnv('RETAIL_URL_CLOTHING', CLOTHING);
  }
  const productShop = async (name: string, activity: 'SUPERMARKET' | 'ELECTRONICS' | 'CLOTHING') => {
    const shop = await retailShop(name);
    await prisma().retailLink.update({ where: { restaurantId: shop.id }, data: { activity, retailBusinessId: `rt-${shop.id}` } });
    return shop;
  };
  /** The token of a 302 to `callback`, judged by Retails' oracle. */
  function tokenAt(response: Response, callback: string) {
    expect(response.status).toBe(302);
    const target = new URL(response.headers.get('location') ?? '');
    expect(`${target.origin}${target.pathname}`).toBe(callback);
    const verdict = verifyHandoff(target.searchParams.get('token')!, [HANDOFF_SECRET]);
    if (!verdict.ok) throw new Error(`oracle refused: ${verdict.reason}`);
    return verdict.claims;
  }

  it('accepts a return on exactly RETAIL_URL and each product address, and nothing else', async () => {
    enableProducts();
    const staff = await person('staff-only');
    const jar = await signIn(staff);
    for (const origin of [RETAIL, SUPERMARKET, ELECTRONICS, CLOTHING]) {
      expect(tokenAt(await call(handoffPath({ return: callbackAt(origin) }), jar), callbackAt(origin)).coreBusinessId ?? null).toBeNull();
    }
    for (const bad of [
      callbackAt('https://evil.test'),
      callbackAt('https://electronics.retail.test.evil.test'),
      callbackAt('http://electronics.retail.test'),
      callbackAt('https://ELECTRONICS.retail.test'),
      callbackAt('https://electronics.retail.test:8443'),
      `${ELECTRONICS}/api/core/v1/handoff/callback/`,
      `${ELECTRONICS}/api/core/v1/handoff/callback?x=1`,
      `${ELECTRONICS}/other`,
      callbackAt('https://pharmacy.retail.test'),
    ]) {
      const response = await call(handoffPath({ return: bad }), jar);
      expect(response.status, bad).toBe(400);
      expect(response.headers.get('location'), bad).toBeNull();
    }
  });

  it('accepts a product address only once it is configured', async () => {
    const staff = await person('staff-only');
    const jar = await signIn(staff);
    expect((await call(handoffPath({ return: callbackAt(ELECTRONICS) }), jar)).status).toBe(400);
    vi.stubEnv('RETAIL_URL_ELECTRONICS', ELECTRONICS);
    expect((await call(handoffPath({ return: callbackAt(ELECTRONICS) }), jar)).status).toBe(302);
  });

  it("signs an owner in at their shop's own product address", async () => {
    enableProducts();
    const shop = await productShop('Volt Gadgets', 'ELECTRONICS');
    const jar = await signIn(shop.owner!);
    const claims = tokenAt(await call(handoffPath({ return: callbackAt(ELECTRONICS) }), jar), callbackAt(ELECTRONICS));
    expect(claims.coreBusinessId).toBe(shop.id);
  });

  it('sends an owner who came back to another address to start again at their product, with the shop picked, once', async () => {
    enableProducts();
    const shop = await productShop('Thread Clothing', 'CLOTHING');
    const jar = await signIn(shop.owner!);

    const hop = await call(handoffPath({ return: callbackAt(RETAIL) }), jar);
    expect(hop.status).toBe(302);
    expect(hop.headers.get('location')).toBe(`${CLOTHING}/api/core/v1/handoff/start`);
    await noToken(hop);
    expect(setCookieLine(hop, PICK_COOKIE)).toBe(`${PICK_COOKIE}=${shop.id}; Path=/; Max-Age=600; HttpOnly; SameSite=Lax`);
    expect(setCookieLine(hop, HOP_COOKIE)).toBe(`${HOP_COOKIE}=${shop.id}; Path=/; Max-Age=600; HttpOnly; SameSite=Lax`);

    // Retails at the product address starts again: the token goes there, and every cookie is cleared.
    const done = await call(handoffPath({ return: callbackAt(CLOTHING) }), jar);
    expect(tokenAt(done, callbackAt(CLOTHING)).coreBusinessId).toBe(shop.id);
    for (const name of [RESUME_COOKIE, PICK_COOKIE, HOP_COOKIE]) expect(setCookieLine(done, name)).toMatch(/Max-Age=0/);

    // A Retails that names one return for all its addresses: one bounce, then the token goes to the return it named.
    const again = await call(handoffPath({ return: callbackAt(SUPERMARKET) }), jar);
    expect(again.headers.get('location')).toBe(`${CLOTHING}/api/core/v1/handoff/start`);
    const named = await call(handoffPath({ return: callbackAt(SUPERMARKET) }), jar);
    expect(tokenAt(named, callbackAt(SUPERMARKET)).coreBusinessId).toBe(shop.id);
  });

  it('keeps a supermarket (every shop from before) at RETAIL_URL while its product has no address of its own', async () => {
    vi.stubEnv('RETAIL_URL_ELECTRONICS', ELECTRONICS);
    const shop = await productShop('Corner Market', 'SUPERMARKET');
    const jar = await signIn(shop.owner!);
    expect(tokenAt(await call(handoffPath(), jar), CALLBACK).coreBusinessId).toBe(shop.id);
    const open = await call(`/studio/retail/open/${shop.id}`, new Map(jar));
    expect(open.headers.get('location')).toBe(`${RETAIL}/api/core/v1/handoff/start`);
  });

  it("opens Retails at the shop's own product address", async () => {
    enableProducts();
    for (const [activity, origin] of [['SUPERMARKET', SUPERMARKET], ['ELECTRONICS', ELECTRONICS], ['CLOTHING', CLOTHING]] as const) {
      const shop = await productShop(`Open ${activity}`, activity);
      const response = await call(`/studio/retail/open/${shop.id}`, await signIn(shop.owner!));
      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe(`${origin}/api/core/v1/handoff/start`);
    }
  });

  it('resumes a parked handoff at the address it came back to', async () => {
    enableProducts();
    const shop = await productShop('Parked Volt', 'ELECTRONICS');
    const jar: Jar = new Map();
    const parked = await call(handoffPath({ return: callbackAt(ELECTRONICS) }), jar);
    expect(parked.status).toBe(302);
    await signIn(shop.owner!, jar);
    const resumed = await call('/studio/retail/continue', jar);
    const back = new URL(resumed.headers.get('location')!, STUDIO);
    expect(back.searchParams.get('return')).toBe(callbackAt(ELECTRONICS));
    expect(tokenAt(await call(back.pathname + back.search, jar), callbackAt(ELECTRONICS)).coreBusinessId).toBe(shop.id);
  });

  it('answers 503 for a misconfigured product address and never redirects', async () => {
    vi.stubEnv('RETAIL_URL_CLOTHING', 'https://clothing.retail.test/path');
    const response = await call(handoffPath());
    expect(response.status).toBe(503);
    expect(response.headers.get('location')).toBeNull();
  });
});
