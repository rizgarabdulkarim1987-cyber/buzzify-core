import type { Locale } from '@/lib/locale';
import type { TableStatus } from '@/server/domain/pos/table-status';
import type { Names, TillCatalog, TillProduct } from '@/server/pos/till-catalog';

/**
 * Pure rules the till screens share, kept out of the components so they are tested without a browser: the colour of a table,
 * the cash buttons, what a drawer count says, and how the product list is narrowed.
 */

export type TableTone = 'free' | 'busy' | 'ready' | 'bill' | 'pending';

export function tableTone(status: TableStatus): TableTone {
  switch (status) {
    case 'BUSY':
      return 'busy';
    case 'READY':
      return 'ready';
    case 'BILL_REQUESTED':
      return 'bill';
    case 'PENDING_APPROVAL':
      return 'pending';
    default:
      return 'free';
  }
}

/** The steps cash is usually handed over in, in IQD. */
const CASH_STEPS = [1_000, 5_000, 10_000, 25_000, 50_000, 100_000] as const;

/**
 * The cash buttons for a total: the exact amount first, then the total rounded up to the next note a customer is likely to
 * hand over. Ascending, no repeats, at most five. A total of 0 has none (nothing is handed over).
 */
export function quickCash(total: number): number[] {
  if (!Number.isSafeInteger(total) || total <= 0) return [];
  const amounts = new Set<number>([total]);
  for (const step of CASH_STEPS) amounts.add(Math.ceil(total / step) * step);
  return [...amounts].sort((a, b) => a - b).slice(0, 5);
}

export type CountKind = 'exact' | 'surplus' | 'shortage';

/** What a drawer count says: counted minus expected, over, short or exact. */
export function countKind(difference: number): CountKind {
  return difference === 0 ? 'exact' : difference > 0 ? 'surplus' : 'shortage';
}

/** A name in the person's language, else the menu's own language, else any language the item has. */
export function pickName(names: Names, locale: Locale, fallback: Locale): string {
  return names[locale] ?? names[fallback] ?? Object.values(names)[0] ?? '';
}

/** A product that needs the options sheet before it is added: sizes to choose from, or any option group. */
export function needsSheet(product: Pick<TillProduct, 'variants' | 'groups'>): boolean {
  return product.variants.length > 1 || product.groups.length > 0;
}

/**
 * The products of one category (or all, when `categoryId` is null) matching the text in any of their names, in menu order.
 * Case is ignored; the text is matched as typed (no Arabic or Sorani folding beyond what `toLocaleLowerCase` does).
 */
export function visibleProducts(catalog: Pick<TillCatalog, 'products'>, categoryId: string | null, text: string): TillProduct[] {
  const needle = text.trim().toLocaleLowerCase();
  return catalog.products
    .filter((product) => categoryId === null || product.categoryId === categoryId)
    .filter((product) => needle === '' || Object.values(product.names).some((name) => name.toLocaleLowerCase().includes(needle)))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
}

/** Whether a kitchen card was sent long enough ago to warn about: more than `warnMinutes`. */
export function isLate(sentAtMs: number, nowMs: number, warnMinutes = 15): boolean {
  return nowMs - sentAtMs > warnMinutes * 60_000;
}
