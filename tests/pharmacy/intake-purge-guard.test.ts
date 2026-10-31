import { describe, expect, it } from 'vitest';
import { choosePurgeStorage } from '@/server/pharmacy/intake/purge-guard';

describe('which storage the purge script may use', () => {
  it('uses the private bucket whenever it is configured', () => {
    expect(choosePurgeStorage({ r2Configured: true, fsFlag: false, env: {} })).toBe('r2');
    expect(choosePurgeStorage({ r2Configured: true, fsFlag: true, env: { BUZZIFY_DB_PORT: '54503' } })).toBe('r2');
  });

  it('refuses the temp folder without the private bucket unless --fs is given against a local test database', () => {
    expect(() => choosePurgeStorage({ r2Configured: false, fsFlag: false, env: { BUZZIFY_DB_PORT: '54503' } })).toThrow(/PH_INTAKE_R2/);
    expect(() => choosePurgeStorage({ r2Configured: false, fsFlag: true, env: {} })).toThrow(/BUZZIFY_DB_PORT/);
    expect(choosePurgeStorage({ r2Configured: false, fsFlag: true, env: { BUZZIFY_DB_PORT: '54503' } })).toBe('fs');
  });

  it('never uses the temp folder when DATABASE_URL points somewhere else, or in production', () => {
    expect(() => choosePurgeStorage({ r2Configured: false, fsFlag: true, env: { BUZZIFY_DB_PORT: '54503', DATABASE_URL: 'postgres://prod/db' } })).toThrow(/DATABASE_URL/);
    expect(() => choosePurgeStorage({ r2Configured: false, fsFlag: true, env: { BUZZIFY_DB_PORT: '54503', NODE_ENV: 'production' } })).toThrow(/production/);
  });
});
