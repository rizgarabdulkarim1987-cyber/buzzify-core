import { describe, expect, it } from 'vitest';
import { assertLocalDatabase } from '../../prisma/seed/local-database';
import { databaseTarget, describeDatabase } from '../../scripts/database-target';

const url = (host: string, query = '') => `postgresql://postgres:s3cret-pass@${host}/buzzify${query}`;
const HOSTED = 'ep-xyz.eu-central-1.aws.neon.tech';
const CLOUD_SQL = '/cloudsql/proj:europe-west1:inst';

/** The message of the refusal, or '' when there is none. */
function refusal(env: Record<string, string | undefined>, what = 'The load seed'): string {
  try {
    assertLocalDatabase(what, { env });
    return '';
  } catch (error) {
    return (error as Error).message;
  }
}

describe('databaseTarget (where pg really connects)', () => {
  it('reads the host, in lower case and without the brackets of an IPv6 address, with the port and the database', () => {
    expect(databaseTarget(url('127.0.0.1:54329'))).toEqual({ host: '127.0.0.1', port: '54329', database: 'buzzify' });
    expect(databaseTarget(url('LocalHost'))).toEqual({ host: 'localhost', port: '', database: 'buzzify' });
    expect(databaseTarget(url('[::1]:5432'))).toEqual({ host: '::1', port: '5432', database: 'buzzify' });
    expect(databaseTarget(url(HOSTED))?.host).toBe(HOSTED);
    expect(databaseTarget('postgres://u:p@db.example.com/x')?.host).toBe('db.example.com');
  });

  it('takes the host from a host parameter before the authority, as pg does', () => {
    expect(databaseTarget(url('127.0.0.1', '?host=remote.example.com'))?.host).toBe('remote.example.com');
    expect(databaseTarget(url('remote.example.com', '?host=127.0.0.1'))?.host).toBe('127.0.0.1');
    // The last one wins.
    expect(databaseTarget(url('127.0.0.1', '?host=127.0.0.1&host=remote.example.com'))?.host).toBe('remote.example.com');
    expect(databaseTarget(url('127.0.0.1:5432', '?port=6543'))?.port).toBe('6543');
  });

  it('reads a socket path, however it is written, as a path', () => {
    expect(databaseTarget(url('localhost', `?host=${CLOUD_SQL}`))?.host).toBe(CLOUD_SQL);
    expect(databaseTarget(url('localhost', `?host=${encodeURIComponent(CLOUD_SQL)}`))?.host).toBe(CLOUD_SQL);
    expect(databaseTarget(`postgresql://u:p@${encodeURIComponent(CLOUD_SQL)}/db`)?.host).toBe(CLOUD_SQL);
    expect(databaseTarget(`socket:${CLOUD_SQL}?db=db`)?.host).toBe(CLOUD_SQL);
    expect(databaseTarget('/var/run/postgresql mydb')?.host).toBe('/var/run/postgresql');
  });

  it('falls back on PGHOST and then localhost when the URL names no host, as pg does', () => {
    expect(databaseTarget('postgresql:///buzzify', {})?.host).toBe('localhost');
    expect(databaseTarget('postgresql://u:p@/buzzify', { PGHOST: 'Remote.Example.com' })?.host).toBe('remote.example.com');
    // A host in the URL is not replaced by PGHOST.
    expect(databaseTarget(url('127.0.0.1'), { PGHOST: 'remote.example.com' })?.host).toBe('127.0.0.1');
  });

  it('gives null for text that is not a connection URL', () => {
    expect(databaseTarget('not a url')).toBeNull();
    expect(databaseTarget('mysql://u:p@127.0.0.1/db')).toBeNull();
    expect(databaseTarget('')).toBeNull();
  });
});

