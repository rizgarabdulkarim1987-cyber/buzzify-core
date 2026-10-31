import { moodsOf, type Mood } from '@/lib/moods';
import { normalizeSearch } from '@/lib/search';
import { LOCALES, type Locale } from '@/lib/locale';
import { parseMedia, type MediaItem } from '@/lib/media';
import { isBadge, isDietaryTag, type Badge, type DietaryTag } from '@/lib/product-tags';
import type { RailDish } from '@/lib/rail';
import { stageOf } from '@/lib/stage';
import {
  daypartNow,
  discountFor,
  inDaypart,
  liveOffers,
  localDate,
  orderability,
  pickSignature,
  priceOf,
  resolveText,
  salesSettings,
  specialFor,
  type Catalog,
  type CatalogGroup,
  type CatalogProduct,
  type CatalogPromotion,
  type Daypart,
  type Orderability,
  type PromotionKind,
  type VisualKey,
} from '@/server/domain';
import { drinkMatchFor } from '@/server/domain/drink-match';
import { liveOccasionMood, type LiveOccasionMood } from '@/server/domain/occasion-mood';
import { showsCounts } from '@/server/domain/dish-counts';
import { liveShowcase, type CatalogShowcaseCard, type ShowcaseKind } from '@/server/domain/showcase';
import type { StoryView } from './stories';
import type { TenantInfo } from './tenant';

export interface MenuOptionView {
  id: string;
  name: string;
  effect: string | null;
  priceDelta: number;
  isAvailable: boolean;
  /** What choosing this option does to the 3D model, if anything. */
  visualKey: VisualKey | null;
}

export interface MenuGroupView {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  options: MenuOptionView[];
}

export interface MenuVariantView {
  id: string;
  name: string;
  priceDelta: number;
  isDefault: boolean;
}

/** A drink under a dish's "goes well with": enough to show a chip and open the drink. */
export interface MenuMatchView {
  id: string;
  name: string;
  price: number;
  /** The owner paired it to this dish by hand. */
  paired?: true;
}

export interface MenuProductView {
  id: string;
  slug: string;
  categoryId: string;
  name: string;
  description: string;
  basePrice: number;
  /** What one unit costs with the default size and no options: the same number the quote starts from. */
  displayPrice: number;
  needsChoices: boolean;
  orderState: Orderability;
  isSignature: boolean;
  /** Set only when the restaurant featured it; template heroes show featured products first. */
  featured?: true;
  media: MediaItem[];
  // Each of these is left out when empty: every product of every menu page carries its view, and the menu page has to
  // arrive in the first round trip (docs/perf), so nothing is sent for what a product does not have.
  /** Quiet labels on the product's row. */
  badges?: Badge[];
  dietary?: DietaryTag[];
  /** Kilocalories of the default size, when the restaurant gave them. */
  calories?: number;
  // The sales tools (docs/superpowers/specs/2026-10-18-sales-tools-design.md, 6.3), each left out when it does not apply.
  /** The regular price, only while a discount makes `displayPrice` lower. */
  regularPrice?: number;
  /** The live discount and the step its prices round to, for the live total of the product's choices. */
  percentOff?: number;
  roundTo?: number;
  /** The title of a live special that names the dish. */
  special?: string;
  /** Among the menu's most ordered dishes, from real guest data. */
  mostOrdered?: true;
  /** Paid orders and guest openings of the dish, from the first day; present only from its first paid order and only while the menu shows counts. */
  counts?: { orders: number; views: number };
  /** Portions left today, when at or below the dish's threshold. */
  fewLeft?: number;
  /** When a limited drop ends (an ISO instant), while the dish is inside its window; the label counts down to it. */
  dropEndsAt?: string;
  /** How many people the dish is for. */
  serves?: number;
  /** Drinks that go with the dish, when the plan has drink match (`guest.drinkMatch`). */
  match?: MenuMatchView[];
  /** What mood the dish suits, when the plan has the mood picker (`guest.moodPicker`); left out when none. */
  moods?: Mood[];
  allergens: string[];
  ingredients: string[];
  searchKey: string;
  groups: MenuGroupView[];
  variants: MenuVariantView[];
}

/** A live offer as the menu's strip shows it, with when it ends (today's closing time, or a date within a week). */
export interface MenuOfferView {
  id: string;
  kind: PromotionKind;
  title: string;
  text: string;
  percentOff: number | null;
  endsAt: { time: string } | { date: string } | null;
}

