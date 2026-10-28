import type { Locale } from '@/lib/locale';
import type { ImageItem } from '@/lib/media';
import { businessInfo, type RestaurantDetails } from '@/lib/templates/resolve';
import type { SocialLinks } from '@/lib/templates/types';
import { getCatalog } from '@/server/data/public-menu';
import { getPrisma } from '@/server/data/prisma';
import { menuDb } from '@/server/data/tenant-db';
import type { RouteContext } from '@/server/route-context';
import { DAYS, type Day } from '@/server/domain/restaurant-profile';
import { aboutIsEmpty, hoursView, offersLiveFor, type HoursRow, type StoryBlock, type StoryByLocale } from '@/server/domain/about';
import { getTranslator } from '@/lib/messages';
import { loadAssets, resolveDraftMedia } from '@/server/media/resolve';
import { getStorage } from '@/server/storage/storage';
import { wheelReady } from '@/server/data/wheel';

/** Where an offer card leads inside the menu; the page builds the address with the menu's own `href`. */
export type OfferLink = { kind: 'product'; slug: string } | { kind: 'category'; slug: string };

export interface AboutOfferView {
  id: string;
  title: string;
  body: string;
  label: string;
  image: ImageItem | null;
  until: Date | null;
  link: OfferLink | null;
}

export interface AboutView {
  /** The menu's time zone and the weekday it is in there now, so the hours table marks today the same on the server and in the browser. */
  timeZone: string;
  today: Day;
  /** What the guest reads on the tab and in the header: the restaurant's title, else "Explore" in the guest's language. */
  title: string;
  cover: ImageItem | null;
  story: StoryBlock[];
  offers: AboutOfferView[];
  hours: HoursRow[] | null;
  address: string | null;
  contacts: { phone?: string; whatsapp?: string; mapUrl?: string; social?: SocialLinks };
  gallery: ImageItem[];
  /** The wheel of fortune section, when the menu has one ready to spin; the section loads its own slices. */
  wheel: { title: string } | null;
}

/** A `{ en?, ar?, ckb? }` map of plain strings in the guest's language, else the menu's default, else English, else any. */
function pickText(map: unknown, locale: Locale, defaultLocale: Locale): string {
  if (typeof map !== 'object' || map === null || Array.isArray(map)) return '';
  const stored = map as Record<string, unknown>;
  for (const candidate of [locale, defaultLocale, 'en', 'ar', 'ckb']) {
    const value = stored[candidate];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return '';
}

/** The story in the guest's language, else the menu's default, else the first language that has one. Never blank while any language has text. */
function pickStory(story: unknown, locale: Locale, defaultLocale: Locale): StoryBlock[] {
  if (typeof story !== 'object' || story === null || Array.isArray(story)) return [];
  const stored = story as StoryByLocale;
  for (const candidate of [locale, defaultLocale, 'en', 'ar', 'ckb'] as const) {
    const blocks = stored[candidate];
    if (Array.isArray(blocks) && blocks.length > 0) return blocks;
  }
  return [];
}

function dayIn(now: Date, timeZone: string): Day {
  const name = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(now).slice(0, 3).toLowerCase();
  return DAYS.find((day) => day === name) ?? 'mon';
}

/**
 * The restaurant's own page for the guest, read per request (never part of a published snapshot, so a new offer shows without a
 * publish). Null when the menu switched the tab off, its plan lacks it, or there is nothing to show.
 */
export async function loadAbout(route: RouteContext): Promise<AboutView | null> {
  const { tenant, locale } = route;
  if (!tenant.extras?.about) return null;

  const prisma = getPrisma();
  const db = menuDb(prisma, tenant.id);
  const now = new Date();
  const [about, allOffers, restaurant, catalog, wheel] = await Promise.all([
    db.menuAbout.findUnique({ where: { menuId: tenant.id } }),
    db.aboutOffer.findMany({ where: { menuId: tenant.id } }),
    prisma.restaurant.findUnique({
      where: { id: tenant.restaurantId },
      select: { address: true, city: true, phone: true, whatsapp: true, mapUrl: true, socialLinks: true, workingHours: true },
    }),
    getCatalog(tenant),
    wheelReady(tenant, locale, now),
  ]);
  const offers = offersLiveFor(allOffers, now);
  if (aboutIsEmpty(about, offers, wheel !== null)) return null;

  const defaultLocale = tenant.defaultLocale;
  const imageIds = [about?.coverAssetId, ...(about?.galleryAssetIds ?? []), ...offers.map((offer) => offer.imageAssetId)].filter((id): id is string => !!id);
  const assets = await loadAssets(prisma, tenant.restaurantId, imageIds, ['IMAGE']);
  const mediaUrl = (key: string) => getStorage().publicUrl(key);
  const imageOf = (assetId: string | null | undefined): ImageItem | null => {
    if (!assetId) return null;
    const [item] = resolveDraftMedia([{ kind: 'asset', assetId }], assets, defaultLocale, mediaUrl);
    return (item as { kind?: string } | undefined)?.kind === 'image' ? (item as ImageItem) : null;
  };

  const products = new Map(catalog.products.filter((product) => !product.isHidden).map((product) => [product.id, product.slug]));
  const categories = new Map(catalog.categories.map((category) => [category.id, category.slug]));
  const linkOf = (offer: { productId: string | null; categoryId: string | null }): OfferLink | null => {
    const product = offer.productId ? products.get(offer.productId) : undefined;
    if (product) return { kind: 'product', slug: product };
    const category = offer.categoryId ? categories.get(offer.categoryId) : undefined;
    return category ? { kind: 'category', slug: category } : null;
  };

  const showHours = about?.showHours ?? true;
  const showContact = about?.showContact ?? true;
  const details: RestaurantDetails | null = restaurant;
  const info = details
    ? businessInfo(details, { hours: false, address: showContact, map: showContact, phone: showContact, whatsapp: showContact, social: showContact })
    : {};
  // The title is the language's own or the default word: never another language's custom title, which would read as a stranger's text.
  const customTitle = tenant.extras.aboutTitle[locale]?.trim() ?? '';

  return {
    timeZone: tenant.timeZone,
    today: dayIn(now, tenant.timeZone),
    title: customTitle || getTranslator(locale)('about.title'),
    cover: imageOf(about?.coverAssetId),
    story: pickStory(about?.story, locale, defaultLocale),
    offers: offers.map((offer) => ({
      id: offer.id,
      title: pickText(offer.titles, locale, defaultLocale),
      body: pickText(offer.bodies, locale, defaultLocale),
      label: pickText(offer.label, locale, defaultLocale),
      image: imageOf(offer.imageAssetId),
      until: offer.endsAt,
      link: linkOf(offer),
    })),
    hours: showHours && restaurant ? hoursView(restaurant.workingHours) : null,
    address: info.address ?? null,
    contacts: {
      ...(info.phone ? { phone: info.phone } : {}),
      ...(info.whatsapp ? { whatsapp: info.whatsapp } : {}),
      ...(info.mapUrl ? { mapUrl: info.mapUrl } : {}),
      ...(info.social ? { social: info.social } : {}),
    },
    gallery: (about?.galleryAssetIds ?? []).map(imageOf).filter((image): image is ImageItem => image !== null),
    wheel,
  };
}
