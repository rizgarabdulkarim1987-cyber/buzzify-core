import { baghdadDay, baghdadDayOf, DAY_MS } from '@/lib/baghdad';

/**
 * The home dashboard's figures, as pure data and functions (pharmacy redesign, task 6). The query in
 * `src/server/pharmacy/queries/home.ts` fills them; the screen in `src/app/pharmacy/_ui/HomeDashboard.tsx` draws them.
 */

export type HomePeriod = '7d' | '30d' | '12m';
export const HOME_PERIODS: readonly HomePeriod[] = ['7d', '30d', '12m'];

export interface HomeAttention {
  kind: 'expiry' | 'lowStock';
  productName: string;
  /** Expiry: the batch's lot. Low stock: empty. */
  detail: string;
  /** Expiry: whole days from today to the expiry date (0 is today). Low stock: null. */
  days: number | null;
  /** Expiry: the days the batch is alerted by (`urgencyDays`: a MONTH batch counts to the start of its month), which sets its colour. Low stock: null. */
  urgency: number | null;
  /** Expiry: the batch's units in stock (available, reserved and quarantine). Low stock: the sellable units on hand. */
  qty: number;
  /** Low stock: the product's minimum in that branch. Expiry: null. */
  min: number | null;
}

/**
 * Money is in minor units of `currency` (the pharmacy's default currency) as a JavaScript number. The sales tables store
 * BigInt minor units; a number is exact up to 2^53 - 1 (about 9 * 10^15), far beyond any pharmacy's sales in a year in IQD
 * (no minor digits) or USD cents, so the conversion is safe. Sales in any other currency are left out (`otherCurrencies`).
 */
export interface HomeFigures {
  currency: 'IQD' | 'USD';
  /** False for a role without `report.view`: every money and invoice figure is then 0 and the screen hides them. */
  salesVisible: boolean;
  salesToday: number;
  salesYesterday: number;
  invoicesToday: number;
  lowStock: number;
  expiring90: number;
  /** One point per Baghdad day ('YYYY-MM-DD', 7d and 30d) or month ('YYYY-MM', 12m), oldest first, zeros included. */
  series: { label: string; total: number }[];
  attention: HomeAttention[];
  /** Completed sales in another currency exist in the window and are not in these figures. */
  otherCurrencies: boolean;
}

/** The labels of a period's series and the instants it covers (Baghdad calendar, end exclusive). */
export function homeWindow(period: HomePeriod, now: Date): { labels: string[]; start: Date; end: Date } {
  const today = baghdadDayOf(now);
  const end = baghdadDay(today).end;
  if (period === '12m') {
    const [y, m] = today.split('-').map(Number);
    const labels = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(Date.UTC(y, m - 12 + i, 1));
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    });
    return { labels, start: baghdadDay(`${labels[0]}-01`).start, end };
  }
  const days = period === '30d' ? 30 : 7;
  const startOfToday = Date.parse(`${today}T00:00:00.000Z`);
  const labels = Array.from({ length: days }, (_, i) => new Date(startOfToday - (days - 1 - i) * DAY_MS).toISOString().slice(0, 10));
  return { labels, start: baghdadDay(labels[0]!).start, end };
}

/** Up to `max` items: half of each kind, the rest from whichever kind has more. Each list arrives most urgent first. */
export function mixAttention(expiry: HomeAttention[], low: HomeAttention[], max = 6): HomeAttention[] {
  const half = Math.floor(max / 2);
  const e = Math.min(expiry.length, Math.max(half, max - low.length));
  const l = Math.min(low.length, max - e);
  return [...expiry.slice(0, e), ...low.slice(0, l)];
}
