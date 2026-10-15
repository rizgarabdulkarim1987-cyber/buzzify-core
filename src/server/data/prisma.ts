import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';

const globalForPrisma = globalThis as unknown as { __prisma?: PrismaClient };

/** The embedded development database started by `npm run db:up`. Never used in production. */
const DEV_DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:54329/buzzify';

function defaultConnectionString(): string | undefined {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  return process.env.NODE_ENV === 'production' ? undefined : DEV_DATABASE_URL;
}

export function createPrisma(connectionString: string | undefined = defaultConnectionString()): PrismaClient {
  if (!connectionString) throw new Error('DATABASE_URL is not set. Copy .env.example to .env.');
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

export function getPrisma(): PrismaClient {
  globalForPrisma.__prisma ??= createPrisma();
  return globalForPrisma.__prisma;
}
