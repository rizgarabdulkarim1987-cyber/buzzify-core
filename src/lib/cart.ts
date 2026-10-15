import type { CartBundleInput, CartInput, CartLineInput } from '@/server/domain/types';
import { MAX_QUANTITY } from '@/server/domain/types';

export const EMPTY_CART: CartInput = { lines: [], bundles: [] };

export function lineKey(line: Pick<CartLineInput, 'productId' | 'variantId' | 'optionIds'>): string {
  return [line.productId, line.variantId ?? '', [...line.optionIds].sort().join(',')].join('|');
}

const clamp = (quantity: number) => Math.min(MAX_QUANTITY, Math.max(0, Math.floor(quantity)));

export function addLine(cart: CartInput, line: CartLineInput): CartInput {
  const key = lineKey(line);
  const existing = cart.lines.find((candidate) => lineKey(candidate) === key);
  if (!existing) {
    return { ...cart, lines: [...cart.lines, { ...line, optionIds: [...line.optionIds], quantity: clamp(line.quantity) }] };
  }
  return {
    ...cart,
    lines: cart.lines.map((candidate) =>
      candidate === existing ? { ...candidate, quantity: clamp(candidate.quantity + line.quantity) } : candidate,
    ),
  };
}

export function setLineQuantity(cart: CartInput, key: string, quantity: number): CartInput {
  const next = clamp(quantity);
  if (next === 0) return removeLine(cart, key);
  return {
    ...cart,
    lines: cart.lines.map((line) => (lineKey(line) === key ? { ...line, quantity: next } : line)),
  };
}

export function removeLine(cart: CartInput, key: string): CartInput {
  return { ...cart, lines: cart.lines.filter((line) => lineKey(line) !== key) };
}

export function setBundleQuantity(cart: CartInput, bundleId: string, quantity: number): CartInput {
  const next = clamp(quantity);
  const others: CartBundleInput[] = cart.bundles.filter((bundle) => bundle.bundleId !== bundleId);
  return { ...cart, bundles: next === 0 ? others : [...others, { bundleId, quantity: next }] };
}

export function itemCount(cart: CartInput): number {
  return (
    cart.lines.reduce((sum, line) => sum + line.quantity, 0) +
    cart.bundles.reduce((sum, bundle) => sum + bundle.quantity, 0)
  );
}

export function isEmpty(cart: CartInput): boolean {
  return cart.lines.length === 0 && cart.bundles.length === 0;
}