/** A showcase card as a guest's carousel shows it (docs/superpowers/specs/2026-10-30-menu-occasions-showcase-design.md). */
export interface ShowcaseCardView {
  id: string;
  kind: ShowcaseKind;
  title: string;
  text: string;
  /** The name of the occasion the card belongs to, shown as a small label. */
  occasion: string | null;
  /** SET: the set's price; BUFFET: the price per person. */
  price: number | null;
  /** SET: how many people the package is for, when it says. */
  people: number | null;
  /** OFFER: the first dish of the offer guests can see now, which the card opens. */
  productId: string | null;
  /** OFFER on categories with no dish of its own shown: its first category with a dish shown, which the card jumps to. */
  categoryId: string | null;
  /** SET: the bundle the card adds to the cart. */
  bundleId: string | null;
  /** BUFFET: the price is per person. */
  perPerson: boolean;
  /** BUFFET: its days and hours; both minutes null for all day. */
  when: { startMinute: number | null; endMinute: number | null; daysOfWeek: number } | null;
}

export interface MenuShowcaseView {
  aboveSearch: ShowcaseCardView[];
  belowSearch: ShowcaseCardView[];
}

export interface MenuView {
  restaurant: {
    slug: string;
    name: string;
    currency: string;
    numeralSystem: 'latn' | 'arab';
    locales: Locale[];
    defaultLocale: Locale;
  };
  daypart: Daypart | null;
  categories: Array<{ id: string; slug: string; name: string; dish: RailDish }>;
  products: MenuProductView[];
  signatureProductId: string | null;
  /** `plain` shows prices without the currency symbol. */
  priceStyle: 'symbol' | 'plain';
  offers: MenuOfferView[];
  /** The live showcase cards around the search box; a slot without any is empty. */
  showcase: MenuShowcaseView;
  /** The occasion tinting the menu now (Ramadan, Newroz, Eid), when the plan has occasion moods (`guest.occasionMoods`). */
  occasion?: LiveOccasionMood;
  /** The restaurant's running stories, newest first, when the plan has them (`guest.stories`); read live, not from the snapshot. */
  stories?: StoryView[];
}

const DAY_MS = 86_400_000;
/** How many of an offer's dishes and categories its line names when it has no text of its own. */
const OFFER_SUBJECTS_SHOWN = 3;
/** An offer ending on a date says so only when that date is this close. */
const ENDS_SOON_DAYS = 7;

