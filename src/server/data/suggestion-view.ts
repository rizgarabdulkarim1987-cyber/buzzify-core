import type { Locale } from '@/lib/locale';
import { parseMedia, type MediaItem } from '@/lib/media';
import {
  applyBundle,
  resolveText,
  unitPrice,
  type BundleOpportunity,
  type CartInput,
  type Catalog,
  type PairingOffer,
  type SuggestionsResponse,
  type UpsellOffer,
} from '@/server/domain';

export interface PairingView extends PairingOffer {
  slug: string;
  name: string;
  price: number;
  media: MediaItem[];
  needsChoices: boolean;
  defaultVariantId: string | null;
}

export interface BundleView extends BundleOpportunity {
  name: string;
  description: string;
  cartAfter: CartInput;
}

export interface SuggestionsView {
  daypart: SuggestionsResponse['daypart'];
  signature: SuggestionsResponse['signature'];
  upgrades: UpsellOffer[];
  pairings: PairingView[];
  bundles: BundleView[];
}

export function describeSuggestions(
  catalog: Catalog,
  response: SuggestionsResponse,
  locale: Locale,
  cart: CartInput,
): SuggestionsView {
  const fallback = catalog.defaultLocale;
  const products = new Map(catalog.products.map((product) => [product.id, product]));
  const bundles = new Map(catalog.bundles.map((bundle) => [bundle.id, bundle]));

  return {
    daypart: response.daypart,
    signature: response.signature,
    upgrades: response.upgrades,
    pairings: response.pairings.flatMap((offer) => {
      const product = products.get(offer.productId);
      if (!product) return [];
      return [
        {
          ...offer,
          slug: product.slug,
          name: resolveText(product.translations, 'name', locale, fallback),
          price: unitPrice(product, null, []).price,
          media: parseMedia(product.media),
          needsChoices: product.groups.some((group) => group.minSelect > 0 && group.options.length > 0),
          defaultVariantId: product.variants.find((variant) => variant.isDefault)?.id ?? null,
        },
      ];
    }),
    bundles: response.bundles.flatMap((opportunity) => {
      const bundle = bundles.get(opportunity.bundleId);
      if (!bundle) return [];
      return [
        {
          ...opportunity,
          name: resolveText(bundle.translations, 'name', locale, fallback),
          description: resolveText(bundle.translations, 'description', locale, fallback),
          cartAfter: applyBundle(cart, catalog, opportunity.bundleId, opportunity.times),
        },
      ];
    }),
  };
}
