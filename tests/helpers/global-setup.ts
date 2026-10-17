import { execSync } from 'node:child_process';
import pg from 'pg';
import { databaseUrl, DB_HOST, DB_PASSWORD, DB_PORT, DB_USER, TEST_DB } from '../../scripts/db-config';

export default async function setup() {
  const admin = new pg.Client({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    database: 'postgres',
    connectionTimeoutMillis: 3000,
  });
  try {
    await admin.connect();
    const found = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [TEST_DB]);
    if (found.rowCount === 0) await admin.query(`CREATE DATABASE "${TEST_DB}"`);
    await admin.end();
    execSync('npx prisma migrate deploy', {
      stdio: 'inherit',
      // `prisma.config.ts` prefers DIRECT_DATABASE_URL (the migration connection in production). A shell that has it set
      // must never send the tests' migrations to that database, so it is blanked here.
      env: { ...process.env, DATABASE_URL: databaseUrl(TEST_DB), DIRECT_DATABASE_URL: '' },
    });
  } catch (error) {
    process.env.TEST_DB_UNAVAILABLE = error instanceof Error ? error.message : String(error);
    console.warn('[tests] Test database unavailable. Run `npm run db:up`. Database tests will fail.');
  }
}
