import { headers } from 'next/headers';
import type { PrismaClient } from '@/generated/prisma/client';
import { authFor } from './auth';

/** The id of the session the current request carries, or `null` when it carries none. Never the session's token. */
export async function currentSessionId(prisma: PrismaClient): Promise<string | null> {
  const current = await authFor(prisma).api.getSession({ headers: await headers() });
  return current?.session.id ?? null;
}
