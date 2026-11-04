import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { REQUEST_PATH_HEADER } from '@/server/http/request-path';
import { config, proxy } from '@/proxy';

/** The request headers the proxy hands on to the page, as Next encodes them on the proxy's response. */
function forwarded(response: Response): Record<string, string | null> {
  const names = (response.headers.get('x-middleware-override-headers') ?? '').split(',').filter(Boolean);
  return Object.fromEntries(names.map((name) => [name, response.headers.get(`x-middleware-request-${name}`)]));
}

describe('proxy', () => {
  it('hands the requested path on to the page, for the 404 page’s link back', () => {
    const response = proxy(new NextRequest('http://127.0.0.1:3100/atelier/en/p/does-not-exist?x=1'));
    expect(forwarded(response)[REQUEST_PATH_HEADER]).toBe('/atelier/en/p/does-not-exist');
  });

  it('replaces a path header the browser sent', () => {
    const response = proxy(
      new NextRequest('http://127.0.0.1:3100/atelier/en', { headers: { [REQUEST_PATH_HEADER]: '/other-menu/en' } }),
    );
    expect(forwarded(response)[REQUEST_PATH_HEADER]).toBe('/atelier/en');
  });

  it('keeps the request’s other headers', () => {
    const response = proxy(new NextRequest('http://127.0.0.1:3100/atelier/en', { headers: { 'accept-language': 'ar' } }));
    expect(forwarded(response)['accept-language']).toBe('ar');
  });
});

describe('proxy in production with both hosts configured', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  /** The proxy as a production deployment loads it: the host configuration is read once, from these variables. */
  async function productionProxy() {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('PUBLIC_MENU_HOST', 'menu.buzzify.me');
    vi.stubEnv('STUDIO_HOST', 'studio.buzzify.me');
    vi.resetModules();
    return (await import('@/proxy')).proxy;
  }

  it('answers 404 on the deployment’s own vercel.app address, and serves the two hosts', async () => {
    const run = await productionProxy();
    for (const url of ['https://buzzify-menu.vercel.app/studio/sign-in', 'https://buzzify-menu.vercel.app/atelier/en']) {
      const response = run(new NextRequest(url, { headers: { host: new URL(url).host } }));
      expect(response.status, url).toBe(404);
    }
    const studio = run(new NextRequest('https://studio.buzzify.me/studio/sign-in', { headers: { host: 'studio.buzzify.me' } }));
    expect(studio.status).toBe(200);
    expect(forwarded(studio)[REQUEST_PATH_HEADER]).toBe('/studio/sign-in');
    const menu = run(new NextRequest('https://menu.buzzify.me/atelier/en', { headers: { host: 'menu.buzzify.me' } }));
    expect(menu.status).toBe(200);
  });

  it('keeps the Studio, till and pharmacy off the menu host even when the path has a dot in it', async () => {
    const run = await productionProxy();
    for (const path of ['/studio/restaurants/x.y', '/pos/orders/x.y', '/pharmacy/a.b', '/api/studio/menus/a.b/ai-import', '/studio/menus/..%2Fx.y'])
      expect(run(new NextRequest(`https://menu.buzzify.me${path}`, { headers: { host: 'menu.buzzify.me' } })).status, path).toBe(404);
  });
});

describe('proxy with a host for each product', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  const GATE = 'gate-test-9911';
  const SECRET = 'k'.repeat(32);

  async function productProxy() {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('PUBLIC_MENU_HOST', 'menu.example.test');
    vi.stubEnv('STUDIO_HOST', 'hive.example.test');
    vi.stubEnv('PHARMACY_HOST', 'leaf.example.test');
    vi.stubEnv('CORE_HOST', 'core.example.test');
    vi.stubEnv('CORE_GATE_PATH', GATE);
    vi.stubEnv('BETTER_AUTH_SECRET', SECRET);
    vi.resetModules();
    return (await import('@/proxy')).proxy;
  }

  const request = (host: string, path: string, cookie?: string) =>
    new NextRequest(`https://${host}${path}`, { headers: { host, ...(cookie ? { cookie } : {}) } });

  it('asks search engines to stay away from every host except the menu host', async () => {
    const run = await productProxy();
    expect(run(request('hive.example.test', '/studio')).headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(run(request('leaf.example.test', '/pharmacy')).headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(run(request('menu.example.test', '/atelier/en')).headers.get('x-robots-tag')).toBeNull();
  });

  it('answers the super admin host with a bare 404 until its secret path is opened', async () => {
    const run = await productProxy();
    for (const path of ['/', '/studio', '/api/auth/sign-in/email', `/${GATE}/x`]) {
      const response = run(request('core.example.test', path));
      expect(response.status, path).toBe(404);
      expect(response.headers.get('set-cookie')).toBeNull();
    }
  });

  it('the secret path hands out the gate cookie and goes to the Studio; the cookie then opens the host', async () => {
    const run = await productProxy();
    const { coreGateToken, CORE_GATE_COOKIE } = await import('@/server/http/core-gate');
    const knock = run(request('core.example.test', `/${GATE}`));
    expect(knock.status).toBe(307);
    expect(new URL(knock.headers.get('location') ?? '').pathname).toBe('/studio');
    const setCookie = knock.headers.get('set-cookie') ?? '';
    const token = coreGateToken(GATE, SECRET);
    expect(setCookie).toContain(`${CORE_GATE_COOKIE}=${token}`);
    expect(setCookie.toLowerCase()).toMatch(/httponly/);
    expect(setCookie.toLowerCase()).toMatch(/secure/);
    expect(setCookie.toLowerCase()).toMatch(/samesite=lax/);
    expect(setCookie).not.toContain(GATE);

    const opened = run(request('core.example.test', '/studio', `${CORE_GATE_COOKIE}=${token}`));
    expect(opened.status).toBe(200);
    expect(run(request('core.example.test', '/studio', `${CORE_GATE_COOKIE}=wrong`)).status).toBe(404);
  });

  it('keeps the host closed when there is no auth secret to sign the cookie with', async () => {
    const run = await productProxy();
    vi.stubEnv('BETTER_AUTH_SECRET', '');
    expect(run(request('core.example.test', `/${GATE}`)).status).toBe(404);
  });
});

describe('the proxy matcher', () => {
  const runs = (path: string) => new RegExp(`^${config.matcher[0]}$`).test(path);

  it('lets static files and fonts go by', () => {
    for (const path of ['/_next/static/chunks/a.js', '/_next/image', '/favicon.ico', '/brand/buzzify-on-dark.png', '/templates/ember-grill.webp']) expect(runs(path), path).toBe(false);
  });

  it('runs on pages and on the Studio, till and pharmacy even when the path has a dot', () => {
    for (const path of ['/', '/atelier/en', '/studio', '/studio/restaurants/x.y', '/pos/orders/x.y', '/pos/sw.js', '/pharmacy/a.b', '/api/studio/menus/a.b/ai-import', '/api/cron/publish', '/studio/x.png'])
      expect(runs(path), path).toBe(true);
  });
});