describe('assertLocalDatabase', () => {
  it.each(['127.0.0.1:54329', 'localhost:5432', 'LOCALHOST', '[::1]:5432'])('lets the loopback host %s through', (host) => {
    expect(refusal({ DATABASE_URL: url(host) })).toBe('');
  });

  it('lets the embedded development database through, which is what an unset or empty DATABASE_URL means', () => {
    expect(refusal({})).toBe('');
    expect(refusal({ DATABASE_URL: '' })).toBe('');
  });

  it('lets through a URL that names no host, which pg takes to be localhost', () => {
    expect(refusal({ DATABASE_URL: 'postgresql:///buzzify' })).toBe('');
    expect(refusal({ DATABASE_URL: 'postgresql://u:p@/buzzify' })).toBe('');
  });

  it('refuses a hosted database, naming its host and never the credentials or the rest of the URL', () => {
    const message = refusal({ DATABASE_URL: url(HOSTED) });
    expect(message).toMatch(/^The load seed refused/);
    expect(message).toContain(HOSTED);
    expect(message).toContain('ALLOW_REMOTE_DEV_SEED=1');
    expect(message).not.toContain('s3cret-pass');
    expect(message).not.toContain('postgres:');
  });

  it('refuses a loopback authority that a host parameter turns into another host, naming the host pg would reach', () => {
    const message = refusal({ DATABASE_URL: url('127.0.0.1', '?host=remote.example.com') });
    expect(message).toContain('remote.example.com');
    expect(message).not.toContain('s3cret-pass');
    expect(refusal({ DATABASE_URL: url('localhost:5432', '?host=remote.example.com&sslmode=require') })).toContain('remote.example.com');
    expect(refusal({ DATABASE_URL: url('[::1]', '?host=remote.example.com') })).toContain('remote.example.com');
    // The last host parameter is the one that counts.
    expect(refusal({ DATABASE_URL: url('127.0.0.1', '?host=127.0.0.1&host=remote.example.com') })).toContain('remote.example.com');
  });

  it('judges a remote authority with a loopback host parameter by where pg connects, which is this machine, and lets it through', () => {
    expect(refusal({ DATABASE_URL: url('remote.example.com', '?host=127.0.0.1') })).toBe('');
  });

  it('never takes a Unix socket path for this machine, however it is written (a Cloud SQL socket reaches a hosted database)', () => {
    for (const databaseUrl of [
      url('localhost', `?host=${CLOUD_SQL}`),
      url('127.0.0.1', `?host=${encodeURIComponent(CLOUD_SQL)}`),
      `postgresql://u:s3cret-pass@${encodeURIComponent(CLOUD_SQL)}/db`,
      `socket:${CLOUD_SQL}?db=db`,
      '/var/run/postgresql mydb',
    ]) {
      const message = refusal({ DATABASE_URL: databaseUrl });
      expect(message, databaseUrl).toMatch(/connects through the socket \/(cloudsql\/proj:europe-west1:inst|var\/run\/postgresql)/);
      expect(message, databaseUrl).not.toContain('s3cret-pass');
    }
  });

  it('refuses a host list, a private address, a look-alike and the IPv4-mapped loopback', () => {
    for (const databaseUrl of [
      url('192.168.1.20'),
      url('localhost.example.com'),
      url('127.0.0.1.example.com'),
      url('127.0.0.1,db.example.com'),
      url('127.0.0.1', '?host=127.0.0.1,db.example.com'),
      url('127.0.0.1', '?host=db.example.com,127.0.0.1'),
      url('[::ffff:127.0.0.1]'),
    ]) {
      expect(refusal({ DATABASE_URL: databaseUrl }), databaseUrl).toMatch(/refused: DATABASE_URL leads to the host/);
    }
  });

  it('follows PGHOST when the URL names no host', () => {
    const message = refusal({ DATABASE_URL: 'postgresql://u:s3cret-pass@/buzzify', PGHOST: 'remote.example.com' });
    expect(message).toContain('remote.example.com');
    expect(message).not.toContain('s3cret-pass');
    expect(refusal({ DATABASE_URL: 'postgresql:///buzzify', PGHOST: CLOUD_SQL })).toContain(`the socket ${CLOUD_SQL}`);
    expect(refusal({ DATABASE_URL: 'postgresql:///buzzify', PGHOST: '127.0.0.1' })).toBe('');
  });

  it('refuses text that is not a connection URL without quoting it', () => {
    for (const databaseUrl of ['postgres user:s3cret-pass host', 'mysql://u:s3cret-pass@127.0.0.1/db']) {
      const message = refusal({ DATABASE_URL: databaseUrl });
      expect(message, databaseUrl).toMatch(/not a connection URL/);
      expect(message, databaseUrl).not.toContain('s3cret-pass');
    }
  });

  it('is let through by ALLOW_REMOTE_DEV_SEED=1 and by nothing else', () => {
    const DATABASE_URL = url(HOSTED);
    expect(refusal({ DATABASE_URL, ALLOW_REMOTE_DEV_SEED: '1' })).toBe('');
    for (const value of ['', '0', 'true', 'yes', ' 1']) {
      expect(refusal({ DATABASE_URL, ALLOW_REMOTE_DEV_SEED: value }), JSON.stringify(value)).toMatch(/refused/);
    }
  });

  it('passes on the advice of the caller', () => {
    expect(() => assertLocalDatabase('Seeding', { env: { DATABASE_URL: url('db.example.com') }, instead: 'Unset DEV_SEED_PASSWORD to skip it.' })).toThrow(
      /Unset DEV_SEED_PASSWORD to skip it\. To run it there anyway/,
    );
  });
});

describe('describeDatabase (the line a script prints before it changes anything)', () => {
  it('names the host, port and database pg will use, and nothing of the credentials', () => {
    expect(describeDatabase({ DATABASE_URL: url('127.0.0.1:54329') })).toBe('127.0.0.1:54329/buzzify');
    expect(describeDatabase({ DATABASE_URL: url(HOSTED) })).toBe(`${HOSTED}/buzzify`);
  });

  it('prints the real target when a host parameter or PGHOST changes it', () => {
    expect(describeDatabase({ DATABASE_URL: url('127.0.0.1:54329', '?host=remote.example.com') })).toBe('remote.example.com:54329/buzzify');
    expect(describeDatabase({ DATABASE_URL: url('localhost', `?host=${CLOUD_SQL}`) })).toBe(`${CLOUD_SQL}/buzzify`);
    expect(describeDatabase({ DATABASE_URL: 'postgresql://u:p@/buzzify', PGHOST: 'remote.example.com' })).toBe('remote.example.com/buzzify');
  });

  it('says so when DATABASE_URL is unset, and when it is not a connection URL, without quoting it', () => {
    expect(describeDatabase({})).toBe('the development database (DATABASE_URL is not set)');
    const text = describeDatabase({ DATABASE_URL: 'postgres user:s3cret-pass host' });
    expect(text).toMatch(/not a connection URL/);
    expect(text).not.toContain('s3cret-pass');
  });
});
