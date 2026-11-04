import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { describe, expect, it } from 'vitest';
import { authHostOptions, onStudioHost } from '@/server/studio/auth/hosts';

const production = {
  baseUrl: 'https://hive.example.test',
  production: true,
  extraHosts: ['leaf.example.test', 'core.example.test'],
};

describe('authHostOptions', () => {
  it('keeps one plain base URL while no further host is set', () => {
    const options = authHostOptions({ baseUrl: 'https://hive.example.test', production: true, extraHosts: [] });
    expect(options.baseURL).toBe('https://hive.example.test');
    expect(options.trustedOrigins).toEqual(['https://hive.example.test']);
  });

  it('allows sign-in on the studio, pharmacy and super admin hosts, over https, falling back to the studio origin', () => {
    const options = authHostOptions(production);
    expect(options.baseURL).toEqual({
      allowedHosts: ['hive.example.test', 'leaf.example.test', 'core.example.test'],
      fallback: 'https://hive.example.test',
      protocol: 'https',
    });
    expect(options.trustedOrigins).toEqual(['https://hive.example.test', 'https://leaf.example.test', 'https://core.example.test']);
  });

  it('trusts the local origins only outside production', () => {
    expect(authHostOptions({ ...production, production: false }).trustedOrigins).toContain('http://127.0.0.1:3100');
    expect(authHostOptions(production).trustedOrigins.join(' ')).not.toContain('127.0.0.1');
  });

  it('never lists an origin on another product’s host by accident', () => {
    expect(authHostOptions(production).trustedOrigins).not.toContain('https://menu.example.test');
  });
});

describe('onStudioHost', () => {
  const base = 'https://hive.example.test';

  it('moves an emailed link from the super admin or pharmacy host to the Studio host, keeping path and query', () => {
    expect(onStudioHost('https://core.example.test/api/auth/verify-email?token=t&callbackURL=%2Fstudio%2Faccount', base)).toBe(
      'https://hive.example.test/api/auth/verify-email?token=t&callbackURL=%2Fstudio%2Faccount',
    );
    expect(onStudioHost('https://leaf.example.test/api/auth/change-email?x=1', base)).toBe('https://hive.example.test/api/auth/change-email?x=1');
  });

  it('leaves a link that is already on the Studio host alone', () =>
    expect(onStudioHost('https://hive.example.test/api/auth/verify-email?token=t', base)).toBe('https://hive.example.test/api/auth/verify-email?token=t'));

  it('leaves a value that is not a URL alone', () => expect(onStudioHost('not a url', base)).toBe('not a url'));
});

describe('Better Auth with those options', () => {
  const options = authHostOptions(production);
  const auth = betterAuth({
    secret: 'z'.repeat(32),
    database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
    baseURL: options.baseURL,
    trustedOrigins: options.trustedOrigins,
    emailAndPassword: { enabled: true },
    advanced: { cookiePrefix: 'studio', useSecureCookies: true },
  });
  const get = (host: string) => auth.handler(new Request(`https://${host}/api/auth/ok`, { headers: { host } }));

  it.each(['hive.example.test', 'leaf.example.test', 'core.example.test'])('answers on %s', async (host) => {
    const response = await get(host);
    expect(response.status).toBe(200);
  });

  it('answers an unlisted host with the Studio origin as its base (the proxy already 404s such hosts first)', async () => {
    const response = await get('menu.example.test');
    expect(response.status).toBe(200);
  });
});
