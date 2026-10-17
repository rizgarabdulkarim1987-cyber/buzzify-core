import 'dotenv/config';
import { defineConfig } from 'prisma/config';

/**
 * Where Prisma's commands (migrate, seed) connect. In production the app itself uses the pooled `DATABASE_URL`, but
 * migrations need a direct connection, so `DIRECT_DATABASE_URL` comes first. Unset (or blank) in development, where both
 * fall back to the embedded database that `npm run db:up` starts.
 */
const url =
  [process.env.DIRECT_DATABASE_URL, process.env.DATABASE_URL].find((value) => value?.trim()) ??
  'postgresql://postgres:postgres@127.0.0.1:54329/buzzify';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'tsx prisma/seed.ts' },
  datasource: { url },
});
