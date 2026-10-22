import type { PrismaClient } from '@/generated/prisma/client';
import { DEFAULT_APPLICATIONS } from '@/server/domain/billing/catalog';

/**
 * Upserts the products that can be subscribed to. Idempotent. A reseed keeps the status someone chose (an enabled
 * Cashier stays enabled); the names and order are rewritten.
 */
export async function seedApplications(prisma: PrismaClient): Promise<void> {
  for (const app of DEFAULT_APPLICATIONS) {
    await prisma.application.upsert({
      where: { id: app.id },
      create: { id: app.id, name: app.name, status: app.status, sortOrder: app.sortOrder },
      update: { name: app.name, sortOrder: app.sortOrder },
    });
  }
}
