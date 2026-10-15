import { resolve } from 'node:path';

export const ROOT = process.cwd();
export const DATA_DIR = resolve(ROOT, '.data/pg');
export const DB_HOST = '127.0.0.1';
export const DB_PORT = 54329;
export const DB_USER = 'postgres';
export const DB_PASSWORD = 'postgres';
export const DEV_DB = 'buzzify';
export const TEST_DB = 'buzzify_test';

export function databaseUrl(name: string): string {
  return `postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${name}`;
}
