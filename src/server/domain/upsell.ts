import { daypartNow, defaultVariant, inDaypart, orderability, priceOf, productMap } from './catalog';
import type { EngineConfig } from './config';
import { liveOffers } from './offers';
import { resolveText } from './translate';
import type { Catalog, Locale, TranslationMap } from './types';

export type UpsellKind = 'OPTION' | 'VARIANT' | 'SWAP';

export interface UpsellOffer {
  suggestionId: string;
  kind: UpsellKind;
  refId: string;
  title: string;
  effect: string | null;
  priceDelta: number;
  resultingTotal: number;
  score: number;
  reasons: string[];
}

export interface UpsellInput {
  catalog: Catalog;
  productId: string;
  variantId: string | null;
  optionIds: string[];
  now: Date;
  locale: Locale;
  config: EngineConfig;
}

interface Candidate {
  kind: UpsellKind;
  refId: string;
  title: string;
  effect: string | null;
  priceDelta: number;
  costDelta: number | null;
  rulePriority: number;
  popularity: number;
}

const round4 = (value: number) => Math.round(value * 10_000) / 10_000;

function deltaMargin(priceDelta: number, costDelta: number | null): number {
  if (costDelta === null || priceDelta <= 0) return 0.5;
  return Math.min(1, Math.max(0, (priceDelta - costDelta) / priceDelta));
}

export function suggestUpsells(input: UpsellInput): UpsellOffer[] {
  const { catalog, now, locale, config } = input;
  const products = productMap(catalog);
  const product = products.get(input.productId);
  if (!product) return [];
  const current = daypartNow(catalog, now);
  if (orderability(product, current) !== 'OK') return [];

  const text = (map: TranslationMap, field: string) => resolveText(map, field, locale, catalog.defaultLocale);
  const chosen = new Set(input.optionIds);
  const live = liveOffers(catalog, now);
  const base = priceOf(product, input.variantId, input.optionIds, live);
  // What the guest's choice would cost with this change, at today's prices (offers included).
  const withOption = (optionId: string) => priceOf(product, input.variantId, [...input.optionIds, optionId], live).price - base.price;
  const withVariant = (variantId: string) => priceOf(product, variantId, input.optionIds, live).price - base.price;
  const cap = Math.round(base.price * config.upsellDeltaCapRatio);
  const candidates: Candidate[] = [];

  for (const group of product.groups) {
    const picked = group.options.filter((option) => chosen.has(option.id)).length;
    if (picked >= group.maxSelect) continue;
    for (const option of group.options) {
      if (!option.isSuggested || !option.isAvailable || chosen.has(option.id)) continue;
      candidates.push({
        kind: 'OPTION',
        refId: option.id,
        title: text(option.translations, 'name'),
        effect: text(option.translations, 'effect') || null,
        priceDelta: withOption(option.id),
        costDelta: option.costDelta,
        rulePriority: option.suggestPriority,
        popularity: product.popularity,
      });
    }
  }

  const currentVariant =
    (input.variantId ? product.variants.find((variant) => variant.id === input.variantId) : defaultVariant(product)) ??
    null;
  const currentDelta = currentVariant?.priceDelta ?? 0;
  for (const variant of product.variants) {
    if (variant.id === currentVariant?.id || variant.priceDelta <= currentDelta) continue;
    const currentCost = currentVariant ? currentVariant.costDelta : 0;
    candidates.push({
      kind: 'VARIANT',
      refId: variant.id,
      title: text(variant.translations, 'name'),
      effect: null,
      priceDelta: withVariant(variant.id),
      costDelta: variant.costDelta !== null && currentCost !== null ? variant.costDelta - currentCost : null,
      rulePriority: 50,
      popularity: product.popularity,
    });
  }

  for (const rule of catalog.upsellRules) {
    if (rule.sourceProductId !== product.id || !inDaypart(rule.dayparts, current)) continue;
    const target = products.get(rule.targetProductId);
    if (!target || orderability(target, current) !== 'OK' || !inDaypart(target.dayparts, current)) continue;
    const targetPrice = priceOf(target, null, [], live);
    candidates.push({
      kind: 'SWAP',
      refId: target.id,
      title: text(rule.translations, 'pitch') || text(target.translations, 'name'),
      effect: text(rule.translations, 'effect') || null,
      priceDelta: targetPrice.price - base.price,
      costDelta: targetPrice.cost !== null && base.cost !== null ? targetPrice.cost - base.cost : null,
      rulePriority: rule.priority,
      popularity: target.popularity,
    });
  }

  const w = config.weights;
  const offers = candidates
    .filter((candidate) => candidate.priceDelta > 0 && candidate.priceDelta <= cap)
    .map<UpsellOffer>((candidate) => {
      const margin = deltaMargin(candidate.priceDelta, candidate.costDelta);
      const score =
        w.rulePriority * (candidate.rulePriority / 100) + w.margin * margin + w.popularity * (candidate.popularity / 100);
      return {
        suggestionId: `up:${product.id}:${candidate.kind}:${candidate.refId}`,
        kind: candidate.kind,
        refId: candidate.refId,
        title: candidate.title,
        effect: candidate.effect,
        priceDelta: candidate.priceDelta,
        resultingTotal: base.price + candidate.priceDelta,
        score: round4(score),
        reasons: [
          `rule priority ${candidate.rulePriority}`,
          `delta margin ${Math.round(margin * 100)}%`,
          `popularity ${candidate.popularity}`,
        ],
      };
    })
    .sort((a, b) => b.score - a.score || a.suggestionId.localeCompare(b.suggestionId));

  const result: UpsellOffer[] = [];
  let swaps = 0;
  for (const offer of offers) {
    if (result.length >= config.upsellMaxOffers) break;
    if (offer.kind === 'SWAP') {
      if (swaps >= 1) continue;
      swaps += 1;
    }
    result.push(offer);
  }
  return result;
}
