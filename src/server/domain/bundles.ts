import { daypartNow, defaultVariant, inDaypart, orderability, productMap, unitPrice } from './catalog';
import {
  MAX_QUANTITY,
  type Bundle,
  type CartInput,
  type Catalog,
  type CatalogProduct,
} from './types';

export interface BundleComparison {
  bundleId: string;
  individualTotal: number;
  bundlePrice: number;
  savings: number;
  isDeal: boolean;
}

export interface BundleOpportunity {
  suggestionId: string;
  bundleId: string;
  times: number;
  individualTotal: number;
  bundlePrice: number;
  savings: number;
}

export function compareBundle(catalog: Catalog, bundle: Bundle): BundleComparison | null {
  const products = productMap(catalog);
  let individualTotal = 0;
  for (const item of bundle.items) {
    const product = products.get(item.productId);
    if (!product) return null;
    individualTotal += unitPrice(product, item.variantId, []).price * item.quantity;
  }
  const savings = Math.max(0, individualTotal - bundle.price);
  return { bundleId: bundle.id, individualTotal, bundlePrice: bundle.price, savings, isDeal: savings > 0 };
}

function variantKey(product: CatalogProduct, variantId: string | null): string {
  return variantId ?? defaultVariant(product)?.id ?? '';
}

function slotKey(product: CatalogProduct, variantId: string | null): string {
  return `${product.id}|${variantKey(product, variantId)}`;
}

function availability(catalog: Catalog, cart: CartInput): Map<string, number> {
  const products = productMap(catalog);
  const available = new Map<string, number>();
  for (const line of cart.lines) {
    if (line.optionIds.length > 0) continue;
    const product = products.get(line.productId);
    if (!product) continue;
    const key = slotKey(product, line.variantId);
    available.set(key, (available.get(key) ?? 0) + line.quantity);
  }
  return available;
}

function fullSets(catalog: Catalog, bundle: Bundle, available: Map<string, number>): number {
  const products = productMap(catalog);
  let times = Number.POSITIVE_INFINITY;
  for (const item of bundle.items) {
    const product = products.get(item.productId);
    if (!product) return 0;
    const have = available.get(slotKey(product, item.variantId)) ?? 0;
    times = Math.min(times, Math.floor(have / item.quantity));
  }
  return Number.isFinite(times) ? times : 0;
}

export function detectBundleOpportunities(catalog: Catalog, cart: CartInput, now: Date): BundleOpportunity[] {
  const current = daypartNow(catalog, now);
  const products = productMap(catalog);
  const available = availability(catalog, cart);
  const found: BundleOpportunity[] = [];

  for (const bundle of catalog.bundles) {
    if (!inDaypart(bundle.dayparts, current)) continue;
    const comparison = compareBundle(catalog, bundle);
    if (!comparison || !comparison.isDeal) continue;
    const orderable = bundle.items.every((item) => {
      const product = products.get(item.productId);
      return product !== undefined && orderability(product, current) === 'OK';
    });
    if (!orderable) continue;
    const times = Math.min(MAX_QUANTITY, fullSets(catalog, bundle, available));
    if (times < 1) continue;
    found.push({
      suggestionId: `bundle:${bundle.id}`,
      bundleId: bundle.id,
      times,
      individualTotal: comparison.individualTotal,
      bundlePrice: comparison.bundlePrice,
      savings: comparison.savings * times,
    });
  }
  return found.sort((a, b) => b.savings - a.savings || a.bundleId.localeCompare(b.bundleId));
}

export function applyBundle(cart: CartInput, catalog: Catalog, bundleId: string, times: number): CartInput {
  const bundle = catalog.bundles.find((candidate) => candidate.id === bundleId);
  if (!bundle || !Number.isInteger(times) || times < 1) return cart;
  if (fullSets(catalog, bundle, availability(catalog, cart)) < times) return cart;

  const products = productMap(catalog);
  let lines = cart.lines.map((line) => ({ ...line, optionIds: [...line.optionIds] }));
  for (const item of bundle.items) {
    const product = products.get(item.productId);
    if (!product) return cart;
    const key = slotKey(product, item.variantId);
    let remaining = item.quantity * times;
    lines = lines
      .map((line) => {
        const lineProduct = products.get(line.productId);
        if (remaining === 0 || line.optionIds.length > 0 || !lineProduct) return line;
        if (slotKey(lineProduct, line.variantId) !== key) return line;
        const take = Math.min(line.quantity, remaining);
        remaining -= take;
        return { ...line, quantity: line.quantity - take };
      })
      .filter((line) => line.quantity > 0);
  }

  const existing = cart.bundles.find((entry) => entry.bundleId === bundleId);
  const quantity = Math.min(MAX_QUANTITY, (existing?.quantity ?? 0) + times);
  const others = cart.bundles.filter((entry) => entry.bundleId !== bundleId);
  return { lines, bundles: [...others, { bundleId, quantity }] };
}
