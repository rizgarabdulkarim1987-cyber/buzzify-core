import { expiryBand, type ExpiryBand } from '@/server/domain/pharmacy/expiry';
import type { Translate } from '@/lib/i18n';
import { formatNumber } from '@/lib/pos-format';
import type { ProductBalance } from '@/server/pharmacy/stock-reads';

/** The stock list's filter chips, in their order; the page reads the choice from `?filter=`. */
export const STOCK_FILTERS = ['all', 'low', 'expiring', 'out'] as const;
export type StockFilter = (typeof STOCK_FILTERS)[number];

export function parseStockFilter(raw: string | undefined): StockFilter {
  return typeof raw === 'string' && (STOCK_FILTERS as readonly string[]).includes(raw) ? (raw as StockFilter) : 'all';
}

/** The stock query's option for a filter (`ph.stock.balances`). */
export function filterQuery(filter: StockFilter): { lowStock?: true; expiring?: true; outOfStock?: true } {
  if (filter === 'low') return { lowStock: true };
  if (filter === 'expiring') return { expiring: true };
  if (filter === 'out') return { outOfStock: true };
  return {};
}

export type StockState = 'out' | 'low' | 'expiring' | 'ok';
const SOON: ReadonlySet<ExpiryBand> = new Set(['d30', 'd60', 'd90']);

/**
 * One row's status pill, worst first, by the same rules as the filters: out (nothing sellable in the branches shown), low
 * (a branch below its minimum), expiring (a batch holding stock that expires within 90 days, not yet expired), else ok.
 */
export function stockState(product: ProductBalance, today: string): StockState {
  if (product.branches.reduce((sum, b) => sum + b.sellable, 0) <= 0) return 'out';
  if (product.branches.some((b) => b.minQty > 0 && b.sellable < b.minQty)) return 'low';
  const holding = (p: ProductBalance['batches'][number]) => p.buckets.some((b) => b.available + b.reserved + b.quarantine > 0);
  if (product.batches.some((b) => holding(b) && SOON.has(expiryBand(b, today)))) return 'expiring';
  return 'ok';
}

/** The sellable quantity of a row: the sum over the branches shown, in base units. */
export const sellableTotal = (product: ProductBalance): number => product.branches.reduce((sum, b) => sum + b.sellable, 0);

/** "1,003 products": the plural form follows the language's rules (Arabic has six), the number keeps its grouping. */
export const productCount = (t: Translate, total: number): string => t('pharmacy.stock.count', { count: total, n: formatNumber(total) });