const clock = (minute: number) => `${String(Math.floor(minute / 60) % 24).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

function endsAt(offer: CatalogPromotion, now: Date, timeZone: string): MenuOfferView['endsAt'] {
  if (offer.startMinute !== null && offer.endMinute !== null) return { time: clock(offer.endMinute) };
  if (offer.endsOn !== null) {
    const days = (Date.parse(`${offer.endsOn}T00:00:00Z`) - Date.parse(`${localDate(now, timeZone)}T00:00:00Z`)) / DAY_MS;
    if (days < ENDS_SOON_DAYS) return { date: offer.endsOn };
  }
  return null;
}

function mapGroup(group: CatalogGroup, locale: Locale, fallback: Locale): MenuGroupView {
  return {
    id: group.id,
    name: resolveText(group.translations, 'name', locale, fallback),
    minSelect: group.minSelect,
    maxSelect: group.maxSelect,
    options: group.options.map((option) => ({
      id: option.id,
      name: resolveText(option.translations, 'name', locale, fallback),
      effect: resolveText(option.translations, 'effect', locale, fallback) || null,
      priceDelta: option.priceDelta,
      isAvailable: option.isAvailable,
      visualKey: option.visualKey,
    })),
  };
}

/**
 * Search text for what the visitor sees: the name, description and ingredients in the page's language.
 * This is what ships with the menu page; the other languages come from `buildSearchIndex`.
 */
function pageSearchKey(slug: string, name: string, description: string, ingredients: string[]): string {
  return normalizeSearch([slug, name, description, ...ingredients].join(' '));
}

function allLocalesSearchKey(product: CatalogProduct): string {
  const parts: string[] = [product.slug];
  for (const locale of LOCALES) {
    parts.push(product.translations[locale]?.name ?? '', product.translations[locale]?.description ?? '');
    parts.push(...(product.ingredients[locale] ?? []));
  }
  return normalizeSearch(parts.join(' '));
}

/**
 * Search text in every language, for each product that is on the menu right now, keyed by product id. A
 * visitor can search in any language, but sending every language with every page cost about a fifth of the
 * menu document, so the page loads this on demand when the search box is used.
 */
export function buildSearchIndex(catalog: Catalog, now: Date): Record<string, string> {
  const current = daypartNow(catalog, now);
  const index: Record<string, string> = {};
  for (const product of catalog.products) {
    if (orderability(product, current) !== 'OUT_OF_DAYPART') index[product.id] = allLocalesSearchKey(product);
  }
  return index;
}

/** The badges, dietary tags and calories a product has, leaving out what it has none of. */
function productTags(product: CatalogProduct): Pick<MenuProductView, 'badges' | 'dietary' | 'calories'> {
  const badges = product.badges.filter(isBadge);
  const dietary = product.dietary.filter(isDietaryTag);
  return {
    ...(badges.length > 0 ? { badges } : {}),
    ...(dietary.length > 0 ? { dietary } : {}),
    ...(product.calories !== null ? { calories: product.calories } : {}),
  };
}

/** A library photo's alt text in the page's language, falling back to the one it was published with. */
/** A dish's media as guests see it: a 3D model only when the plan has them, with AR only when the plan has that too. */
function guestMedia(media: MediaItem[], locale: Locale, features: { models3d: boolean; ar: boolean }): MediaItem[] {
  const shown = media.flatMap<MediaItem>((item) => {
    if (item.kind !== 'model3d') return [item];
    return features.models3d ? [features.ar ? { ...item, ar: true as const } : item] : [];
  });
  return localizeMedia(shown, locale);
}

function localizeMedia(media: MediaItem[], locale: Locale): MediaItem[] {
  return media.map((item) => (item.kind === 'image' && item.alts?.[locale] ? { ...item, alt: item.alts[locale] } : item));
}

/**
 * The dish a category's rail entry shows: the model of its first product with a 3D stage, in menu order and
 * whether or not that product is on the menu right now, so the rail does not change shape through the day.
 */
function dishOf(products: CatalogProduct[]): RailDish {
  const ordered = [...products].sort((a, b) => a.sortOrder - b.sortOrder || a.slug.localeCompare(b.slug));
  for (const product of ordered) {
    const stage = stageOf(parseMedia(product.media));
    if (stage) return stage.art;
  }
  return 'plate';
}

export function buildMenuView(
  catalog: Catalog,
  tenant: TenantInfo,
  locale: Locale,
  now: Date,
  extras: { mostOrdered?: readonly string[]; dishCounts?: ReadonlyMap<string, { orders: number; views: number }>; stories?: readonly StoryView[] } = {},
): MenuView {
  const fallback = catalog.defaultLocale;
  const current = daypartNow(catalog, now);
  const live = liveOffers(catalog, now);
  const sales = salesSettings(tenant.engineConfig);
  const socialProof = tenant.features.socialProof;
  const dishCounts = (id: string) => {
    const found = tenant.extras?.dishCounts ? extras.dishCounts?.get(id) : undefined;
    return found && showsCounts(found.orders) ? found : undefined;
  };
  const mostOrdered = new Set(socialProof && sales.showMostOrdered ? (extras.mostOrdered ?? []) : []);
  const fewLeft = (product: CatalogProduct): number | null =>
    socialProof &&
    sales.showLowStock &&
    product.stockCount !== null &&
    product.stockCount > 0 &&
    product.lowStockThreshold !== null &&
    product.stockCount <= product.lowStockThreshold
      ? product.stockCount
      : null;
  const categoryOrder = new Map(catalog.categories.map((category, index) => [category.id, index]));
  const sortOrder = new Map(catalog.products.map((product) => [product.id, product.sortOrder]));

  const products = catalog.products
    .filter((product) => orderability(product, current) !== 'OUT_OF_DAYPART')
    .map<MenuProductView>((product) => {
      const name = resolveText(product.translations, 'name', locale, fallback);
      const description = resolveText(product.translations, 'description', locale, fallback);
      const ingredients = product.ingredients[locale] ?? product.ingredients[fallback] ?? product.ingredients.en ?? [];
      const price = priceOf(product, null, [], live);
      const discount = discountFor(product, live);
      const special = specialFor(product, live);
      const left = fewLeft(product);
      return {
        id: product.id,
        slug: product.slug,
        categoryId: product.categoryId,
        name,
        description,
        basePrice: product.basePrice,
        displayPrice: price.price,
        ...(price.price < price.regular ? { regularPrice: price.regular } : {}),
        ...(discount ? { percentOff: discount.percent, roundTo: discount.roundTo } : {}),
        ...(special ? { special: resolveText(special.translations, 'title', locale, fallback) } : {}),
        ...(mostOrdered.has(product.id) ? { mostOrdered: true as const } : {}),
        ...(dishCounts(product.id) ? { counts: dishCounts(product.id) } : {}),
        ...(left !== null ? { fewLeft: left } : {}),
        ...(product.dropEndsAt ? { dropEndsAt: product.dropEndsAt } : {}),
        ...(product.serves !== null ? { serves: product.serves } : {}),
        needsChoices: product.groups.some((group) => group.minSelect > 0 && group.options.length > 0),
        orderState: orderability(product, current),
        isSignature: product.isSignature,
        ...(product.isFeatured ? { featured: true as const } : {}),
        media: guestMedia(parseMedia(product.media), locale, tenant.features),
        ...productTags(product),
        ...(tenant.features.moodPicker && moodsOf(product).length > 0 ? { moods: moodsOf(product) } : {}),
        allergens: product.allergens,
        ingredients,
        searchKey: pageSearchKey(product.slug, name, description, ingredients),
        groups: product.groups.map((group) => mapGroup(group, locale, fallback)),
        variants: product.variants.map((variant) => ({
          id: variant.id,
          name: resolveText(variant.translations, 'name', locale, fallback),
          priceDelta: variant.priceDelta,
          isDefault: variant.isDefault,
        })),
      };
    })
    .sort(
      (a, b) =>
        (categoryOrder.get(a.categoryId) ?? 0) - (categoryOrder.get(b.categoryId) ?? 0) ||
        (sortOrder.get(a.id) ?? 0) - (sortOrder.get(b.id) ?? 0) ||
        a.slug.localeCompare(b.slug),
    );

  if (tenant.features.drinkMatch) {
    const byId = new Map(products.map((view) => [view.id, view]));
    for (const view of products) {
      const match = drinkMatchFor(catalog, view.id, now).flatMap<MenuMatchView>((entry) => {
        const drink = byId.get(entry.productId);
        return drink ? [{ id: drink.id, name: drink.name, price: drink.displayPrice, ...(entry.paired ? { paired: true as const } : {}) }] : [];
      });
      if (match.length > 0) view.match = match;
    }
  }

  const productNames = new Map(catalog.products.map((product) => [product.id, resolveText(product.translations, 'name', locale, fallback)]));
  const categoryNames = new Map(catalog.categories.map((category) => [category.id, resolveText(category.translations, 'name', locale, fallback)]));
  const offerSubjects = (offer: CatalogPromotion) =>
    [...offer.categoryIds.map((id) => categoryNames.get(id)), ...offer.productIds.map((id) => productNames.get(id))]
      .filter((name): name is string => Boolean(name))
      .slice(0, OFFER_SUBJECTS_SHOWN)
      .join(', ');
  const signature = pickSignature(catalog, now, tenant.engineConfig);
  // Only offers on a dish guests can see now: an offer on dishes all out of their hours says nothing true.
  const shownOffers = live.filter((offer) =>
    products.some((product) => offer.productIds.includes(product.id) || offer.categoryIds.includes(product.categoryId)),
  );
  return {
    restaurant: {
      slug: tenant.slug,
      name: tenant.name,
      currency: tenant.currency,
      numeralSystem: tenant.numeralSystem,
      locales: tenant.locales,
      defaultLocale: tenant.defaultLocale,
    },
    daypart: current,
    categories: catalog.categories.map((category) => ({
      id: category.id,
      slug: category.slug,
      name: resolveText(category.translations, 'name', locale, fallback),
      dish: dishOf(catalog.products.filter((product) => product.categoryId === category.id)),
    })),
    products,
    signatureProductId: signature?.productId ?? null,
    priceStyle: sales.priceStyle,
    offers: shownOffers.map((offer) => ({
      id: offer.id,
      kind: offer.kind,
      title: resolveText(offer.translations, 'title', locale, fallback),
      // An offer without its own text names what it is on, so a guest knows where to look.
      text: resolveText(offer.translations, 'text', locale, fallback) || offerSubjects(offer),
      percentOff: offer.kind === 'DISCOUNT' ? offer.percentOff : null,
      endsAt: endsAt(offer, now, catalog.timeZone),
    })),
    showcase: menuShowcase(catalog, { shownOffers, products, current, offerSubjects }, locale, now),
    ...(tenant.features.occasionMoods ? occasionOf(catalog, locale, now) : {}),
    ...(tenant.features.stories && extras.stories && extras.stories.length > 0 ? { stories: [...extras.stories] } : {}),
  };
}

/**
 * The showcase cards live now (`liveShowcase`), resolved for the guest's language. An offer card goes with its offer as
 * the strip shows it, and a set card only while the set can be ordered: in its times of day with every dish orderable
 * now, as `detectBundleOpportunities` and pricing require. A card's own title and text win; an offer or set card
 * without them says what its offer or set says (an offer without text names what it is on, as the strip does).
 */
function menuShowcase(
  catalog: Catalog,
  shown: {
    shownOffers: readonly CatalogPromotion[];
    products: readonly MenuProductView[];
    current: Daypart | null;
    offerSubjects: (offer: CatalogPromotion) => string;
  },
  locale: Locale,
  now: Date,
): MenuShowcaseView {
  const fallback = catalog.defaultLocale;
  const shownIds = new Set(shown.products.map((product) => product.id));
  const shownCategoryIds = new Set(shown.products.map((product) => product.categoryId));
  const orderable = new Set(shown.products.filter((product) => product.orderState === 'OK').map((product) => product.id));
  const offers = new Map(shown.shownOffers.map((offer) => [offer.id, offer]));
  const bundles = new Map(
    catalog.bundles
      .filter((bundle) => inDaypart(bundle.dayparts, shown.current) && bundle.items.every((item) => orderable.has(item.productId)))
      .map((bundle) => [bundle.id, bundle]),
  );
  const occasions = new Map(catalog.occasions.map((occasion) => [occasion.id, occasion]));
  const slots = liveShowcase({
    cards: catalog.showcaseCards,
    occasions: catalog.occasions,
    liveOfferIds: new Set(offers.keys()),
    shownBundleIds: new Set(bundles.keys()),
    now,
    timeZone: catalog.timeZone,
  });

  const view = (card: CatalogShowcaseCard): ShowcaseCardView => {
    const offer = card.kind === 'OFFER' && card.promotionId !== null ? offers.get(card.promotionId) : undefined;
    const bundle = card.kind === 'SET' && card.bundleId !== null ? bundles.get(card.bundleId) : undefined;
    const occasion = card.occasionId !== null ? occasions.get(card.occasionId) : undefined;
    const own = (key: string) => resolveText(card.translations, key, locale, fallback);
    const productId = offer?.productIds.find((id) => shownIds.has(id)) ?? null;
    return {
      id: card.id,
      kind: card.kind,
      title:
        own('title') ||
        (offer ? resolveText(offer.translations, 'title', locale, fallback) : '') ||
        (bundle ? resolveText(bundle.translations, 'name', locale, fallback) : ''),
      text:
        own('text') ||
        (offer ? resolveText(offer.translations, 'text', locale, fallback) || shown.offerSubjects(offer) : '') ||
        (bundle ? resolveText(bundle.translations, 'description', locale, fallback) : ''),
      occasion: occasion ? resolveText(occasion.translations, 'name', locale, fallback) || null : null,
      price: bundle ? bundle.price : card.kind === 'BUFFET' ? card.price : null,
      people: bundle?.people ?? null,
      productId,
      categoryId: productId === null ? (offer?.categoryIds.find((id) => shownCategoryIds.has(id)) ?? null) : null,
      bundleId: bundle?.id ?? null,
      perPerson: card.kind === 'BUFFET',
      when: card.kind === 'BUFFET' ? { startMinute: card.startMinute, endMinute: card.endMinute, daysOfWeek: card.daysOfWeek } : null,
    };
  };
  return { aboveSearch: slots.ABOVE_SEARCH.map(view), belowSearch: slots.BELOW_SEARCH.map(view) };
}

/** The live occasion that carries a mood, as the key the menu view spreads in; empty when none runs. */
function occasionOf(catalog: Catalog, locale: Locale, now: Date): { occasion?: LiveOccasionMood } {
  const live = liveOccasionMood(catalog.occasions, now, catalog.timeZone, locale, catalog.defaultLocale);
  return live ? { occasion: live } : {};
}
