import { describe, expect, it } from 'vitest';
import { databaseUrl, DEV_DB, TEST_DB, DB_PORT } from '../../scripts/db-config';

describe('db config', () => {
  it('builds connection URLs for the embedded server', () => {
    expect(databaseUrl(DEV_DB)).toBe('postgresql://postgres:postgres@127.0.0.1:54329/buzzify');
    expect(databaseUrl(TEST_DB)).toBe('postgresql://postgres:postgres@127.0.0.1:54329/buzzify_test');
  });

  it('avoids the default Postgres port', () => {
    expect(DB_PORT).not.toBe(5432);
  });
});
