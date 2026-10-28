import type { Locale } from '@/lib/locale';
import type { ImageItem } from '@/lib/media';
import { businessInfo, type RestaurantDetails } from '@/lib/templates/resolve';
import { getPrisma } from '@/server/data/prisma';
import type { BrandImage, TenantInfo } from '@/server/data/tenant';
import { menuDb } from '@/server/data/tenant-db';
import { advertShowsIn, introLiveFor, safeHref } from '@/server/domain/intro';
import { assetImage, loadAssets, resolveDraftMedia } from '@/server/media/resolve';
import { sceneMediaOf } from '@/server/media/scene';
import { getStorage } from '@/server/storage/storage';

export type IntroContactKind = 'instagram' | 'facebook' | 'tiktok' | 'website' | 'map' | 'phone' | 'whatsapp';

export interface IntroContact {
  kind: IntroContactKind;
  href: string;
}

export type IntroBackground =
  | { kind: 'image'; url: string; width: number; height: number; placeholder?: string }
  | { kind: 'video'; url: string; poster: string; width: number; height: number };

export interface IntroAdvertView {
  id: string;
  image: ImageItem;
  alt: string;
  /** Whether the advert leads somewhere. The address itself stays on the server: a click goes through `/{slug}/intro/ad/{id}`. */
  linked: boolean;
}

export interface IntroView {
  background: IntroBackground | null;
  /** How dark the gradient over the background is, 0 to 100. */
  overlay: number;
  showLogo: boolean;
  logo: BrandImage | null;
  contacts: IntroContact[];
  adverts: IntroAdvertView[];
  /** The menu's languages, its default first. */
  locales: Locale[];
  defaultLocale: Locale;
}

const DEFAULTS = { backgroundAssetId: null, overlay: 50, showLogo: true, showContact: true };
const SOCIAL_ORDER = ['instagram', 'facebook', 'tiktok', 'website'] as const;

function altIn(map: unknown, locale: Locale, defaultLocale: Locale): string {
  if (typeof map !== 'object' || map === null || Array.isArray(map)) return '';
  const stored = map as Record<string, unknown>;
  for (const candidate of [locale, defaultLocale, 'en', 'ar', 'ckb']) {
    const value = stored[candidate];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return '';
}

/**
 * The intro page for a guest, read per request (never part of a published snapshot, so a change shows without a publish). Null when the
 * menu switched the intro off or its plan lacks it. The background is the menu's own, else the platform's default, else none; the adverts
 * are the platform's that apply to this menu and are live now; the contacts come live from the restaurant, each only when filled and safe.
 */
export async function loadIntro(tenant: TenantInfo, locale: Locale, now: Date): Promise<IntroView | null> {
  if (!tenant.extras?.intro) return null;

  const prisma = getPrisma();
  const db = menuDb(prisma, tenant.id);
  const [saved, platform, allAdverts, restaurant] = await Promise.all([
    db.menuIntro.findUnique({ where: { menuId: tenant.id } }),
    prisma.platformIntro.findUnique({ where: { id: 'singleton' } }),
    prisma.platformAdvert.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
    prisma.restaurant.findUnique({ where: { id: tenant.restaurantId }, select: { address: true, city: true, phone: true, whatsapp: true, mapUrl: true, socialLinks: true, workingHours: true } }),
  ]);
  const intro = saved ?? DEFAULTS;

  const adverts = introLiveFor(
    allAdverts.filter((advert) => advertShowsIn(advert, { menuId: tenant.id, restaurantId: tenant.restaurantId })),
    now,
  );
  const ids = [intro.backgroundAssetId, platform?.backgroundAssetId, ...adverts.map((advert) => advert.imageAssetId)].filter((id): id is string => !!id);
  const assets = await loadAssets(prisma, tenant.restaurantId, ids, ['IMAGE', 'VIDEO']);
  const mediaUrl = (key: string) => getStorage().publicUrl(key);

  // The menu's own background, else the platform's; a missing or foreign file (or a video without its poster) is passed over, not shown broken.
  let background: IntroBackground | null = null;
  for (const id of [intro.backgroundAssetId, platform?.backgroundAssetId]) {
    const asset = id ? assets.get(id) : undefined;
    if (!asset) continue;
    if (asset.kind === 'VIDEO') {
      const scene = sceneMediaOf(asset, mediaUrl);
      if (scene?.kind === 'video') {
        background = { kind: 'video', url: scene.url, poster: scene.poster.url, width: scene.width, height: scene.height };
        break;
      }
    } else {
      const image = assetImage(asset, mediaUrl);
      background = { kind: 'image', url: image.url, width: image.width, height: image.height, ...(asset.placeholder ? { placeholder: asset.placeholder } : {}) };
      break;
    }
  }

  const advertViews: IntroAdvertView[] = [];
  for (const advert of adverts) {
    const asset = assets.get(advert.imageAssetId);
    if (!asset || asset.kind !== 'IMAGE') continue;
    const [item] = resolveDraftMedia([{ kind: 'asset', assetId: advert.imageAssetId }], assets, tenant.defaultLocale, mediaUrl);
    if ((item as { kind?: string } | undefined)?.kind !== 'image') continue;
    advertViews.push({ id: advert.id, image: item as ImageItem, alt: altIn(advert.alts, locale, tenant.defaultLocale), linked: safeHref(advert.href) !== '' });
  }

  const contacts: IntroContact[] = [];
  if (intro.showContact && restaurant) {
    const details: RestaurantDetails = restaurant;
    const info = businessInfo(details, { hours: false, address: false, map: true, phone: true, whatsapp: true, social: true });
    for (const kind of SOCIAL_ORDER) {
      const href = safeHref(info.social?.[kind] ?? '');
      if (href) contacts.push({ kind, href });
    }
    if (info.mapUrl && safeHref(info.mapUrl)) contacts.push({ kind: 'map', href: info.mapUrl });
    if (info.phone) contacts.push({ kind: 'phone', href: `tel:${info.phone.replace(/[^+0-9]/g, '')}` });
    const digits = info.whatsapp?.replace(/[^0-9]/g, '');
    if (digits) contacts.push({ kind: 'whatsapp', href: `https://wa.me/${digits}` });
  }

  const brandLogo = tenant.brand.theme === 'dark' ? (tenant.brand.logoDark ?? tenant.brand.logo) : tenant.brand.logo;
  return {
    background,
    overlay: intro.overlay,
    showLogo: intro.showLogo,
    logo: intro.showLogo ? (brandLogo ?? null) : null,
    contacts,
    adverts: advertViews,
    locales: [tenant.defaultLocale, ...tenant.locales.filter((code) => code !== tenant.defaultLocale)],
    defaultLocale: tenant.defaultLocale,
  };
}
