import { defaultPriceStep, roundToStep } from '@/lib/money-input';

/**
 * Bulk price changes (spec 13.4): set the selected prices to an amount, add or subtract an amount, or add or subtract a
 * percentage. Results are rounded to the menu's step, except a set amount, which is kept as typed. All amounts are in
 * minor units.
 */

export type BulkOperation =
  | { kind: 'set'; amount: number }
  /** May be negative. */
  | { kind: 'add'; amount: number }
  /** 750 is +7.5%; may be negative. */
  | { kind: 'percent'; basisPoints: number };

export interface PriceRow {
  productId: string;
  /** Null for the product's own (base) price. */
  variantId: string | null;
  oldPrice: number;
  newPrice: number;
  /** The change would leave the price at zero or below. */
  problem?: 'NOT_POSITIVE';
}

export interface BulkProduct {
  id: string;
  basePrice: number;
  variants: ReadonlyArray<{ id: string; priceDelta: number }>;
}

export interface BulkPlan {
  /** Every base and size price of the products, old and new, in their order. */
  rows: PriceRow[];
  /** The products whose base price changes. */
  products: Array<{ id: string; basePrice: number }>;
  /** The sizes whose stored difference from the base changes. */
  variants: Array<{ id: string; priceDelta: number }>;
}

/** One price with the operation applied, unrounded. */
function applied(price: number, op: BulkOperation): number {
  if (op.kind === 'set') return op.amount;
  if (op.kind === 'add') return price + op.amount;
  return price + Math.round((price * op.basisPoints) / 10_000);
}

/**
 * One price changed: rounded to the step unless it was set, and flagged when it would be zero or below. A percentage of
 * a free price leaves it free (rounding would otherwise make it cost one step).
 */
function changed(price: number, op: BulkOperation, step: number): { price: number; problem: boolean } {
  if (op.kind === 'percent' && price === 0) return { price: 0, problem: false };
  const raw = applied(price, op);
  if (raw <= 0) return { price: raw, problem: true };
  return { price: op.kind === 'set' ? raw : roundToStep(raw, step), problem: false };
}

/**
 * The new prices of `products` under `op` (refinement 7). The base is `op` applied. With `includeVariants`, each size's
 * own price (base plus difference) is `op` applied too and its difference becomes that minus the new base; without, the
 * differences stay and the sizes move with the base.
 */
export function planBulkPrices(products: readonly BulkProduct[], op: BulkOperation, o: { includeVariants: boolean; step: number }): BulkPlan {
  const plan: BulkPlan = { rows: [], products: [], variants: [] };
  for (const product of products) {
    const base = changed(product.basePrice, op, o.step);
    plan.rows.push({
      productId: product.id,
      variantId: null,
      oldPrice: product.basePrice,
      newPrice: base.price,
      ...(base.problem ? { problem: 'NOT_POSITIVE' as const } : {}),
    });
    if (base.price !== product.basePrice) plan.products.push({ id: product.id, basePrice: base.price });

    for (const variant of product.variants) {
      const oldPrice = product.basePrice + variant.priceDelta;
      const own = o.includeVariants ? changed(oldPrice, op, o.step) : { price: base.price + variant.priceDelta, problem: base.price + variant.priceDelta <= 0 };
      plan.rows.push({
        productId: product.id,
        variantId: variant.id,
        oldPrice,
        newPrice: own.price,
        ...(own.problem ? { problem: 'NOT_POSITIVE' as const } : {}),
      });
      const priceDelta = own.price - base.price;
      if (o.includeVariants && priceDelta !== variant.priceDelta) plan.variants.push({ id: variant.id, priceDelta });
    }
  }
  return plan;
}

/** The step a menu's bulk changes round to: its own, else its currency's default (spec 13.4). */
export function menuPriceStep(menu: { priceStep: number | null; currency: string }): number {
  return menu.priceStep ?? defaultPriceStep(menu.currency);
}
