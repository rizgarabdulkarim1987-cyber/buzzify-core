import { baghdadDay } from '@/lib/baghdad';
import type { AnyDb } from '@/server/data/tenant-db';
import { StudioError } from '@/server/studio/framework/result';
import { legsOf } from './payment-legs';
import { checkRange } from './range-report';
import { parseTotalsSnapshot } from './totals-snapshot';

/**
 * What the range report's sales are made of: by Baghdad hour, by item, by staff member and by payment method. Every
 * breakdown adds up to the range report's gross sales (payments taken in the days), refunds not taken off.
 */

export interface SalesBreakdown {
  byHour: { hour: number; orders: number; total: number }[];
  byItem: { name: string; quantity: number; total: number }[];
  byStaff: { userId: string; name: string; orders: number; total: number }[];
  byMethod: { method: string; orders: number; total: number }[];
}

/** Baghdad is UTC+3 all year. */
const BAGHDAD_OFFSET_HOURS = 3;

export async function readSalesBreakdown(db: AnyDb, restaurantId: string, input: { from: string; to: string }): Promise<SalesBreakdown> {
  const checked = checkRange(input.from, input.to);
  if ('problem' in checked) throw new StudioError('INVALID', checked.problem);
  const payments = await db.posPayment.findMany({
    where: { restaurantId, paidAt: { gte: baghdadDay(input.from).start, lt: baghdadDay(input.to).end } },
    select: { id: true, paidAt: true, method: true, amountReceived: true, reference: true, userId: true, totalsSnapshot: true, legs: { select: { method: true, amount: true, tendered: true, reference: true } } },
  });
  const names = new Map<string, string>();
  const userIds = [...new Set(payments.flatMap((p) => (p.userId ? [p.userId] : [])))];
  if (userIds.length > 0) for (const user of await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })) names.set(user.id, user.name);

  const hours = new Map<number, { orders: number; total: number }>();
  const items = new Map<string, { quantity: number; total: number }>();
  const staff = new Map<string, { orders: number; total: number }>();
  const methods = new Map<string, { orders: number; total: number }>();
  const add = <K,>(map: Map<K, { orders: number; total: number }>, key: K, total: number) => {
    const entry = map.get(key) ?? { orders: 0, total: 0 };
    entry.orders += 1;
    entry.total += total;
    map.set(key, entry);
  };
  for (const payment of payments) {
    const snapshot = parseTotalsSnapshot(payment.id, payment.totalsSnapshot);
    add(hours, (payment.paidAt.getUTCHours() + BAGHDAD_OFFSET_HOURS) % 24, snapshot.total);
    add(staff, payment.userId ?? '', snapshot.total);
    for (const leg of legsOf(payment, snapshot.total)) add(methods, leg.method, leg.amount);
    // The bill's total also holds the invoice discount, service, tax and delivery fee; they are spread over the lines in
    // proportion (the last line takes the rounding) so the items add up to the same gross sales as every other table.
    const lineSum = snapshot.lines.reduce((sum, line) => sum + line.lineTotal, 0);
    let spread = 0;
    snapshot.lines.forEach((line, i) => {
      const last = i === snapshot.lines.length - 1;
      const share = lineSum === 0 ? 0 : last ? snapshot.total - spread : Math.round((snapshot.total * line.lineTotal) / lineSum);
      spread += share;
      const item = items.get(line.name) ?? { quantity: 0, total: 0 };
      item.quantity += line.quantity;
      item.total += share;
      items.set(line.name, item);
    });
  }
  return {
    byHour: [...hours].map(([hour, v]) => ({ hour, ...v })).sort((x, y) => x.hour - y.hour),
    byItem: [...items].map(([name, v]) => ({ name, ...v })).sort((x, y) => y.total - x.total || x.name.localeCompare(y.name)),
    byStaff: [...staff].map(([userId, v]) => ({ userId, name: names.get(userId) ?? '', ...v })).sort((x, y) => y.total - x.total || x.name.localeCompare(y.name)),
    byMethod: [...methods].map(([method, v]) => ({ method, ...v })).sort((x, y) => y.total - x.total || x.method.localeCompare(y.method)),
  };
}
