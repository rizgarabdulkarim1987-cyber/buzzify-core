import { baghdadMonthOf } from '@/lib/baghdad';
import type { AnyDb } from '@/server/data/tenant-db';
import { AiLimitReachedError } from './errors';

/**
 * Requests per Baghdad calendar month. A request is one user-started AI operation (a whole Ask turn with its tool rounds,
 * one summary, one phrasing, one extraction, one classification batch). The reservation is a conditional increment on one
 * row, so concurrent requests can never pass the limit.
 */

export async function reserveAiRequest(db: AnyDb, restaurantId: string, limit: number, now: Date): Promise<{ month: string }> {
  const month = baghdadMonthOf(now);
  // The row is created once, whoever gets there first; the increment below is what holds the limit.
  await db.posAiUsageMonth.createMany({ data: [{ restaurantId, month }], skipDuplicates: true });
  const { count } = await db.posAiUsageMonth.updateMany({ where: { restaurantId, month, requests: { lt: limit } }, data: { requests: { increment: 1 } } });
  if (count === 0) throw new AiLimitReachedError();
  return { month };
}

/** Gives a reservation back (the provider never answered); never below 0. */
export async function releaseAiRequest(db: AnyDb, restaurantId: string, month: string): Promise<void> {
  await db.posAiUsageMonth.updateMany({ where: { restaurantId, month, requests: { gt: 0 } }, data: { requests: { decrement: 1 } } });
}

export async function addAiTokens(db: AnyDb, restaurantId: string, month: string, inputTokens: number, outputTokens: number): Promise<void> {
  if (inputTokens === 0 && outputTokens === 0) return;
  await db.posAiUsageMonth.updateMany({ where: { restaurantId, month }, data: { inputTokens: { increment: inputTokens }, outputTokens: { increment: outputTokens } } });
}

export async function getAiUsage(db: AnyDb, restaurantId: string, limit: number, now: Date): Promise<{ month: string; used: number; limit: number }> {
  const month = baghdadMonthOf(now);
  const row = await db.posAiUsageMonth.findUnique({ where: { restaurantId_month: { restaurantId, month } }, select: { requests: true } });
  return { month, used: row?.requests ?? 0, limit };
}
