import type { MediaAsset } from '@/generated/prisma/client';
import { isLocale, type Locale } from '@/lib/locale';
import type { ImageItem } from '@/lib/media';
import { delegates, type AnyDb, type ScopedDb } from '@/server/data/tenant-db';
import type { AssetVariants } from './process';

/**
 * Library assets turned into what guests load. A draft names its photos by asset (`{ kind: 'asset', assetId }`); a
 * snapshot holds them resolved into URLs, sizes and alt texts, so a published revision never depends on the library
 * again. Restoring or duplicating a snapshot turns them back into asset entries.
 */

export type ResolvableAsset = Pick<MediaAsset, 'id' | 'kind' | 'width' | 'height' | 'variants' | 'placeholder' | 'alt'>;

const RESOLVABLE = { id: true, kind: true, width: true, height: true, variants: true, placeholder: true, alt: true } as const;

/**
 * The assets with these ids that a restaurant may use: its own and the shared library's. The restaurant is named in the
 * query itself, so this holds on any client; an id of another restaurant's asset is simply not found.
 */
export function loadAssets(db: AnyDb, restaurantId: string, ids: readonly string[]): Promise<Map<string, ResolvableAsset>>;
export function loadAssets(db: ScopedDb, restaurantId: string, ids: readonly string[]): Promise<Map<string, ResolvableAsset>>;
export async function loadAssets(client: AnyDb | ScopedDb, restaurantId: string, ids: readonly string[]): Promise<Map<string, ResolvableAsset>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await delegates(client).mediaAsset.findMany({
    where: { id: { in: unique }, OR: [{ restaurantId }, { restaurantId: null }] },
    select: RESOLVABLE,
  });
  return new Map(rows.map((row) => [row.id, row]));
}

/** The asset ids a list of draft media entries names. */
export function mediaAssetIds(media: readonly unknown[]): string[] {
  const ids: string[] = [];
  for (const entry of media) {
    const value = entry as { kind?: unknown; assetId?: unknown } | null;
    if (value?.kind === 'asset' && typeof value.assetId === 'string') ids.push(value.assetId);
  }
  return ids;
}

function variantsOf(asset: ResolvableAsset): AssetVariants {
  return (asset.variants ?? { original: '' }) as unknown as AssetVariants;
}

/** A format's renditions, narrowest first: `[[320, key], [640, key], ...]`. */
function widths(renditions: Record<string, string> | undefined): Array<[number, string]> {
  return Object.entries(renditions ?? {})
    .map(([width, key]) => [Number(width), key] as [number, string])
    .filter(([width]) => Number.isFinite(width))
    .sort((x, y) => x[0] - y[0]);
}

/** The widest rendition no wider than `max`, else the narrowest one. */
function pick(list: Array<[number, string]>, max: number): string | null {
  const fitting = list.filter(([width]) => width <= max);
  return (fitting.at(-1) ?? list[0])?.[1] ?? null;
}

/**
 * An asset as one picture: the URL to show (the widest WebP no wider than 1080, or the SVG itself), its size, and the
 * key of a raster rendition for drawing it on the server (the 640 px WebP, else the widest). The base of brand logos and
 * SEO images.
 */
export function assetImage(
  asset: ResolvableAsset,
  mediaUrl: (key: string) => string,
): { url: string; width: number; height: number; svg: boolean; rasterKey: string } {
  const variants = variantsOf(asset);
  const webp = widths(variants.webp);
  const svg = asset.kind === 'SVG';
  const shown = svg || asset.kind === 'ICON' ? variants.original : (pick(webp, 1080) ?? variants.original);
  const raster = variants.webp?.['640'] ?? webp.at(-1)?.[1] ?? variants.original;
  return { url: mediaUrl(shown), width: asset.width ?? 1, height: asset.height ?? 1, svg, rasterKey: raster };
}

function altsOf(asset: ResolvableAsset): Partial<Record<Locale, string>> {
  const alts: Partial<Record<Locale, string>> = {};
  const value = asset.alt as Record<string, unknown> | null;
  if (value && typeof value === 'object') {
    for (const [locale, text] of Object.entries(value)) if (isLocale(locale) && typeof text === 'string' && text !== '') alts[locale] = text;
  }
  return alts;
}

const srcset = (list: Array<[number, string]>, mediaUrl: (key: string) => string) =>
  list.map(([width, key]) => `${mediaUrl(key)} ${width}w`).join(', ');

/** One asset as the image guests are shown. */
function resolveOne(asset: ResolvableAsset, defaultLocale: Locale, mediaUrl: (key: string) => string): ImageItem {
  const variants = variantsOf(asset);
  const { url, width, height } = assetImage(asset, mediaUrl);
  const alts = altsOf(asset);
  const image: ImageItem = { kind: 'image', url, alt: alts[defaultLocale] ?? '', width, height };
  if (Object.keys(alts).length > 0) image.alts = alts;
  const avif = widths(variants.avif);
  const webp = widths(variants.webp);
  if (asset.kind === 'IMAGE' && avif.length > 0 && webp.length > 0) {
    image.srcset = { avif: srcset(avif, mediaUrl), webp: srcset(webp, mediaUrl) };
  }
  if (asset.placeholder) image.placeholder = asset.placeholder;
  image.assetId = asset.id;
  return image;
}

/**
 * A product's draft media with every library asset resolved into an image. An asset that is not among `assets` (gone,
 * or another restaurant's) stays an asset entry, and publishing refuses it (`MISSING_ASSET`). Other entries are kept.
 */
export function resolveDraftMedia(
  media: readonly unknown[],
  assets: ReadonlyMap<string, ResolvableAsset>,
  defaultLocale: Locale,
  mediaUrl: (key: string) => string,
): unknown[] {
  return media.map((entry) => {
    const value = entry as { kind?: unknown; assetId?: unknown } | null;
    if (value?.kind !== 'asset' || typeof value.assetId !== 'string') return entry;
    const asset = assets.get(value.assetId);
    return asset ? resolveOne(asset, defaultLocale, mediaUrl) : { kind: 'asset', assetId: value.assetId };
  });
}

/**
 * A snapshot's media as a draft holds it: an image that came from the library goes back to its asset entry, through
 * `assetMap` when the assets were copied (a menu duplicated into another restaurant). Everything else is kept.
 */
export function draftMediaFromSnapshot(media: readonly unknown[], assetMap?: ReadonlyMap<string, string>): unknown[] {
  return media.map((entry) => {
    const value = entry as { kind?: unknown; assetId?: unknown } | null;
    if (value?.kind === 'image' && typeof value.assetId === 'string') {
      return { kind: 'asset', assetId: assetMap?.get(value.assetId) ?? value.assetId };
    }
    if (value?.kind === 'asset' && typeof value.assetId === 'string') {
      return { kind: 'asset', assetId: assetMap?.get(value.assetId) ?? value.assetId };
    }
    return entry;
  });
}
