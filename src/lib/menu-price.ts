import type { MenuProductView } from '@/server/data/menu-view';

/** Mirrors the server's `unitPrice` for display. The cart always uses the server quote. */
export function unitPriceFromMenu(
  product: Pick<MenuProductView, 'basePrice' | 'groups' | 'variants'>,
  variantId: string | null,
  optionIds: readonly string[],
): number {
  const variant = variantId
    ? product.variants.find((candidate) => candidate.id === variantId)
    : product.variants.find((candidate) => candidate.isDefault);
  let price = product.basePrice + (variant?.priceDelta ?? 0);
  const chosen = new Set(optionIds);
  for (const group of product.groups) {
    for (const option of group.options) {
      if (chosen.has(option.id)) price += option.priceDelta;
    }
  }
  return Math.max(0, price);
}
