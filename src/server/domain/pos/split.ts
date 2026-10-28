import { roundTo } from './rounding';
import type { Totals } from './totals';

/** A live (not cancelled) line of the order: what it adds to the subtotal and whether a payment already took it. */
export interface SplitLine {
  id: string;
  total: number;
  paid: boolean;
}

/** What earlier parts of the same bill already took of each component. */
export interface PaidComponents {
  invoiceDiscount: number;
  service: number;
  tax: number;
  deliveryFee: number;
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

/**
 * The totals of one guest's part of a bill: the chosen lines' own subtotal, plus a share of the invoice discount, service,
 * tax and delivery fee in proportion to that subtotal. The part that takes the last unpaid lines gets exactly what is left of
 * each component, so all parts add up to the bill to the dinar whatever the rounding did on the way. With a rounding step the
 * part's `total` is the payable amount (rounded half up on its own) and `rounding` the signed difference it made.
 */
export function partTotals(full: Totals, lines: readonly SplitLine[], chosen: readonly string[], already: PaidComponents, step = 0): Totals & { rounding: number } {
  const picked = new Set(chosen);
  const part = lines.filter((line) => picked.has(line.id));
  const subtotal = sum(part.map((line) => line.total));
  const last = lines.filter((line) => !line.paid).every((line) => picked.has(line.id));
  const share = full.subtotal > 0 ? subtotal / full.subtotal : lines.length > 0 ? part.length / lines.length : 0;
  const spread = (whole: number, taken: number) => {
    const left = Math.max(0, whole - taken);
    return last ? left : Math.min(Math.round(whole * share), left);
  };
  const invoiceDiscount = spread(full.invoiceDiscount, already.invoiceDiscount);
  const service = spread(full.service, already.service);
  const tax = spread(full.tax, already.tax);
  const deliveryFee = spread(full.deliveryFee, already.deliveryFee);
  const payable = roundTo(subtotal - invoiceDiscount + service + tax + deliveryFee, step);
  return { subtotal, invoiceDiscount, service, tax, deliveryFee, total: payable.total, rounding: payable.rounding };
}
