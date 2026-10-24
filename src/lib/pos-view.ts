import type { Locale } from '@/lib/locale';
import { parseAmount } from '@/server/domain/pos/cash';
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

const INDIC: Record<string, string> = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9', '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9' };

/** What an amount field keeps while it is typed: Latin digits only (Arabic-Indic and Persian ones converted), at most nine. */
export function amountDigits(text: string): string {
  return text.replace(/[٠-٩۰-۹]/g, (d) => INDIC[d]!).replace(/\D/g, '').slice(0, 9);
}

/** A typed whole amount of dinars, or null when the field is empty or not an amount: an empty count is not a count of 0. */
export function typedAmount(text: string): number | null {
  return text.trim() === '' ? null : parseAmount(text);
}
