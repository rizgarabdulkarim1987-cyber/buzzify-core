import { resolve } from 'node:path';

export const ROOT = process.cwd();
export const DATA_DIR = resolve(ROOT, '.data/pg');
export const DB_HOST = '127.0.0.1';

const DEFAULT_DB_PORT = 54329;

/**
 * The embedded server's port: 54329, or `BUZZIFY_DB_PORT` when it is set, so a second checkout of the repository (a git
 * worktree) can run its own server beside the first one's.
 */
export function dbPort(env: Record<string, string | undefined>): number {
  const raw = env.BUZZIFY_DB_PORT?.trim();
  if (!raw) return DEFAULT_DB_PORT;
  const port = Number(raw);
  if (!/^\d+$/.test(raw) || port < 1024 || port > 65535) {
    throw new Error(`BUZZIFY_DB_PORT must be a whole number from 1024 to 65535, not ${JSON.stringify(raw)}`);
  }
  return port;
}

export const DB_PORT = dbPort(process.env);
export const DB_USER = 'postgres';
export const DB_PASSWORD = 'postgres';
export const DEV_DB = 'buzzify';
export const TEST_DB = 'buzzify_test';

export function databaseUrl(name: string): string {
  return `postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${name}`;
}
