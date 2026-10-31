/**
 * Which storage the purge script may delete from. The temp-folder adapter holds nothing of a real pharmacy, so a purge that
 * used it against a real database would mark files PURGED while their objects stay in the private bucket for good. The
 * script therefore uses the private bucket whenever it is configured, and the folder only when asked (`--fs`) against a local
 * test database (`BUZZIFY_DB_PORT` set, no `DATABASE_URL`, not production).
 */
export function choosePurgeStorage(args: { r2Configured: boolean; fsFlag: boolean; env: Record<string, string | undefined> }): 'r2' | 'fs' {
  if (args.r2Configured) return 'r2';
  if (!args.fsFlag) throw new Error('The purge needs the private invoice bucket: set the four PH_INTAKE_R2_ variables.');
  if (args.env.NODE_ENV === 'production') throw new Error('The temp folder is not a storage in production: set the PH_INTAKE_R2_ variables.');
  if (args.env.DATABASE_URL) throw new Error('--fs only works against a local test database: unset DATABASE_URL and set BUZZIFY_DB_PORT.');
  if (!args.env.BUZZIFY_DB_PORT) throw new Error('--fs needs BUZZIFY_DB_PORT, so it can only run against a local test database.');
  return 'fs';
}
