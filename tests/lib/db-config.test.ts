import { describe, expect, it } from 'vitest';
import { databaseUrl, dbPort, DB_PORT, DEV_DB, TEST_DB } from '../../scripts/db-config';

describe('db config', () => {
  it('builds connection URLs for the embedded server on its port', () => {
    expect(databaseUrl(DEV_DB)).toBe(`postgresql://postgres:postgres@127.0.0.1:${DB_PORT}/buzzify`);
    expect(databaseUrl(TEST_DB)).toBe(`postgresql://postgres:postgres@127.0.0.1:${DB_PORT}/buzzify_test`);
  });

  it('uses 54329 unless BUZZIFY_DB_PORT names another port', () => {
    expect(dbPort({})).toBe(54329);
    expect(dbPort({ BUZZIFY_DB_PORT: '' })).toBe(54329);
    expect(dbPort({ BUZZIFY_DB_PORT: '54339' })).toBe(54339);
  });

  it('refuses a port that is not a whole number between 1024 and 65535', () => {
    for (const value of ['abc', '80', '70000', '5433.5']) {
      expect(() => dbPort({ BUZZIFY_DB_PORT: value })).toThrow('BUZZIFY_DB_PORT');
    }
  });

  it('avoids the default Postgres port', () => {
    expect(dbPort({})).not.toBe(5432);
  });
});
