import { describe, expect, it } from 'vitest';
import { routeHost } from '@/server/http/hosts';

const cfg = { publicHost: 'menu.buzzify.me', studioHost: 'studio.buzzify.me', rootRedirect: 'https://buzzify.me', production: false };
const NEXT = { action: 'next' } as const;
const NOT_FOUND = { action: 'notFound' } as const;
const STUDIO = 'studio.buzzify.me';
const PUBLIC = 'menu.buzzify.me';

describe('routeHost on the studio host', () => {
  it('redirects / to /studio', () =>
    expect(routeHost({ host: STUDIO, pathname: '/' }, cfg)).toEqual({ action: 'redirect', to: '/studio' }));

  it.each([
    '/studio',
    '/studio/menus',
    '/pos',
    '/pos/settings',
    '/pharmacy',
    '/pharmacy/select',
    '/api/auth',
    '/api/auth/sign-in/email',
    '/api/studio/export',
    '/api/pos/sync',
    '/api/pos/sync/snapshot',
    '/api/pharmacy/intake/files',
    '/api/dev-intake/intake/r1/f1',
    '/api/retail/v1/ai-config',
    '/api/retail/v1/identities',
    '/_next/static/chunk.js',
    '/_next/webpack-hmr',
    '/favicon.ico',
  ])('serves %s', (pathname) => expect(routeHost({ host: STUDIO, pathname }, cfg)).toEqual(NEXT));

  it.each(['/atelier', '/atelier/en', '/api/atelier/quote', '/studios', '/api/authx', '/robots.txt'])(
    'answers 404 for %s',
    (pathname) => expect(routeHost({ host: STUDIO, pathname }, cfg)).toEqual(NOT_FOUND),
  );
});

describe('routeHost on the public host', () => {
  it.each(['/studio', '/studio/menus', '/pos', '/pos/staff', '/pharmacy', '/pharmacy/home', '/api/auth', '/api/auth/sign-in/email', '/api/studio', '/api/studio/export', '/api/pos/sync', '/api/pos/sync/snapshot', '/api/pharmacy/intake/files', '/api/dev-intake/intake/r1/f1', '/api/retail/v1/ai-config', '/api/retail/v1/identities'])(
    'answers 404 for %s',
    (pathname) => expect(routeHost({ host: PUBLIC, pathname }, cfg)).toEqual(NOT_FOUND),
  );

  it('redirects / to the root site', () =>
    expect(routeHost({ host: PUBLIC, pathname: '/' }, cfg)).toEqual({ action: 'redirect', to: 'https://buzzify.me' }));

  it.each(['/atelier', '/atelier/en', '/atelier/en/p/atelier-burger', '/api/atelier/quote', '/_next/static/a.js'])(
    'serves %s',
    (pathname) => expect(routeHost({ host: PUBLIC, pathname }, cfg)).toEqual(NEXT),
  );

  it('matches paths by whole segment, so a menu may be called studios or authors', () => {
    for (const pathname of ['/studios', '/posters', '/pos-cafe/en', '/studio-cafe/en', '/api/authors/quote', '/api/studios/quote', '/api/retailers/quote', '/retail-cafe/en']) {
      expect(routeHost({ host: PUBLIC, pathname }, cfg), pathname).toEqual(NEXT);
    }
  });
});

describe('routeHost on any other host (development and previews)', () => {
  it.each(['127.0.0.1:3100', 'localhost:3100', 'preview-123.vercel.app', ''])('sends / on %j to /studio', (host) =>
    expect(routeHost({ host, pathname: '/' }, cfg)).toEqual({ action: 'redirect', to: '/studio' }),
  );

  it.each(['/studio', '/studio/menus', '/pos', '/pos/staff', '/api/auth/session', '/atelier/en', '/api/atelier/quote', '/anything'])(
    'serves %s',
    (pathname) => expect(routeHost({ host: '127.0.0.1:3100', pathname }, cfg)).toEqual(NEXT),
  );
});

