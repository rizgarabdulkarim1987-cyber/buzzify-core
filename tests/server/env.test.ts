import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  authEnv,
  hostEnv,
  mailEnv,
  parseAuthEnv,
  parseHostEnv,
  parseCronEnv,
  parseMailEnv,
  parseStorageEnv,
} from '@/server/env';

const SECRET = 'x'.repeat(32);

describe('parseHostEnv', () => {
  it('has a default for every variable, so nothing throws when none is set', () => {
    expect(parseHostEnv({})).toEqual({
      publicHost: null,
      studioHost: null,
      publicOrigin: 'http://127.0.0.1:3100',
      rootRedirect: 'https://buzzify.me',
    });
  });

  it('reads the four routing variables', () => {
    expect(
      parseHostEnv({
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
      parseHostEnv({ PUBLIC_MENU_HOST: '  Menu.Buzzify.me ', STUDIO_HOST: '', PUBLIC_MENU_ORIGIN: 'https://menu.buzzify.me/' }),
    ).toMatchObject({ publicHost: 'menu.buzzify.me', studioHost: null, publicOrigin: 'https://menu.buzzify.me' });
    expect(parseHostEnv({ PUBLIC_MENU_ORIGIN: '   ', PUBLIC_ROOT_REDIRECT: '' })).toMatchObject({
      publicOrigin: 'http://127.0.0.1:3100',
      rootRedirect: 'https://buzzify.me',
    });
  });

  it('rejects a host that is a URL, because it would silently never match', () => {
    expect(() => parseHostEnv({ STUDIO_HOST: 'https://studio.buzzify.me' })).toThrow();
    expect(() => parseHostEnv({ PUBLIC_MENU_HOST: 'menu.buzzify.me/path' })).toThrow();
  });

  it('rejects an origin or root redirect that is not an http(s) URL', () => {
    expect(() => parseHostEnv({ PUBLIC_MENU_ORIGIN: 'menu.buzzify.me' })).toThrow();
    expect(() => parseHostEnv({ PUBLIC_ROOT_REDIRECT: 'javascript:alert(1)' })).toThrow();
  });

  it('ignores the email and sign-in variables, however wrong they are', () => {
    expect(() =>
      parseHostEnv({ EMAIL_FROM: 'not an address', RESEND_API_KEY: '', BETTER_AUTH_SECRET: 'short', BETTER_AUTH_URL: 'nope', NODE_ENV: 'production' }),
    ).not.toThrow();
  });
});

describe('parseMailEnv', () => {
  it('has a default sender and no key', () => {
    expect(parseMailEnv({})).toEqual({ resendApiKey: null, emailFrom: 'Buzzify Studio <studio@buzzify.me>' });
  });

  it('reads the email key and sender', () => {
    expect(parseMailEnv({ RESEND_API_KEY: ' re_abc ', EMAIL_FROM: 'Menus <menus@example.com>' })).toEqual({
      resendApiKey: 're_abc',
      emailFrom: 'Menus <menus@example.com>',
    });
    expect(parseMailEnv({ EMAIL_FROM: 'menus@example.com' })).toMatchObject({ emailFrom: 'menus@example.com' });
  });

  it('treats an empty email key or sender as unset', () => {
    expect(parseMailEnv({ RESEND_API_KEY: '', EMAIL_FROM: '  ' })).toEqual({
      resendApiKey: null,
      emailFrom: 'Buzzify Studio <studio@buzzify.me>',
    });
  });

  it('rejects a sender that is not an address, because Resend would only refuse it at send time', () => {
    expect(() => parseMailEnv({ EMAIL_FROM: 'Buzzify Studio' })).toThrow();
    expect(() => parseMailEnv({ EMAIL_FROM: 'Buzzify <studio@buzzify.me' })).toThrow();
  });

  it('ignores the routing and sign-in variables, however wrong they are', () => {
    expect(() =>
      parseMailEnv({ STUDIO_HOST: 'https://nope', PUBLIC_MENU_ORIGIN: 'nope', BETTER_AUTH_SECRET: 'short', NODE_ENV: 'production' }),
    ).not.toThrow();
  });
});

describe('parseAuthEnv', () => {
  it('uses a fixed development secret and the local origin when nothing is set outside production', () => {
    const dev = parseAuthEnv({});
    expect(dev.baseUrl).toBe('http://127.0.0.1:3100');
    expect(dev.production).toBe(false);
    expect(dev.secret.length).toBeGreaterThanOrEqual(32);
    expect(parseAuthEnv({ NODE_ENV: 'test' }).secret).toBe(dev.secret);
    expect(parseAuthEnv({ NODE_ENV: 'development', BETTER_AUTH_SECRET: '   ' }).secret).toBe(dev.secret);
  });

  it('reads the secret and the URL, and drops a trailing slash from the URL', () => {
    expect(parseAuthEnv({ BETTER_AUTH_SECRET: ` ${SECRET} `, BETTER_AUTH_URL: 'https://studio.buzzify.me/' })).toEqual({
      secret: SECRET,
      baseUrl: 'https://studio.buzzify.me',
      production: false,
    });
  });

  it('refuses a missing secret in production, and one under 32 characters', () => {
    const base = { NODE_ENV: 'production', BETTER_AUTH_URL: 'https://studio.buzzify.me' };
    expect(() => parseAuthEnv({ ...base })).toThrow(/BETTER_AUTH_SECRET/);
    expect(() => parseAuthEnv({ ...base, BETTER_AUTH_SECRET: '' })).toThrow(/BETTER_AUTH_SECRET/);
    expect(() => parseAuthEnv({ ...base, BETTER_AUTH_SECRET: 'x'.repeat(31) })).toThrow(/BETTER_AUTH_SECRET/);
    expect(parseAuthEnv({ ...base, BETTER_AUTH_SECRET: SECRET })).toMatchObject({ secret: SECRET, production: true });
  });

  it('never uses the development secret in production', () => {
    const dev = parseAuthEnv({}).secret;
    expect(() => parseAuthEnv({ NODE_ENV: 'production', BETTER_AUTH_URL: 'https://studio.buzzify.me', BETTER_AUTH_SECRET: dev })).toThrow(
      /BETTER_AUTH_SECRET/,
    );
  });

  it('treats the placeholder from .env.example as no secret, so copying it unchanged never reaches production', () => {
    const placeholder = 'generate with: openssl rand -base64 32';
    expect(parseAuthEnv({ BETTER_AUTH_SECRET: placeholder }).secret).toBe(parseAuthEnv({}).secret);
    expect(() =>
      parseAuthEnv({ NODE_ENV: 'production', BETTER_AUTH_URL: 'https://studio.buzzify.me', BETTER_AUTH_SECRET: placeholder }),
    ).toThrow(/BETTER_AUTH_SECRET/);
  });

  it('refuses a missing URL in production, because reset links would point at the local machine', () => {
    expect(() => parseAuthEnv({ NODE_ENV: 'production', BETTER_AUTH_SECRET: SECRET })).toThrow(/BETTER_AUTH_URL/);
  });

  it('rejects a URL that is not a bare http(s) origin', () => {
    for (const bad of ['studio.buzzify.me', 'ftp://studio.buzzify.me', 'https://studio.buzzify.me/app', 'https://studio.buzzify.me/?a=1']) {
      expect(() => parseAuthEnv({ BETTER_AUTH_URL: bad })).toThrow(/BETTER_AUTH_URL/);
    }
  });

  it('ignores the routing and email variables, however wrong they are', () => {
    expect(() => parseAuthEnv({ STUDIO_HOST: 'https://nope', EMAIL_FROM: 'nope' })).not.toThrow();
  });
});

describe('the cached readers', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('parse lazily and return the same object on every call', () => {
    expect(hostEnv()).toBe(hostEnv());
    expect(mailEnv()).toBe(mailEnv());
    expect(authEnv()).toBe(authEnv());
  });

  it('fail independently: a bad variable breaks only its own section', async () => {
    vi.resetModules();
    vi.stubEnv('EMAIL_FROM', 'not an address');
    vi.stubEnv('BETTER_AUTH_URL', 'nope');
    vi.stubEnv('PUBLIC_MENU_HOST', '');
    const fresh = await import('@/server/env');
    expect(() => fresh.hostEnv()).not.toThrow();
    expect(() => fresh.mailEnv()).toThrow(/EMAIL_FROM/);
    expect(() => fresh.authEnv()).toThrow(/BETTER_AUTH_URL/);
    // A failed section is retried (and fails again) rather than caching a half-built value.
    expect(() => fresh.mailEnv()).toThrow(/EMAIL_FROM/);
  });
});

describe('parseStorageEnv', () => {
  const r2 = { R2_ACCOUNT_ID: 'acc', R2_ACCESS_KEY_ID: 'key', R2_SECRET_ACCESS_KEY: 'secret', R2_BUCKET: 'bucket' };

  it('uses the development folder when R2 is not configured', () => {
    expect(parseStorageEnv({})).toEqual({ kind: 'folder', dir: '.data/media', publicUrl: '/api/dev-media' });
    expect(parseStorageEnv({ MEDIA_LOCAL_DIR: '/tmp/m', MEDIA_PUBLIC_URL: 'http://127.0.0.1:3100/api/dev-media/' })).toEqual({
      kind: 'folder',
      dir: '/tmp/m',
      publicUrl: 'http://127.0.0.1:3100/api/dev-media',
    });
  });

  it('uses R2 when all four of its variables are set', () => {
    expect(parseStorageEnv({ ...r2, MEDIA_PUBLIC_URL: 'https://media.buzzify.me' })).toEqual({
      kind: 'r2',
      accountId: 'acc',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
      bucket: 'bucket',
      publicUrl: 'https://media.buzzify.me',
    });
  });

  it('names the R2 variables that are missing when only some are set', () => {
    expect(() => parseStorageEnv({ R2_ACCOUNT_ID: 'acc', R2_BUCKET: 'bucket' })).toThrow(/R2_ACCESS_KEY_ID.*R2_SECRET_ACCESS_KEY/);
  });

  it('refuses the development folder in production', () => {
    expect(() => parseStorageEnv({ NODE_ENV: 'production' })).toThrow(/R2/);
  });
});

describe('parseCronEnv', () => {
  it('reads the cron secret, which must be long', () => {
    expect(parseCronEnv({})).toEqual({ secret: null });
    expect(parseCronEnv({ CRON_SECRET: '  ' })).toEqual({ secret: null });
    expect(parseCronEnv({ CRON_SECRET: SECRET })).toEqual({ secret: SECRET });
    expect(() => parseCronEnv({ CRON_SECRET: 'short' })).toThrow('CRON_SECRET');
  });
});
