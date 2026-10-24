export type Discount = { kind: 'AMOUNT' | 'PERCENT'; value: number };

export type PricedLine = {
  unitPrice: number;
  optionsTotal: number;
  quantity: number;
  discount?: Discount;
  cancelled?: boolean;
};

/** 0 means disabled. */
export type Rates = { serviceRatePercent: number; taxRatePercent: number };

export type Totals = {
  subtotal: number;
  invoiceDiscount: number;
  service: number;
  tax: number;
  /** The delivery fee: added after tax, never discounted, taxed or service-charged. 0 for dine-in and takeaway. */
  deliveryFee: number;
  total: number;
};

function percentOf(base: number, percent: number): number {
  return Math.floor((base * percent) / 100);
}

/** Discount amount in whole IQD, clamped to [0, base]. */
function discountAmount(base: number, discount: Discount | undefined): number {
  if (!discount) return 0;
  const raw =
    discount.kind === 'PERCENT'
      ? percentOf(base, Math.min(Math.max(discount.value, 0), 100))
      : Math.floor(discount.value);
  return Math.min(Math.max(raw, 0), base);
}

function lineGross(line: PricedLine): number {
  return (line.unitPrice + line.optionsTotal) * line.quantity;
}

/** The amount the line's own discount takes off its gross, in whole IQD: gross = lineTotal + lineDiscount. */
export function lineDiscount(line: PricedLine): number {
  return discountAmount(lineGross(line), line.discount);
}

/** What one line adds to the subtotal: its gross minus its own discount. A cancelled line still has this amount. */
export function lineTotal(line: PricedLine): number {
  return lineGross(line) - lineDiscount(line);
}

/**
 * What the cashier hands back for a cash payment: the cash received minus the total, or null when the cash does not
 * cover the total. payOrder and the payment screen both use it, so the change shown is the change recorded.
 */
export function cashChange(total: number, received: number): number | null {
  return received >= total ? received - total : null;
}

export function computeTotals(
  lines: PricedLine[],
  invoiceDiscount: Discount | undefined,
  rates: Rates,
  deliveryFee = 0,
): Totals {
  if (!Number.isSafeInteger(deliveryFee) || deliveryFee < 0) throw new RangeError(`The delivery fee must be an integer of 0 or more, got ${deliveryFee}`);
  let subtotal = 0;
  for (const line of lines) {
    if (!line.cancelled) subtotal += lineTotal(line);
  }
  const discount = discountAmount(subtotal, invoiceDiscount);
  const afterDiscount = subtotal - discount;
  const service = percentOf(afterDiscount, rates.serviceRatePercent);
  const tax = percentOf(afterDiscount + service, rates.taxRatePercent);
  return {
    subtotal,
    invoiceDiscount: discount,
    service,
    tax,
    deliveryFee,
    total: afterDiscount + service + tax + deliveryFee,
  };
}
