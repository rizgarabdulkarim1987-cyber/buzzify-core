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

  it('sends / to /pharmacy', () =>
    expect(routeHost({ host: PHARMACY, pathname: '/' }, cfg)).toEqual({ action: 'redirect', to: '/pharmacy' }));
});

describe('core host (super admin)', () => {
  it.each(['/studio', '/studio/restaurants', '/studio/restaurants/r1', '/studio/team', '/studio/platform', '/api/auth/sign-in/email', '/api/studio/export', '/_next/static/a.js'])(
    'serves %s',
    (pathname) => expect(routeHost({ host: CORE, pathname }, cfg)).toEqual(NEXT),
  );

  it.each(['/pos', '/pharmacy', '/api/pharmacy/intake/files', '/atelier'])('answers 404 for %s', (pathname) =>
    expect(routeHost({ host: CORE, pathname }, cfg)).toEqual(NOT_FOUND),
  );

  it('sends / to /studio', () =>
    expect(routeHost({ host: CORE, pathname: '/' }, cfg)).toEqual({ action: 'redirect', to: '/studio' }));
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
