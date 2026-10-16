import { describe, expect, it } from 'vitest';
import { assertLocalDatabase, databaseHost } from '../../prisma/seed/local-database';

const url = (host: string) => `postgresql://postgres:s3cret-pass@${host}/buzzify`;

describe('databaseHost', () => {
  it('reads the host, in lower case and without the brackets of an IPv6 address', () => {
    expect(databaseHost(url('127.0.0.1:54329'))).toBe('127.0.0.1');
    expect(databaseHost(url('LocalHost'))).toBe('localhost');
    expect(databaseHost(url('[::1]:5432'))).toBe('::1');
    expect(databaseHost(url('ep-xyz.eu-central-1.aws.neon.tech'))).toBe('ep-xyz.eu-central-1.aws.neon.tech');
  });

  it('gives null for text that is not a URL, and an empty host for a URL that names none', () => {
    expect(databaseHost('not a url')).toBeNull();
    expect(databaseHost('postgresql:///buzzify?host=/var/run/postgresql')).toBe('');
  });
});

describe('assertLocalDatabase', () => {
  const check = (env: Record<string, string | undefined>) => assertLocalDatabase('The load seed', { env });

  it.each(['127.0.0.1:54329', 'localhost:5432', 'LOCALHOST', '[::1]:5432'])('lets the loopback host %s through', (host) => {
    expect(() => check({ DATABASE_URL: url(host) })).not.toThrow();
  });

  it('lets the embedded development database through, which is what an unset or empty DATABASE_URL means', () => {
    expect(() => check({})).not.toThrow();
    expect(() => check({ DATABASE_URL: '' })).not.toThrow();
  });

  it('refuses a hosted database, naming its host and never the credentials or the rest of the URL', () => {
    const host = 'ep-xyz.eu-central-1.aws.neon.tech';
    let message = '';
    try {
      check({ DATABASE_URL: url(host) });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/^The load seed refused/);
    expect(message).toContain(host);
    expect(message).toContain('ALLOW_REMOTE_DEV_SEED=1');
    expect(message).not.toContain('s3cret-pass');
    expect(message).not.toContain('postgres:');
  });

  it('refuses a private network address, a look-alike and a host list that merely starts with a loopback host', () => {
    for (const host of ['192.168.1.20', 'localhost.example.com', '127.0.0.1.example.com', '127.0.0.1,db.example.com', '::ffff:127.0.0.1']) {
      expect(() => check({ DATABASE_URL: url(host) }), host).toThrow(/refused/);
    }
  });

  it('refuses a URL that names no host, and one that is not a URL, without quoting it', () => {
    expect(() => check({ DATABASE_URL: 'postgresql:///buzzify?host=/var/run/postgresql' })).toThrow(/no host/);
    let message = '';
    try {
      check({ DATABASE_URL: 'postgres user:s3cret-pass host' });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/not a valid URL/);
    expect(message).not.toContain('s3cret-pass');
  });

  it('is let through by ALLOW_REMOTE_DEV_SEED=1 and by nothing else', () => {
    const DATABASE_URL = url('ep-xyz.eu-central-1.aws.neon.tech');
    expect(() => check({ DATABASE_URL, ALLOW_REMOTE_DEV_SEED: '1' })).not.toThrow();
    for (const value of ['', '0', 'true', 'yes', ' 1']) {
      expect(() => check({ DATABASE_URL, ALLOW_REMOTE_DEV_SEED: value }), JSON.stringify(value)).toThrow(/refused/);
    }
  });

  it('passes on the advice of the caller', () => {
    expect(() => assertLocalDatabase('Seeding', { env: { DATABASE_URL: url('db.example.com') }, instead: 'Unset DEV_SEED_PASSWORD to skip it.' })).toThrow(
      /Unset DEV_SEED_PASSWORD to skip it\. To run it there anyway/,
    );
  });
});
