/** The largest amount the database stores (a Postgres Int), as INT32_MAX in the services. */
const MAX_AMOUNT = 2_147_483_647;

/** The banknotes a customer usually hands over are multiples of these, in IQD. */
const NOTE_STEPS = [1000, 5000, 10_000, 25_000, 50_000, 100_000] as const;

/**
 * The quick buttons for the cash received: the exact total first, then the next multiple of each common note above it
 * (10,395 gives 11,000, 15,000, 20,000, 25,000). No amount appears twice.
 */
export function quickCashAmounts(total: number, max = 5): number[] {
  const amounts = [total];
  for (const step of NOTE_STEPS) {
    const next = (Math.floor(total / step) + 1) * step;
    if (total > 0 && !amounts.includes(next)) amounts.push(next);
  }
  return amounts.slice(0, max);
}

const DIGITS: Record<string, string> = {
  '٠': '0',
  '١': '1',
  '٢': '2',
  '٣': '3',
  '٤': '4',
  '٥': '5',
  '٦': '6',
  '٧': '7',
  '٨': '8',
  '٩': '9',
  '۰': '0',
  '۱': '1',
  '۲': '2',
  '۳': '3',
  '۴': '4',
  '۵': '5',
  '۶': '6',
  '۷': '7',
  '۸': '8',
  '۹': '9',
};

/**
 * A whole amount of dinars typed by the cashier, or null when it is not one. Arabic-Indic and Persian digits (from an
 * Arabic or Kurdish keyboard) count as digits; commas, the Arabic thousands mark and spaces are ignored.
 */
export function parseAmount(text: string): number | null {
  const plain = text.replace(/[٠-٩۰-۹]/g, (d) => DIGITS[d]).replace(/[,\s٬]/g, '');
  if (!/^\d{1,10}$/.test(plain)) return null;
  const value = Number(plain);
  return value <= MAX_AMOUNT ? value : null;
}

/** The quick buttons for the cash in the drawer when a shift opens, in IQD. */
export const OPENING_FLOAT_AMOUNTS = [0, 25_000, 50_000, 100_000] as const;

export type DifferenceKind = 'surplus' | 'shortage' | 'exact';

/** What a counted-minus-expected difference is called: more cash than expected, less, or exactly right. */
export function differenceKind(difference: number): DifferenceKind {
  if (difference > 0) return 'surplus';
  if (difference < 0) return 'shortage';
  return 'exact';
}
