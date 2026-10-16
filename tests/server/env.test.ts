import { describe, expect, it } from 'vitest';
import { env, parseEnv } from '@/server/env';

describe('parseEnv', () => {
  it('has a default for every variable, so nothing throws when none is set', () => {
    expect(parseEnv({})).toEqual({
      publicHost: null,
      studioHost: null,
      publicOrigin: 'http://127.0.0.1:3100',
      rootRedirect: 'https://buzzify.me',
    });
  });

  it('reads the four variables', () => {
    expect(
      parseEnv({
        PUBLIC_MENU_HOST: 'menu.buzzify.me',
        STUDIO_HOST: 'studio.buzzify.me',
        PUBLIC_MENU_ORIGIN: 'https://menu.buzzify.me',
        PUBLIC_ROOT_REDIRECT: 'https://example.com/welcome',
      }),
    ).toEqual({
      publicHost: 'menu.buzzify.me',
      studioHost: 'studio.buzzify.me',
      publicOrigin: 'https://menu.buzzify.me',
      rootRedirect: 'https://example.com/welcome',
    });
  });

  it('treats empty and blank values as unset, lowercases hosts and drops a trailing slash from the origin', () => {
    expect(
      parseEnv({ PUBLIC_MENU_HOST: '  Menu.Buzzify.me ', STUDIO_HOST: '', PUBLIC_MENU_ORIGIN: 'https://menu.buzzify.me/' }),
    ).toMatchObject({ publicHost: 'menu.buzzify.me', studioHost: null, publicOrigin: 'https://menu.buzzify.me' });
    expect(parseEnv({ PUBLIC_MENU_ORIGIN: '   ', PUBLIC_ROOT_REDIRECT: '' })).toMatchObject({
      publicOrigin: 'http://127.0.0.1:3100',
      rootRedirect: 'https://buzzify.me',
    });
  });

  it('rejects a host that is a URL, because it would silently never match', () => {
    expect(() => parseEnv({ STUDIO_HOST: 'https://studio.buzzify.me' })).toThrow();
    expect(() => parseEnv({ PUBLIC_MENU_HOST: 'menu.buzzify.me/path' })).toThrow();
  });

  it('rejects an origin or root redirect that is not an http(s) URL', () => {
    expect(() => parseEnv({ PUBLIC_MENU_ORIGIN: 'menu.buzzify.me' })).toThrow();
    expect(() => parseEnv({ PUBLIC_ROOT_REDIRECT: 'javascript:alert(1)' })).toThrow();
  });
});

describe('env', () => {
  it('parses lazily and returns the same object on every call', () => {
    expect(env()).toBe(env());
  });
});
