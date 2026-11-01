import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { routeHost } from '@/server/http/hosts';
import { prisma, resetWorld, useTestDatabase } from '../pharmacy/fixture';
import { mac } from './contract-oracle';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

/*
 * What every Retails -> Studio call goes through (src/server/retail/inbound.ts): the signature, made with Retails' own
 * signer (the oracle's `mac`), is checked before anything else, the body is never parsed before it, and the link off
 * answers 503.
 */

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };
const CALLER = 'the-caller-secret-shared-with-retails';
const PREVIOUS = 'the-previous-caller-secret-of-retails';
const STUDIO = 'https://studio.example.test';

const ROUTES = {
  aiConfig: () => import('@/app/api/retail/v1/ai-config/route'),
  identities: () => import('@/app/api/retail/v1/identities/route'),
};

function enableRetail() {
  vi.stubEnv('RETAIL_URL', 'https://retail.test');
  vi.stubEnv('RETAIL_SYNC_SECRET', 'the-sync-secret-shared-with-retails');
  vi.stubEnv('RETAIL_CALLER_SECRET', CALLER);
  vi.stubEnv('RETAIL_CALLER_SECRET_PREVIOUS', '');
  vi.stubEnv('RETAIL_HANDOFF_SECRET', 'the-handoff-secret-shared-with-retails');
}

/** The headers Retails' `signRequest` makes: its `mac` over METHOD, pathname + raw query, unix seconds and the body. */
function signed(method: string, pathWithQuery: string, body: string, secret = CALLER, at = new Date()): Record<string, string> {
  const timestamp = String(Math.floor(at.getTime() / 1000));
  return { 'x-bz-timestamp': timestamp, 'x-bz-signature': mac(method, pathWithQuery, timestamp, body, secret), 'x-forwarded-for': '203.0.113.9' };
}

async function getAiConfig(pathWithQuery: string, headers: Record<string, string>) {
  const { GET } = await ROUTES.aiConfig();
  return GET(new Request(`${STUDIO}${pathWithQuery}`, { headers }));
}

async function postIdentity(body: string, headers: Record<string, string>) {
  const { POST } = await ROUTES.identities();
  return POST(new Request(`${STUDIO}/api/retail/v1/identities`, { method: 'POST', body, headers: { 'content-type': 'application/json', ...headers } }));
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
  vi.stubEnv('ANTHROPIC_API_KEY', '');
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.stubEnv('RETAIL_URL', '');
});

