import { detectBundleOpportunities, type BundleOpportunity } from './bundles';
import { daypartNow } from './catalog';
import type { EngineConfig } from './config';
import { suggestPairings, type PairingOffer } from './pairing';
import { pickSignature } from './promotion';
import { suggestUpsells, type UpsellOffer } from './upsell';
import type { CartInput, Catalog, Daypart, Locale } from './types';

export interface SuggestionsRequest {
  context: 'menu' | 'product' | 'cart';
  locale: Locale;
  product?: { productId: string; variantId: string | null; optionIds: string[] };
  cart: CartInput;
  dismissedIds: string[];
}

export interface SignaturePick {
  suggestionId: string;
  productId: string;
  reasons: string[];
}

export interface SuggestionsResponse {
  daypart: Daypart | null;
  signature: SignaturePick | null;
  upgrades: UpsellOffer[];
  pairings: PairingOffer[];
  bundles: BundleOpportunity[];
}

export function buildSuggestions(
  catalog: Catalog,
  request: SuggestionsRequest,
  now: Date,
  config: EngineConfig,
): SuggestionsResponse {
  const response: SuggestionsResponse = {
    daypart: daypartNow(catalog, now),
    signature: null,
    upgrades: [],
    pairings: [],
    bundles: [],
  };

  if (request.context === 'menu') {
    const pick = pickSignature(catalog, now, config);
    response.signature = pick
      ? { suggestionId: `sig:${pick.productId}`, productId: pick.productId, reasons: pick.reasons }
      : null;
    return response;
  }

  if (request.context === 'product') {
    const selected = request.product;
    if (!selected) return response;
    response.upgrades = suggestUpsells({
      catalog,
      productId: selected.productId,
      variantId: selected.variantId,
      optionIds: selected.optionIds,
      now,
      locale: request.locale,
      config,
    });
    response.pairings = suggestPairings({
      catalog,
      cart: {
        lines: [
          ...request.cart.lines,
          { productId: selected.productId, variantId: selected.variantId, optionIds: selected.optionIds, quantity: 1 },
        ],
        bundles: request.cart.bundles,
      },
      dismissedIds: request.dismissedIds,
      now,
      locale: request.locale,
      config,
    });
    return response;
  }

  response.pairings = suggestPairings({
    catalog,
    cart: request.cart,
    dismissedIds: request.dismissedIds,
    now,
    locale: request.locale,
    config,
    maxOffers: config.cartPairingMaxOffers,
  });
  response.bundles = detectBundleOpportunities(catalog, request.cart, now);
  return response;
}
