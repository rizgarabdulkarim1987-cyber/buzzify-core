import type { Prisma } from '@/generated/prisma/client';
import type { ScopedClient } from '@/server/data/tenant-db';
import { utcToday } from '@/server/domain/pharmacy/expiry';

/**
 * The two stock alerts the navigation counters and the home dashboard share, so a badge, a KPI and the list behind them
 * never disagree. Both follow the Stock and Expiry screens:
 *  - low stock is the stock screen's `lowStock` filter: a product with a minimum above 0 whose sellable stock (`available`
 *    of an ACTIVE, unexpired batch) in a branch shown is below that minimum; one product counts once however many branches.
 *  - expiring is the expiry screen's 30, 60 and 90 day totals at its default 90 day horizon: (batch, branch) rows holding
 *    stock in available, reserved or quarantine whose band is d30, d60 or d90. Expired rows are the screen's own "expired"
 *    total and are not counted here; a MONTH batch counts from the start of its last month, as `expiryBand` says.
 */

const DAY_MS = 86_400_000;
export const EXPIRING_DAYS = 90;
const WITH_STOCK = [{ available: { gt: 0 } }, { reserved: { gt: 0 } }, { quarantine: { gt: 0 } }];

const utcDay = (text: string, addDays = 0) => new Date(new Date(`${text}T00:00:00.000Z`).getTime() + addDays * DAY_MS);

/** The day expiry is measured from (the expiry screen's: the UTC calendar day of `now`). */
export const expiryToday = (now: Date) => utcDay(utcToday(now));

type Branch = { branchId?: string };

/** The stock balances (batch, branch) that count as expiring within 90 days and not yet expired. */
export function expiringWhere(branch: Branch, now: Date): Prisma.PhStockBalanceWhereInput {
  const today = expiryToday(now);
  const horizon = utcDay(utcToday(now), EXPIRING_DAYS);
  // A MONTH batch (stored as its last day) alerts from its first day: it is in once its month starts by the horizon.
  const horizonMonthEnd = new Date(Date.UTC(horizon.getUTCFullYear(), horizon.getUTCMonth() + 1, 0));
  return {
    ...branch,
    OR: WITH_STOCK,
    batch: {
      OR: [
        { expiryPrecision: 'DAY', expiryDate: { gte: today, lte: horizon } },
        { expiryPrecision: 'MONTH', expiryDate: { gte: today, lte: horizonMonthEnd } },
      ],
    },
  };
}

/** Each (product, branch) below its minimum, with its sellable stock: grouped and narrow reads, no batch row loaded. */
export async function lowStockRows(scoped: ScopedClient, branch: Branch, now: Date): Promise<Array<{ productId: string; branchId: string; available: number; minQty: number }>> {
  const [sellable, minimums] = await Promise.all([
    scoped.phStockBalance.groupBy({
      by: ['productId', 'branchId'],
      where: { ...branch, batch: { status: 'ACTIVE', expiryDate: { gte: expiryToday(now) } } },
      _sum: { available: true },
    }),
    scoped.phProductBranch.findMany({ where: { ...branch, minQty: { gt: 0 } }, select: { productId: true, branchId: true, minQty: true } }),
  ]);
  const availableAt = new Map(sellable.map((s) => [`${s.productId}|${s.branchId}`, s._sum.available ?? 0]));
  return minimums
    .map((m) => ({ ...m, available: availableAt.get(`${m.productId}|${m.branchId}`) ?? 0 }))
    .filter((m) => m.available < m.minQty);
}

/** How many products are low (one product counts once however many branches). */
export const lowStockCount = (rows: Array<{ productId: string }>) => new Set(rows.map((r) => r.productId)).size;
