import { describe, expect, it } from 'vitest';
import { routeHost, type HostConfig } from '@/server/http/hosts';

const cfg: HostConfig = {
  publicHost: 'menu.buzzify.tech',
  studioHost: 'hive.example.test',
  pharmacyHost: 'leaf.example.test',
  coreHost: 'core.example.test',
  apexHost: 'buzzify.tech',
  legacyHosts: ['buzzify-menu.online', 'studio.buzzify-menu.online'],
  rootRedirect: 'https://buzzify.me',
  production: true,
};
const NEXT = { action: 'next' } as const;
const NOT_FOUND = { action: 'notFound' } as const;
const STUDIO = 'hive.example.test';
const PHARMACY = 'leaf.example.test';
const CORE = 'core.example.test';

describe('studio host once the pharmacy and core hosts are set', () => {
  it.each(['/studio', '/studio/menus', '/pos', '/pos/settings', '/api/auth/sign-in/email', '/api/studio/export', '/api/pos/sync', '/api/retail/v1/handoff', '/studio/retail/continue', '/_next/static/a.js', '/api/cron/retail-sync'])(
    'serves %s',
    (pathname) => expect(routeHost({ host: STUDIO, pathname }, cfg)).toEqual(NEXT),
  );

  it.each(['/pharmacy', '/pharmacy/select', '/api/pharmacy/intake/files', '/api/dev-intake/intake/r1/f1', '/studio/restaurants', '/studio/restaurants/r1', '/studio/team'])(
    'answers 404 for %s',
    (pathname) => expect(routeHost({ host: STUDIO, pathname }, cfg)).toEqual(NOT_FOUND),
  );

  it('keeps serving the pharmacy while no pharmacy host is set', () => {
    const before = { ...cfg, pharmacyHost: null, coreHost: null };
    expect(routeHost({ host: STUDIO, pathname: '/pharmacy' }, before)).toEqual(NEXT);
    expect(routeHost({ host: STUDIO, pathname: '/studio/restaurants' }, before)).toEqual(NEXT);
  });
});

describe('pharmacy host', () => {
  it.each(['/pharmacy', '/pharmacy/select', '/api/auth/sign-in/email', '/api/pharmacy/intake/files', '/api/dev-intake/intake/r1/f1', '/_next/webpack-hmr', '/favicon.ico', '/api/cron/publish'])(
    'serves %s',
    (pathname) => expect(routeHost({ host: PHARMACY, pathname }, cfg)).toEqual(NEXT),
  );

  it.each(['/studio', '/studio/menus', '/pos', '/api/studio/export', '/api/pos/sync', '/api/retail/v1/handoff', '/atelier'])(
    'answers 404 for %s',
    (pathname) => expect(routeHost({ host: PHARMACY, pathname }, cfg)).toEqual(NOT_FOUND),
  );

  it.each(['/studio/sign-in', '/studio/forgot', '/studio/reset', '/studio/invite/abc', '/studio/setup-two-factor', '/studio/two-factor', '/studio/account'])(
    'serves the sign-in and account page %s, so a signed-out pharmacist can get in',
    (pathname) => expect(routeHost({ host: PHARMACY, pathname }, cfg)).toEqual(NEXT),
  );

  it.each(['/studio', '/studio/menus', '/studio/restaurants', '/studio/sign-in-x'])('still answers 404 for %s', (pathname) =>
    expect(routeHost({ host: PHARMACY, pathname }, cfg)).toEqual(NOT_FOUND),
  );

  it('sends / to /pharmacy', () =>
    expect(routeHost({ host: PHARMACY, pathname: '/' }, cfg)).toEqual({ action: 'redirect', to: '/pharmacy' }));
});

