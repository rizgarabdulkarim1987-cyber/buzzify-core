import { baghdadDay, baghdadDayOf, DAY_MS, isCalendarDay } from '@/lib/baghdad';
import type { AnyDb } from '@/server/data/tenant-db';
import { StudioError } from '@/server/studio/framework/result';
import { parseTotalsSnapshot } from './totals-snapshot';

/**
 * A report over a range of Baghdad days with purchases and a margin that is honest about what it knows. Sales are attributed
 * to the day the payment was taken (the daily report attributes by shift). A cost is known only if every ingredient of the sold
 * line had a recorded purchase price at the sale; an unknown cost is `null`, never 0, and no margin is claimed for it.
 */

export const RANGE_MAX_DAYS = 92;

export type RangeProblem = 'rangeOrder' | 'rangeTooLong' | 'invalid';

/** The inclusive day count of a valid range, or the problem. */
export function checkRange(from: string, to: string): { days: number } | { problem: RangeProblem } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || !isCalendarDay(from) || !isCalendarDay(to)) return { problem: 'invalid' };
  const days = Math.round((baghdadDay(to).start.getTime() - baghdadDay(from).start.getTime()) / DAY_MS) + 1;
  if (days < 1) return { problem: 'rangeOrder' };
  if (days > RANGE_MAX_DAYS) return { problem: 'rangeTooLong' };
  return { days };
}

export interface RangeDay {
  day: string;
  grossSales: number;
  refundsTotal: number;
  netSales: number;
  purchasesTotal: number;
}

export interface CostCoverage {
  coveredSales: number;
  coveredCost: number;
  coveredMargin: number;
  uncoveredSales: number;
  uncoveredLines: number;
  soldLines: number;
}

export interface ProductMargin {
  name: string;
  quantity: number;
  sales: number;
  /** Non-null only when every sold line of the product had a known cost. */
  cost: number | null;
  margin: number | null;
  status: 'known' | 'unknownCost' | 'noRecipe' | 'mixed';
}

export interface RangeReport {
  from: string;
  to: string;
  days: RangeDay[];
  totals: { grossSales: number; refundsTotal: number; netSales: number; purchasesTotal: number; purchasesUnpaid: number; purchaseCount: number; wasteCost: number; wasteUnknown: number; coverage: CostCoverage };
  products: ProductMargin[];
}

function addDays(day: string, n: number): string {
  return baghdadDayOf(new Date(baghdadDay(day).start.getTime() + n * DAY_MS + 12 * 3_600_000));
}

export async function readRangeReport(db: AnyDb, restaurantId: string, input: { from: string; to: string }): Promise<RangeReport> {
  const checked = checkRange(input.from, input.to);
  if ('problem' in checked) throw new StudioError('INVALID', checked.problem);
  const start = baghdadDay(input.from).start;
  const end = baghdadDay(input.to).end;
  const [payments, reversals, invoices, waste] = await Promise.all([
    db.posPayment.findMany({ where: { restaurantId, paidAt: { gte: start, lt: end } }, select: { id: true, paidAt: true, totalsSnapshot: true } }),
    db.posPaymentReversal.findMany({ where: { restaurantId, createdAt: { gte: start, lt: end } }, select: { createdAt: true, amount: true } }),
    db.posPurchaseInvoice.findMany({ where: { restaurantId, voidedAt: null, invoiceDay: { gte: input.from, lte: input.to } }, select: { invoiceDay: true, total: true, paidAt: true } }),
    db.posStockMovement.findMany({ where: { restaurantId, kind: 'WASTE', createdAt: { gte: start, lt: end } }, select: { costTotal: true } }),
  ]);
  const sold = await db.posStockMovement.findMany({
    where: { restaurantId, kind: 'SALE', paymentId: { in: payments.map((p) => p.id) } },
    select: { orderLineId: true, costTotal: true },
  });
  const byLine = new Map<string, { cost: number; unknown: boolean }>();
  for (const m of sold) {
    if (m.orderLineId === null) continue;
    const entry = byLine.get(m.orderLineId) ?? { cost: 0, unknown: false };
    if (m.costTotal === null) entry.unknown = true;
    else entry.cost += m.costTotal;
    byLine.set(m.orderLineId, entry);
  }

  const days = new Map<string, RangeDay>();
  for (let day = input.from, i = 0; i < (checked as { days: number }).days; i += 1, day = addDays(input.from, i)) {
    days.set(day, { day, grossSales: 0, refundsTotal: 0, netSales: 0, purchasesTotal: 0 });
  }
  const coverage: CostCoverage = { coveredSales: 0, coveredCost: 0, coveredMargin: 0, uncoveredSales: 0, uncoveredLines: 0, soldLines: 0 };
  const products = new Map<string, { quantity: number; sales: number; cost: number; known: number; unknown: number; none: number }>();
  for (const payment of payments) {
    const snapshot = parseTotalsSnapshot(payment.id, payment.totalsSnapshot);
    days.get(baghdadDayOf(payment.paidAt))!.grossSales += snapshot.total;
    for (const line of snapshot.lines) {
      const entry = byLine.get(line.id);
      const product = products.get(line.name) ?? { quantity: 0, sales: 0, cost: 0, known: 0, unknown: 0, none: 0 };
      product.quantity += line.quantity;
      product.sales += line.lineTotal;
      coverage.soldLines += 1;
      if (entry && !entry.unknown) {
        coverage.coveredSales += line.lineTotal;
        coverage.coveredCost += entry.cost;
        product.cost += entry.cost;
        product.known += 1;
      } else {
        coverage.uncoveredSales += line.lineTotal;
        coverage.uncoveredLines += 1;
        if (entry) product.unknown += 1;
        else product.none += 1;
      }
      products.set(line.name, product);
    }
  }
  coverage.coveredMargin = coverage.coveredSales - coverage.coveredCost;
  for (const r of reversals) days.get(baghdadDayOf(r.createdAt))!.refundsTotal += r.amount;
  let purchasesUnpaid = 0;
  for (const invoice of invoices) {
    days.get(invoice.invoiceDay)!.purchasesTotal += invoice.total;
    if (invoice.paidAt === null) purchasesUnpaid += invoice.total;
  }
  const rows = [...days.values()].map((day) => ({ ...day, netSales: day.grossSales - day.refundsTotal }));
  const sum = (pick: (d: RangeDay) => number) => rows.reduce((total, d) => total + pick(d), 0);
  return {
    from: input.from,
    to: input.to,
    days: rows,
    totals: {
      grossSales: sum((d) => d.grossSales),
      refundsTotal: sum((d) => d.refundsTotal),
      netSales: sum((d) => d.netSales),
      purchasesTotal: sum((d) => d.purchasesTotal),
      purchasesUnpaid,
      purchaseCount: invoices.length,
      wasteCost: waste.reduce((total, m) => total + Math.abs(m.costTotal ?? 0), 0),
      wasteUnknown: waste.filter((m) => m.costTotal === null).length,
      coverage,
    },
    products: [...products]
      .map(([name, p]): ProductMargin => {
        const status = p.known > 0 && p.unknown + p.none === 0 ? 'known' : p.known > 0 ? 'mixed' : p.unknown > 0 ? 'unknownCost' : 'noRecipe';
        return { name, quantity: p.quantity, sales: p.sales, cost: status === 'known' ? p.cost : null, margin: status === 'known' ? p.sales - p.cost : null, status };
      })
      .sort((a, b) => b.sales - a.sales || (a.name < b.name ? -1 : 1)),
  };
}
