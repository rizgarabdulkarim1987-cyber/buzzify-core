import type { Locale } from '@/lib/locale';
import { parseMedia, type MediaItem } from '@/lib/media';
import {
  applyBundle,
  liveOffers,
  priceOf,
  resolveText,
  type BundleOpportunity,
  type CartInput,
  type Catalog,
  type CatalogProduct,
  type CatalogPromotion,
  type MealOffer,
  type PairingOffer,
  type SuggestionsResponse,
  type UpsellOffer,
} from '@/server/domain';

/** What a suggested dish card shows: its name, its price now, its picture and whether it opens for choices. */
interface DishCard {
  slug: string;
  name: string;
  price: number;
  media: MediaItem[];
  needsChoices: boolean;
  defaultVariantId: string | null;
}

export interface PairingView extends PairingOffer, DishCard {}

export interface MealView extends MealOffer, DishCard {}

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
  meal: MealView[];
}

function dishCard(product: CatalogProduct, locale: Locale, fallback: Locale, live: readonly CatalogPromotion[]): DishCard {
  return {
    slug: product.slug,
    name: resolveText(product.translations, 'name', locale, fallback),
    price: priceOf(product, null, [], live).price,
    media: parseMedia(product.media),
    needsChoices: product.groups.some((group) => group.minSelect > 0 && group.options.length > 0),
    defaultVariantId: product.variants.find((variant) => variant.isDefault)?.id ?? null,
  };
}

export function describeSuggestions(
  catalog: Catalog,
  response: SuggestionsResponse,
  locale: Locale,
  cart: CartInput,
  now: Date,
): SuggestionsView {
  const fallback = catalog.defaultLocale;
  const products = new Map(catalog.products.map((product) => [product.id, product]));
  const bundles = new Map(catalog.bundles.map((bundle) => [bundle.id, bundle]));
  const live = liveOffers(catalog, now);
  const withCard = <T extends { productId: string }>(offers: T[]): Array<T & DishCard> =>
    offers.flatMap((offer) => {
      const product = products.get(offer.productId);
      return product ? [{ ...offer, ...dishCard(product, locale, fallback, live) }] : [];
    });

  return {
    daypart: response.daypart,
    signature: response.signature,
    upgrades: response.upgrades,
    pairings: withCard(response.pairings),
    meal: withCard(response.meal),
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
