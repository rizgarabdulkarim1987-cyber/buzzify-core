import { daypartNow, inDaypart, orderability, productMap, unitPrice } from './catalog';
import {
  MAX_QUANTITY,
  type Bundle,
  type CartBundleInput,
  type CartInput,
  type CartLineInput,
  type Catalog,
  type CatalogProduct,
  type Daypart,
} from './types';

export type QuoteIssueCode =
  | 'UNKNOWN_PRODUCT'
  | 'UNAVAILABLE'
  | 'OUT_OF_STOCK'
  | 'OUT_OF_DAYPART'
  | 'UNKNOWN_VARIANT'
  | 'UNKNOWN_OPTION'
  | 'OPTION_UNAVAILABLE'
  | 'GROUP_MIN'
  | 'GROUP_MAX'
  | 'BAD_QUANTITY'
  | 'UNKNOWN_BUNDLE';

export interface QuoteIssue {
  code: QuoteIssueCode;
  productId?: string;
  optionId?: string;
  groupId?: string;
  bundleId?: string;
}

export interface QuoteLine {
  index: number;
  productId: string;
  variantId: string | null;
  optionIds: string[];
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  issues: QuoteIssue[];
}

export interface QuoteBundleLine {
  index: number;
  bundleId: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  individualTotal: number;
  savings: number;
  issues: QuoteIssue[];
}

export interface Quote {
  currency: string;
  lines: QuoteLine[];
  bundles: QuoteBundleLine[];
  subtotal: number;
  charges: never[];
  hasBlockingIssues: boolean;
}

function validQuantity(quantity: number): boolean {
  return Number.isInteger(quantity) && quantity >= 1 && quantity <= MAX_QUANTITY;
}

function quoteLine(
  products: Map<string, CatalogProduct>,
  current: Daypart | null,
  input: CartLineInput,
  index: number,
): QuoteLine {
  const optionIds = [...new Set(input.optionIds)];
  const base = {
    index,
    productId: input.productId,
    variantId: input.variantId,
    optionIds,
    quantity: input.quantity,
  };
  const product = products.get(input.productId);
  if (!product) {
    return { ...base, unitPrice: 0, lineTotal: 0, issues: [{ code: 'UNKNOWN_PRODUCT', productId: input.productId }] };
  }

  const issues: QuoteIssue[] = [];
  const productId = product.id;
  const quantityOk = validQuantity(input.quantity);
  if (!quantityOk) issues.push({ code: 'BAD_QUANTITY', productId });

  const state = orderability(product, current);
  if (state !== 'OK') issues.push({ code: state, productId });

  if (input.variantId !== null && !product.variants.some((variant) => variant.id === input.variantId)) {
    issues.push({ code: 'UNKNOWN_VARIANT', productId });
  }

  const known = new Map(
    product.groups.flatMap((group) => group.options.map((option) => [option.id, { group, option }] as const)),
  );
  const perGroup = new Map<string, number>();
  const validOptionIds: string[] = [];
  for (const optionId of optionIds) {
    const hit = known.get(optionId);
    if (!hit) {
      issues.push({ code: 'UNKNOWN_OPTION', productId, optionId });
      continue;
    }
    validOptionIds.push(optionId);
    if (!hit.option.isAvailable) issues.push({ code: 'OPTION_UNAVAILABLE', productId, optionId });
    perGroup.set(hit.group.id, (perGroup.get(hit.group.id) ?? 0) + 1);
  }
  for (const group of product.groups) {
    const picked = perGroup.get(group.id) ?? 0;
    if (picked < group.minSelect) issues.push({ code: 'GROUP_MIN', productId, groupId: group.id });
    if (picked > group.maxSelect) issues.push({ code: 'GROUP_MAX', productId, groupId: group.id });
  }

  const price = unitPrice(product, input.variantId, validOptionIds).price;
  const lineTotal = issues.length === 0 && quantityOk ? price * input.quantity : 0;
  return { ...base, unitPrice: price, lineTotal, issues };
}

function bundleIndividualTotal(bundle: Bundle, products: Map<string, CatalogProduct>): number | null {
  let total = 0;
  for (const item of bundle.items) {
    const product = products.get(item.productId);
    if (!product) return null;
    total += unitPrice(product, item.variantId, []).price * item.quantity;
  }
  return total;
}

function quoteBundle(
  bundles: Map<string, Bundle>,
  products: Map<string, CatalogProduct>,
  current: Daypart | null,
  input: CartBundleInput,
  index: number,
): QuoteBundleLine {
  const empty = {
    index,
    bundleId: input.bundleId,
    quantity: input.quantity,
    unitPrice: 0,
    lineTotal: 0,
    individualTotal: 0,
    savings: 0,
  };
  const bundle = bundles.get(input.bundleId);
  if (!bundle) return { ...empty, issues: [{ code: 'UNKNOWN_BUNDLE', bundleId: input.bundleId }] };

  const issues: QuoteIssue[] = [];
  const quantityOk = validQuantity(input.quantity);
  if (!quantityOk) issues.push({ code: 'BAD_QUANTITY', bundleId: bundle.id });
  if (!inDaypart(bundle.dayparts, current)) issues.push({ code: 'OUT_OF_DAYPART', bundleId: bundle.id });

  for (const item of bundle.items) {
    const product = products.get(item.productId);
    if (!product) {
      issues.push({ code: 'UNKNOWN_PRODUCT', bundleId: bundle.id, productId: item.productId });
      continue;
    }
    const state = orderability(product, current);
    if (state !== 'OK') issues.push({ code: state, bundleId: bundle.id, productId: product.id });
  }

  const individualTotal = bundleIndividualTotal(bundle, products) ?? 0;
  const savings = Math.max(0, individualTotal - bundle.price);
  return {
    index,
    bundleId: bundle.id,
    quantity: input.quantity,
    unitPrice: bundle.price,
    lineTotal: issues.length === 0 && quantityOk ? bundle.price * input.quantity : 0,
    individualTotal,
    savings,
    issues,
  };
}

export function quoteCart(catalog: Catalog, cart: CartInput, now: Date): Quote {
  const products = productMap(catalog);
  const bundleById = new Map(catalog.bundles.map((bundle) => [bundle.id, bundle]));
  const current = daypartNow(catalog, now);

  const lines = cart.lines.map((input, index) => quoteLine(products, current, input, index));
  const bundles = cart.bundles.map((input, index) => quoteBundle(bundleById, products, current, input, index));
  const subtotal =
    lines.reduce((sum, line) => sum + line.lineTotal, 0) + bundles.reduce((sum, line) => sum + line.lineTotal, 0);
  const hasBlockingIssues = lines.some((l) => l.issues.length > 0) || bundles.some((b) => b.issues.length > 0);

  return { currency: catalog.currency, lines, bundles, subtotal, charges: [], hasBlockingIssues };
}
