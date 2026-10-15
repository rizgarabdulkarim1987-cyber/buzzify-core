import { daypartNow, inDaypart, marginRatio, orderability, productMap } from './catalog';
import type { EngineConfig } from './config';
import { resolveText } from './translate';
import type { CartInput, Catalog, CatalogProduct, Locale } from './types';

export interface PairingInput {
  catalog: Catalog;
  cart: CartInput;
  dismissedIds: readonly string[];
  now: Date;
  locale: Locale;
  config: EngineConfig;
  maxOffers?: number;
}

export interface PairingOffer {
  suggestionId: string;
  productId: string;
  reason: string;
  score: number;
  reasons: string[];
}

const round4 = (value: number) => Math.round(value * 10_000) / 10_000;

interface Contribution {
  value: number;
  reason: string;
  weight: number;
}

export function suggestPairings(input: PairingInput): PairingOffer[] {
  const { catalog, cart, now, locale, config } = input;
  const products = productMap(catalog);
  const current = daypartNow(catalog, now);
  const w = config.weights;

  const inCart = new Set<string>(cart.lines.map((line) => line.productId));
  for (const entry of cart.bundles) {
    const bundle = catalog.bundles.find((candidate) => candidate.id === entry.bundleId);
    for (const item of bundle?.items ?? []) inCart.add(item.productId);
  }
  const cartProducts = [...inCart]
    .map((id) => products.get(id))
    .filter((product): product is CatalogProduct => product !== undefined);
  if (cartProducts.length === 0) return [];

  const filledSlots = new Set(cartProducts.map((p) => p.slot).filter((slot): slot is string => slot !== null));
  const dismissed = new Set(input.dismissedIds);
  const contributions = new Map<string, Contribution[]>();

  for (const rule of catalog.pairingRules) {
    if (!inDaypart(rule.dayparts, current)) continue;
    const matches = cartProducts.filter((p) =>
      rule.sourceType === 'PRODUCT' ? p.id === rule.sourceProductId : p.categoryId === rule.sourceCategoryId,
    ).length;
    if (matches === 0) continue;

    const target = products.get(rule.targetProductId);
    if (!target || inCart.has(target.id)) continue;
    if (orderability(target, current) !== 'OK' || !inDaypart(target.dayparts, current)) continue;
    if (target.slot !== null && filledSlots.has(target.slot)) continue;
    if (dismissed.has(`pair:${target.id}`)) continue;

    const matchFactor = Math.min(1.5, 1 + 0.25 * (matches - 1));
    const entry: Contribution = {
      value: w.rulePriority * (rule.weight / 100) * matchFactor,
      reason: resolveText(rule.translations, 'reason', locale, catalog.defaultLocale),
      weight: rule.weight,
    };
    contributions.set(target.id, [...(contributions.get(target.id) ?? []), entry]);
  }

  const offers: Array<PairingOffer & { slot: string | null }> = [];
  for (const [targetId, entries] of contributions) {
    const target = products.get(targetId) as CatalogProduct;
    const sorted = [...entries].sort((a, b) => b.value - a.value);
    const rulePart = Math.min(
      w.rulePriority * 1.5,
      sorted.reduce((sum, entry, index) => sum + entry.value * 0.5 ** index, 0),
    );
    const lowStock =
      target.stockCount !== null && target.lowStockThreshold !== null && target.stockCount <= target.lowStockThreshold;
    const margin = marginRatio(target.basePrice, target.cost);
    const score =
      rulePart +
      w.margin * margin +
      w.popularity * (target.popularity / 100) +
      w.priority * (target.priority / 100) -
      (lowStock ? w.stockPenalty : 0);

    offers.push({
      suggestionId: `pair:${target.id}`,
      productId: target.id,
      reason: sorted[0]?.reason ?? '',
      score: round4(score),
      reasons: [
        `${sorted.length} matching rule${sorted.length === 1 ? '' : 's'}`,
        `top rule weight ${sorted[0]?.weight ?? 0}`,
        `margin ${Math.round(margin * 100)}%`,
        ...(lowStock ? ['low stock'] : []),
      ],
      slot: target.slot,
    });
  }

  offers.sort((a, b) => b.score - a.score || a.suggestionId.localeCompare(b.suggestionId));

  const limit = input.maxOffers ?? config.pairingMaxOffers;
  const usedSlots = new Set<string>();
  const result: PairingOffer[] = [];
  for (const offer of offers) {
    if (result.length >= limit) break;
    if (offer.slot !== null) {
      if (usedSlots.has(offer.slot)) continue;
      usedSlots.add(offer.slot);
    }
    result.push({
      suggestionId: offer.suggestionId,
      productId: offer.productId,
      reason: offer.reason,
      score: offer.score,
      reasons: offer.reasons,
    });
  }
  return result;
}
