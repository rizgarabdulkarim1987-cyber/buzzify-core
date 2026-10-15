import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';

const globalForPrisma = globalThis as unknown as { __prisma?: PrismaClient };

export function createPrisma(connectionString: string | undefined = process.env.DATABASE_URL): PrismaClient {
  if (!connectionString) throw new Error('DATABASE_URL is not set. Copy .env.example to .env.');
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

export function getPrisma(): PrismaClient {
  globalForPrisma.__prisma ??= createPrisma();
  return globalForPrisma.__prisma;
}