describe('signed calls from Retails', () => {
  it("a request signed by Retails' own signer (oracle) passes", async () => {
    const path = '/api/retail/v1/ai-config';
    const response = await getAiConfig(path, signed('GET', path, ''));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ apiKey: null, model: null });

    const body = JSON.stringify({ email: 'signed@rt-test.example' });
    const identity = await postIdentity(body, signed('POST', '/api/retail/v1/identities', body));
    expect(identity.status).toBe(200);
  });

  it('the previous secret is accepted during a rotation, an unknown one is not', async () => {
    vi.stubEnv('RETAIL_CALLER_SECRET_PREVIOUS', PREVIOUS);
    const path = '/api/retail/v1/ai-config';
    expect((await getAiConfig(path, signed('GET', path, '', PREVIOUS))).status).toBe(200);
    expect((await getAiConfig(path, signed('GET', path, '', 'a-secret-nobody-was-ever-given'))).status).toBe(401);
  });

  it('missing headers 401', async () => {
    const path = '/api/retail/v1/ai-config';
    const response = await getAiConfig(path, {});
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ code: 'UNAUTHORIZED' });
    const noSignature = signed('GET', path, '');
    delete (noSignature as Partial<typeof noSignature>)['x-bz-signature'];
    expect((await getAiConfig(path, noSignature)).status).toBe(401);
  });

  it('121 s old 401', async () => {
    const path = '/api/retail/v1/ai-config';
    expect((await getAiConfig(path, signed('GET', path, '', CALLER, new Date(Date.now() - 121_000)))).status).toBe(401);
    expect((await getAiConfig(path, signed('GET', path, '', CALLER, new Date(Date.now() + 121_000)))).status).toBe(401);
    expect((await getAiConfig(path, signed('GET', path, '', CALLER, new Date(Date.now() - 100_000)))).status).toBe(200);
  });

  it('tampered query 401', async () => {
    const headers = signed('GET', '/api/retail/v1/ai-config?a=1', '');
    expect((await getAiConfig('/api/retail/v1/ai-config?a=1', headers)).status).toBe(200);
    expect((await getAiConfig('/api/retail/v1/ai-config?a=2', headers)).status).toBe(401);
    expect((await getAiConfig('/api/retail/v1/ai-config', headers)).status).toBe(401);
  });

  it('tampered body or path 401', async () => {
    const body = JSON.stringify({ email: 'one@rt-test.example' });
    const headers = signed('POST', '/api/retail/v1/identities', body);
    expect((await postIdentity(JSON.stringify({ email: 'two@rt-test.example' }), headers)).status).toBe(401);
    const forAiConfig = signed('POST', '/api/retail/v1/ai-config', body);
    expect((await postIdentity(body, forAiConfig)).status).toBe(401);
    expect(await prisma().user.count()).toBe(0);
  });

  it('body is not parsed before the signature', async () => {
    const parse = vi.spyOn(JSON, 'parse');
    const response = await postIdentity('{not json', { ...signed('POST', '/api/retail/v1/identities', '{not json'), 'x-bz-signature': 'f'.repeat(64) });
    expect(response.status).toBe(401);
    expect(parse).not.toHaveBeenCalledWith('{not json');
    // The same malformed body, signed, is a 400: the parse comes after the signature.
    const good = await postIdentity('{not json', signed('POST', '/api/retail/v1/identities', '{not json'));
    expect(good.status).toBe(400);
    expect(await good.json()).toEqual({ code: 'INVALID_INPUT' });
  });

  it('a body over 16 KiB is refused unread', async () => {
    const body = JSON.stringify({ email: 'big@rt-test.example', name: 'x'.repeat(17 * 1024) });
    expect((await postIdentity(body, signed('POST', '/api/retail/v1/identities', body))).status).toBe(413);
  });

  it('a refused signature spends no rate-limit count', async () => {
    const path = '/api/retail/v1/ai-config';
    await getAiConfig(path, {});
    await getAiConfig(path, signed('GET', path, '', 'a-secret-nobody-was-ever-given'));
    expect(await prisma().authRateLimit.count()).toBe(0);
  });

  it('300 signed calls a minute per address, then 429', async () => {
    const path = '/api/retail/v1/ai-config';
    await prisma().authRateLimit.create({ data: { key: 'retail:ip:203.0.113.9', windowStart: new Date(), count: 299 } });
    expect((await getAiConfig(path, signed('GET', path, ''))).status).toBe(200);
    const response = await getAiConfig(path, signed('GET', path, ''));
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toMatch(/^\d+$/);
    expect(await response.json()).toEqual({ code: 'RATE_LIMITED' });
    // Another address is not held back.
    expect((await getAiConfig(path, { ...signed('GET', path, ''), 'x-forwarded-for': '203.0.113.10' })).status).toBe(200);
  });

  it('the link off answers 503 UNAVAILABLE, before anything else', async () => {
    vi.stubEnv('RETAIL_URL', '');
    const path = '/api/retail/v1/ai-config';
    const response = await getAiConfig(path, signed('GET', path, ''));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: 'UNAVAILABLE' });
    const body = JSON.stringify({ email: 'off@rt-test.example' });
    expect((await postIdentity(body, signed('POST', '/api/retail/v1/identities', body))).status).toBe(503);
  });

  it('a missing caller secret answers 503 UNAVAILABLE and names nothing', async () => {
    vi.stubEnv('RETAIL_CALLER_SECRET', '');
    const path = '/api/retail/v1/ai-config';
    const response = await getAiConfig(path, signed('GET', path, ''));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: 'UNAVAILABLE' });
  });
});

describe('host routing', () => {
  const cfg = { publicHost: 'menu.buzzify.me', studioHost: 'studio.buzzify.me', rootRedirect: 'https://buzzify.me', production: true };
  it('/api/retail/v1/* is served on the Studio host and 404 on the menu host', () => {
    for (const pathname of ['/api/retail/v1/ai-config', '/api/retail/v1/identities', '/api/retail/v1/handoff']) {
      expect(routeHost({ host: 'studio.buzzify.me', pathname }, cfg), pathname).toEqual({ action: 'next' });
      expect(routeHost({ host: 'menu.buzzify.me', pathname }, cfg), pathname).toEqual({ action: 'notFound' });
    }
  });
});
