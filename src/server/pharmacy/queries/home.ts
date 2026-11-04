/* eslint-disable no-restricted-properties -- one read-only aggregate: bound to the actor's restaurantId and branch ids (scopeOf), and it writes nothing */
import { z } from 'zod';
import { Prisma } from '@/generated/prisma/client';
import { baghdadDay, baghdadDayOf, DAY_MS } from '@/lib/baghdad';
import { canPh } from '@/server/domain/pharmacy/permissions';
import { homeWindow, mixAttention, type HomeAttention, type HomeFigures } from '@/server/domain/pharmacy/home';
import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { pharmacyOf } from '@/server/pharmacy/products';
import { assertStaff } from '@/server/pharmacy/receipts';
import { dayOf, scopeOf, SOLD, stamp } from '@/server/pharmacy/reports-common';
import { expiringWhere, expiryToday, lowStockCount, lowStockRows } from '@/server/pharmacy/stock-alerts';
import { defineQuery } from '@/server/studio/framework/query';

/**
 * The home dashboard (pharmacy redesign, task 6): today's and yesterday's sales, today's invoices, the sales series of the
 * period, and the stock alerts with the few items behind them.
 *  - Sales are those the Reports screen counts as sold (COMPLETED, RETURNED_PARTIAL, RETURNED_FULL; never HELD or
 *    HOLD_EXPIRED) at their total, on the Baghdad day they were completed. Returns are their own documents (PhReturn) and
 *    are not subtracted here: this is the Reports' "sales" figure, not its "net".
 *  - Money is in the pharmacy's default currency only (`PhSettings.defaultCurrency`, IQD when unset, as the sale screen
 *    picks it); `otherCurrencies` says sales in another currency were left out.
 *  - Money and invoices are shown only to a role with `report.view` (as the Reports screen); anyone who may view stock
 *    (`catalog.view`) gets the stock alerts.
 *  - Low stock and expiring are the navigation counters' rules (`stock-alerts.ts`).
 * One grouped SQL statement for the sales (at most two rows per day and currency), count and grouped reads for the stock;
 * no sale row is loaded, and at most six balances and six product names for the attention list.
 */

const ATTENTION_EACH = 6;

interface DayRow {
  day: string;
  cur: 'IQD' | 'USD';
  n: number;
  total: bigint;
}

export const homeFigures = defineQuery({
  name: 'ph.home.figures',
  permission: null,
  ph: 'catalog.view',
  input: phPlaceInput.extend({ period: z.enum(['7d', '30d', '12m']).default('7d'), now: z.date() }),
  target: phTargetOf,
  async run(ctx, input): Promise<HomeFigures> {
    const { ph, scoped } = pharmacyOf(ctx);
    assertStaff(ph);
    const branch = input.branchId ? { branchId: input.branchId } : {};
    const salesVisible = canPh(ph.role!, 'report.view');
    const window = homeWindow(input.period, input.now);
    const today = baghdadDayOf(input.now);
    const yesterday = new Date(Date.parse(`${today}T00:00:00.000Z`) - DAY_MS).toISOString().slice(0, 10);

    const [settings, lows, expiring90, soonest] = await Promise.all([
      scoped.phSettings.findFirst({ select: { defaultCurrency: true } }),
      lowStockRows(scoped, branch, input.now),
      scoped.phStockBalance.count({ where: expiringWhere(branch, input.now) }),
      scoped.phStockBalance.findMany({
        where: expiringWhere(branch, input.now),
        orderBy: [{ batch: { expiryDate: 'asc' } }, { id: 'asc' }],
        take: ATTENTION_EACH,
        select: { available: true, reserved: true, quarantine: true, batch: { select: { lot: true, expiryDate: true } }, product: { select: { tradeName: true } } },
      }),
    ]);
    const currency = settings?.defaultCurrency ?? 'IQD';

    let rows: DayRow[] = [];
    if (salesVisible) {
      const scope = scopeOf(ph, input.branchId);
      const start = new Date(Math.min(window.start.getTime(), baghdadDay(yesterday).start.getTime()));
      rows = await scoped.$queryRaw<DayRow[]>(Prisma.sql`
        SELECT ${dayOf(Prisma.sql`s."completedAt"`)} AS "day", s."currency"::text AS "cur", COUNT(*)::int AS "n", SUM(s."totalMinor")::bigint AS "total"
        FROM "PhSale" s
        WHERE s."restaurantId" = ${scope.restaurantId} AND s."branchId" = ANY(${scope.branchIds}::text[]) AND s."status"::text IN ${SOLD}
          AND s."completedAt" >= ${stamp(start)} AND s."completedAt" < ${stamp(window.end)}
        GROUP BY 1, 2`);
    }
    const mine = rows.filter((r) => r.cur === currency);
    const totalOn = (key: (day: string) => boolean) => Number(mine.filter((r) => key(r.day)).reduce((sum, r) => sum + r.total, 0n));
    const series = window.labels.map((label) => ({ label, total: totalOn((day) => day.startsWith(label)) }));

    const expiry: HomeAttention[] = soonest.map((b) => ({
      kind: 'expiry',
      productName: b.product.tradeName,
      detail: b.batch.lot,
      days: Math.round((b.batch.expiryDate.getTime() - expiryToday(input.now).getTime()) / DAY_MS),
      qty: b.available + b.reserved + b.quarantine,
      min: null,
    }));
    const worst = new Map<string, { available: number; minQty: number }>();
    for (const r of lows) {
      const seen = worst.get(r.productId);
      if (!seen || r.available / r.minQty < seen.available / seen.minQty) worst.set(r.productId, r);
    }
    const lowest = [...worst.entries()].sort(([, x], [, y]) => x.available / x.minQty - y.available / y.minQty).slice(0, ATTENTION_EACH);
    const names = lowest.length
      ? new Map((await scoped.phProduct.findMany({ where: { id: { in: lowest.map(([id]) => id) } }, select: { id: true, tradeName: true } })).map((p) => [p.id, p.tradeName]))
      : new Map<string, string>();
    const low: HomeAttention[] = lowest.map(([id, r]) => ({ kind: 'lowStock', productName: names.get(id) ?? '', detail: '', days: null, qty: r.available, min: r.minQty }));

    return {
      currency,
      salesVisible,
      salesToday: totalOn((day) => day === today),
      salesYesterday: totalOn((day) => day === yesterday),
      invoicesToday: mine.filter((r) => r.day === today).reduce((sum, r) => sum + r.n, 0),
      lowStock: lowStockCount(lows),
      expiring90,
      series,
      attention: mixAttention(expiry, low),
      // Yesterday is always inside the period, so every row read is in it.
      otherCurrencies: rows.some((r) => r.cur !== currency),
    };
  },
});
