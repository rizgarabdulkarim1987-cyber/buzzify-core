import { currentDaypart } from './schedule';
import type { Catalog, CatalogProduct, Daypart } from './types';

export type Orderability = 'OK' | 'UNAVAILABLE' | 'OUT_OF_STOCK' | 'OUT_OF_DAYPART';

export function productMap(catalog: Catalog): Map<string, CatalogProduct> {
  return new Map(catalog.products.map((product) => [product.id, product]));
}

export function daypartNow(catalog: Catalog, now: Date): Daypart | null {
  return currentDaypart(now, catalog.schedule, catalog.timeZone);
}

/** An empty `dayparts` list means "all day". */
export function inDaypart(dayparts: readonly Daypart[], current: Daypart | null): boolean {
  return dayparts.length === 0 || (current !== null && dayparts.includes(current));
}

export function orderability(product: CatalogProduct, current: Daypart | null): Orderability {
  if (!product.isAvailable) return 'UNAVAILABLE';
  if (product.stockCount !== null && product.stockCount <= 0) return 'OUT_OF_STOCK';
  if (product.hideOutsideDaypart && !inDaypart(product.dayparts, current)) return 'OUT_OF_DAYPART';
  return 'OK';
}

export function defaultVariant(product: CatalogProduct) {
  return product.variants.find((variant) => variant.isDefault) ?? null;
}

export function marginRatio(price: number, cost: number | null): number {
  if (cost === null || price <= 0) return 0.5; // unknown cost is neutral, never guessed
  return Math.min(1, Math.max(0, (price - cost) / price));
}

function addCost(total: number | null, delta: number | null, priceDelta: number): number | null {
  if (total === null) return null;
  if (delta !== null) return total + delta;
  return priceDelta === 0 ? total : null;
}

export function unitPrice(
  product: CatalogProduct,
  variantId: string | null,
  optionIds: readonly string[],
): { price: number; cost: number | null } {
  const variant = variantId
    ? (product.variants.find((candidate) => candidate.id === variantId) ?? null)
    : defaultVariant(product);
  let price = product.basePrice;
  let cost: number | null = product.cost;
  if (variant) {
    price += variant.priceDelta;
    cost = addCost(cost, variant.costDelta, variant.priceDelta);
  }
  const chosen = new Set(optionIds);
  for (const group of product.groups) {
    for (const option of group.options) {
      if (!chosen.has(option.id)) continue;
      price += option.priceDelta;
      cost = addCost(cost, option.costDelta, option.priceDelta);
    }
  }
  return { price: Math.max(0, price), cost };
}
