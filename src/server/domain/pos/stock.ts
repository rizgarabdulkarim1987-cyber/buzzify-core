/**
 * Stock quantities and costs as pure integer math. A quantity is an integer in the item's smallest unit (grams,
 * millilitres, pieces); money is integer IQD. Nothing here uses a float: typed text is read with string and integer
 * operations, and a cost is rounded half up once, in BigInt.
 */

export const STOCK_UNITS = ['GRAM', 'MILLILITER', 'PIECE'] as const;
export type StockUnitKey = (typeof STOCK_UNITS)[number];

/** How a supplier invoice was paid, when it was. */
export const SUPPLIER_PAY_METHODS = ['CASH', 'BANK', 'ZAINCASH', 'FIB', 'QICARD', 'OTHER'] as const;

/** One movement is at most 10 t or 10,000 L (or that many pieces). */
export const MAX_MOVEMENT = 10_000_000;
const INT32_MAX = 2_147_483_647;

export type DisplayUnit = 'g' | 'kg' | 'ml' | 'l' | 'pcs';

export function displayUnitsFor(unit: StockUnitKey): DisplayUnit[] {
  if (unit === 'GRAM') return ['kg', 'g'];
  if (unit === 'MILLILITER') return ['l', 'ml'];
  return ['pcs'];
}

/** The smallest-unit factor of a display unit: 1000 for kg and l, else 1. */
function factorOf(display: DisplayUnit): number {
  return display === 'kg' || display === 'l' ? 1000 : 1;
}

function latinDigits(text: string): string {
  return text.replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0));
}

/**
 * Reads what a person typed as a quantity in the item's smallest unit, or null. Arabic-Indic and Eastern Arabic-Indic digits
 * are accepted, and `.`, `٫` and `,` as the one decimal mark; a thousands separator is refused (so "1,500" g is not 1.5), and
 * so is more decimals than the unit has (3 for kg and l, none otherwise): nothing is rounded.
 */
export function parseQuantity(text: string, unit: StockUnitKey, display: DisplayUnit): number | null {
  if (!displayUnitsFor(unit).includes(display)) return null;
  const match = /^(-?)(\d+)(?:[.٫,](\d+))?$/.exec(latinDigits(text.trim()));
  if (!match) return null;
  const [, sign, whole, fraction = ''] = match;
  const factor = factorOf(display);
  const decimals = factor === 1000 ? 3 : 0;
  if (fraction.length > decimals) return null;
  if (whole!.length > 9) return null;
  const scaled = Number.parseInt(whole!, 10) * factor + (fraction === '' ? 0 : Number.parseInt(fraction.padEnd(decimals, '0'), 10));
  if (scaled > MAX_MOVEMENT) return null;
  return sign === '-' ? (scaled === 0 ? 0 : -scaled) : scaled;
}

/** A quantity for display: kg or l from 1000 up, with up to 3 decimals and no trailing zeros. Latin digits. */
export function formatQuantity(quantity: number, unit: StockUnitKey): { value: string; unit: DisplayUnit } {
  if (unit === 'PIECE') return { value: String(quantity), unit: 'pcs' };
  const base: DisplayUnit = unit === 'GRAM' ? 'g' : 'ml';
  if (Math.abs(quantity) < 1000) return { value: String(quantity), unit: base };
  const sign = quantity < 0 ? '-' : '';
  const abs = Math.abs(quantity);
  const whole = Math.trunc(abs / 1000);
  const rest = String(abs % 1000).padStart(3, '0').replace(/0+$/, '');
  return { value: `${sign}${whole}${rest === '' ? '' : `.${rest}`}`, unit: unit === 'GRAM' ? 'kg' : 'l' };
}

/** IQD paid for `quantity` units of cost: the item's last cost, kept as two integers so no fraction is stored. */
export interface LastCost {
  amount: number;
  quantity: number;
}

/** The cost of `quantity` units at a last cost, rounded half up to integer IQD; null when there is no cost. */
export function costOf(quantity: number, cost: LastCost | null): number | null {
  if (cost === null) return null;
  if (!Number.isSafeInteger(quantity) || quantity < 0 || !Number.isSafeInteger(cost.amount) || cost.amount < 0 || !Number.isSafeInteger(cost.quantity) || cost.quantity < 1) {
    throw new RangeError('A cost needs whole, non-negative numbers');
  }
  const d = BigInt(cost.quantity);
  const result = (2n * BigInt(quantity) * BigInt(cost.amount) + d) / (2n * d);
  if (result > BigInt(INT32_MAX)) throw new RangeError('The cost is too large');
  return Number(result);
}

/** The rounded IQD per kg, per L or per piece, for display only (never stored). */
export function unitCostLabel(cost: LastCost, unit: StockUnitKey): number {
  return costOf(unit === 'PIECE' ? 1 : 1000, cost) as number;
}

/** The key a name is unique by: trimmed, inner whitespace collapsed, lower-cased. */
export function nameKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
}

/** Whether an item is low: negative (a count is needed) or at or under a reorder level that is set. */
export function stockState(onHand: number, reorderLevel: number): 'negative' | 'low' | 'ok' {
  if (onHand < 0) return 'negative';
  if (reorderLevel > 0 && onHand <= reorderLevel) return 'low';
  return 'ok';
}
