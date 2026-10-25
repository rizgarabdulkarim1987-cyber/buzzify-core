import type { AnyDb } from '@/server/data/tenant-db';
import { AiNotEnabledError } from './errors';

/**
 * What the Super Admin switched on for a restaurant. Read from the local row on every AI request; Core is never contacted
 * at sale time or at AI time. A limit of 0 with the package on means "no requests left this month", never "unlimited".
 */
export interface AiPackage {
  enabled: boolean;
  monthlyLimit: number;
  syncedAt: Date | null;
}

const OFF: AiPackage = { enabled: false, monthlyLimit: 0, syncedAt: null };

export async function getAiPackage(db: AnyDb, restaurantId: string): Promise<AiPackage> {
  const row = await db.posAiPackage.findUnique({ where: { restaurantId }, select: { enabled: true, monthlyLimit: true, syncedAt: true } });
  return row ?? OFF;
}

/** Writes the package (stamping `syncedAt`); turning it off keeps the stored limit unless one is given. Returns before and after. */
export async function writeAiPackage(
  db: AnyDb,
  restaurantId: string,
  input: { enabled: boolean; monthlyLimit?: number; now?: Date },
): Promise<{ before: AiPackage; after: AiPackage }> {
  const before = await getAiPackage(db, restaurantId);
  const monthlyLimit = input.monthlyLimit ?? before.monthlyLimit;
  const syncedAt = input.now ?? new Date();
  await db.posAiPackage.upsert({
    where: { restaurantId },
    create: { restaurantId, enabled: input.enabled, monthlyLimit, syncedAt },
    update: { enabled: input.enabled, monthlyLimit, syncedAt },
  });
  return { before, after: { enabled: input.enabled, monthlyLimit, syncedAt } };
}

/** The first statement of every AI service: refuses before any other read when the package is off. */
export async function requireAi(db: AnyDb, restaurantId: string): Promise<AiPackage> {
  const pkg = await getAiPackage(db, restaurantId);
  if (!pkg.enabled) throw new AiNotEnabledError();
  return pkg;
}