describe('routeHost on any other host in production', () => {
  const production = { ...cfg, production: true };

  it.each(['buzzify-menu.vercel.app', 'buzzify-menu-git-main-team.vercel.app', '76.76.21.21', 'localhost:3100', ''])(
    'answers 404 on %j for every path, so the two hosts are the only origins of the Studio and the menus',
    (host) => {
      for (const pathname of ['/', '/studio', '/studio/sign-in', '/api/auth/session', '/api/studio/export', '/atelier/en', '/_next/static/a.js']) {
        expect(routeHost({ host, pathname }, production), `${host}${pathname}`).toEqual(NOT_FOUND);
      }
    },
  );

  it('sends www. on the public host to the public host, keeping the path and query', () => {
    expect(routeHost({ host: 'www.menu.buzzify.me', pathname: '/atelier/en', search: '?qr=7' }, production)).toEqual({
      action: 'redirect',
      to: 'https://menu.buzzify.me/atelier/en?qr=7',
    });
    expect(routeHost({ host: 'WWW.menu.buzzify.me:443', pathname: '/' }, production)).toEqual({
      action: 'redirect',
      to: 'https://menu.buzzify.me/',
    });
    expect(routeHost({ host: 'www.studio.buzzify.me', pathname: '/studio' }, production)).toEqual(NOT_FOUND);
  });

  it('still serves the two configured hosts as before', () => {
    expect(routeHost({ host: STUDIO, pathname: '/studio' }, production)).toEqual(NEXT);
    expect(routeHost({ host: STUDIO, pathname: '/' }, production)).toEqual({ action: 'redirect', to: '/studio' });
    expect(routeHost({ host: 'menu.buzzify.me:443', pathname: '/atelier/en' }, production)).toEqual(NEXT);
    expect(routeHost({ host: PUBLIC, pathname: '/studio' }, production)).toEqual(NOT_FOUND);
  });

  it('serves every host when the hosts are not both configured (a preview, or a production build run locally)', () => {
    for (const hosts of [
      { publicHost: null, studioHost: null },
      { publicHost: 'menu.buzzify.me', studioHost: null },
      { publicHost: null, studioHost: 'studio.buzzify.me' },
    ]) {
      const partial = { ...production, ...hosts };
      expect(routeHost({ host: 'preview-123.vercel.app', pathname: '/studio' }, partial)).toEqual(NEXT);
      expect(routeHost({ host: 'preview-123.vercel.app', pathname: '/' }, partial)).toEqual({ action: 'redirect', to: '/studio' });
    }
  });
});

describe('routeHost host matching', () => {
  it('ignores case, a port and a trailing dot', () => {
    expect(routeHost({ host: 'STUDIO.Buzzify.me', pathname: '/' }, cfg)).toEqual({ action: 'redirect', to: '/studio' });
    expect(routeHost({ host: 'menu.buzzify.me:443', pathname: '/studio' }, cfg)).toEqual(NOT_FOUND);
    expect(routeHost({ host: 'menu.buzzify.me.', pathname: '/studio' }, cfg)).toEqual(NOT_FOUND);
  });

  it('matches a configured port exactly', () => {
    const local = { ...cfg, publicHost: 'localhost:3100', studioHost: 'studio.localhost:3100' };
    expect(routeHost({ host: 'localhost:3100', pathname: '/studio' }, local)).toEqual(NOT_FOUND);
    expect(routeHost({ host: 'localhost:4000', pathname: '/studio' }, local)).toEqual(NEXT);
    expect(routeHost({ host: 'studio.localhost:3100', pathname: '/atelier' }, local)).toEqual(NOT_FOUND);
  });

  it('treats every host as "other" when neither is configured', () => {
    const none = { publicHost: null, studioHost: null, rootRedirect: 'https://buzzify.me', production: false };
    expect(routeHost({ host: PUBLIC, pathname: '/' }, none)).toEqual({ action: 'redirect', to: '/studio' });
    expect(routeHost({ host: STUDIO, pathname: '/studio' }, none)).toEqual(NEXT);
  });

  it('prefers the studio rules when both hosts are the same name', () => {
    const same = { ...cfg, publicHost: STUDIO };
    expect(routeHost({ host: STUDIO, pathname: '/studio' }, same)).toEqual(NEXT);
  });
});

describe('routeHost for the scheduler', () => {
  it.each([STUDIO, PUBLIC, 'buzzify-preview.vercel.app'])('lets /api/cron/publish through on %s, in production too', (host) => {
    expect(routeHost({ host, pathname: '/api/cron/publish' }, cfg)).toEqual(NEXT);
    expect(routeHost({ host, pathname: '/api/cron/publish' }, { ...cfg, production: true })).toEqual(NEXT);
  });
});