describe('core host (super admin) behind its secret path', () => {
  const gated: HostConfig = { ...cfg, coreGatePath: 'secret-path-test' };

  it.each(['/', '/studio', '/studio/restaurants', '/api/auth/sign-in/email', '/api/studio/export', '/_next/static/a.js', '/favicon.ico', '/secret-path-test/x'])(
    'answers 404 for %s without the gate cookie, as if nothing were here',
    (pathname) => expect(routeHost({ host: CORE, pathname }, gated)).toEqual(NOT_FOUND),
  );

  it('the secret path itself opens the gate and goes to /studio', () =>
    expect(routeHost({ host: CORE, pathname: '/secret-path-test' }, gated)).toEqual({ action: 'knock', to: '/studio' }));

  it('a trailing slash on the secret path works too', () =>
    expect(routeHost({ host: CORE, pathname: '/secret-path-test/' }, gated)).toEqual({ action: 'knock', to: '/studio' }));

  it.each(['/studio', '/studio/restaurants', '/studio/restaurants/r1', '/studio/team', '/studio/platform', '/api/auth/sign-in/email', '/api/studio/export', '/_next/static/a.js'])(
    'serves %s with the gate cookie',
    (pathname) => expect(routeHost({ host: CORE, pathname, coreGate: true }, gated)).toEqual(NEXT),
  );

  it.each(['/pos', '/pharmacy', '/api/pharmacy/intake/files', '/atelier'])('answers 404 for %s even with the gate cookie', (pathname) =>
    expect(routeHost({ host: CORE, pathname, coreGate: true }, gated)).toEqual(NOT_FOUND),
  );

  it('sends / to /studio with the gate cookie', () =>
    expect(routeHost({ host: CORE, pathname: '/', coreGate: true }, gated)).toEqual({ action: 'redirect', to: '/studio' }));

  it('lets the scheduler reach the cron routes without the cookie', () =>
    expect(routeHost({ host: CORE, pathname: '/api/cron/publish' }, gated)).toEqual(NEXT));

  it('without a configured secret path the host is open (development)', () =>
    expect(routeHost({ host: CORE, pathname: '/studio' }, cfg)).toEqual(NEXT));
});

describe('encoded and doubled slashes in the path', () => {
  it.each(['/studio/%72estaurants', '/studio//restaurants', '/studio/restaurants/%2e', '/%73tudio/team', '/studio/%74eam/', '//studio/team'])(
    'the Studio host answers 404 for %s once the core host is set',
    (pathname) => expect(routeHost({ host: STUDIO, pathname }, cfg)).toEqual(NOT_FOUND),
  );

  it.each(['/%73tudio', '/%70os/staff', '//pharmacy', '/api//studio/export', '/%61pi/auth/sign-in/email'])(
    'the menu host answers 404 for %s',
    (pathname) => expect(routeHost({ host: 'menu.buzzify.tech', pathname }, cfg)).toEqual(NOT_FOUND),
  );

  it('answers 404 for a path whose encoding is malformed', () =>
    expect(routeHost({ host: 'menu.buzzify.tech', pathname: '/atelier/%E0%A4%A' }, cfg)).toEqual(NOT_FOUND));

  it('still serves a menu whose address has an encoded character', () =>
    expect(routeHost({ host: 'menu.buzzify.tech', pathname: '/caf%C3%A9/en' }, cfg)).toEqual(NEXT));
});

describe('apex and legacy hosts', () => {
  it.each(['buzzify.tech', 'www.buzzify.tech'])('%s sends every path to the root site', (host) => {
    for (const pathname of ['/', '/atelier', '/studio']) {
      expect(routeHost({ host, pathname }, cfg)).toEqual({ action: 'redirect', to: 'https://buzzify.me' });
    }
  });

  it('sends the old menu host to the new one, keeping path and query', () =>
    expect(routeHost({ host: 'buzzify-menu.online', pathname: '/atelier', search: '?lang=ar' }, cfg)).toEqual({
      action: 'redirect',
      to: 'https://menu.buzzify.tech/atelier?lang=ar',
    }));

  it('sends the root of the old menu host to the company page, as it always did', () =>
    expect(routeHost({ host: 'buzzify-menu.online', pathname: '/' }, cfg)).toEqual({ action: 'redirect', to: 'https://buzzify.me' }));

  it('sends the old studio host to the new studio host', () =>
    expect(routeHost({ host: 'studio.buzzify-menu.online', pathname: '/studio/menus', search: '?x=1' }, cfg)).toEqual({
      action: 'redirect',
      to: 'https://hive.example.test/studio/menus?x=1',
    }));

  it('still lets the scheduler reach the cron routes on a legacy host', () =>
    expect(routeHost({ host: 'studio.buzzify-menu.online', pathname: '/api/cron/publish' }, cfg)).toEqual(NEXT));

  it('answers 404 for a host that is not configured', () =>
    expect(routeHost({ host: '203.0.113.9', pathname: '/studio' }, cfg)).toEqual(NOT_FOUND));
});
