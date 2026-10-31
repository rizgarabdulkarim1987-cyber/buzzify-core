import { isLocale, type Locale } from './locale';

export const ART_KINDS = ['cup', 'glass', 'plate', 'pastry', 'bowl', 'burger', 'scoop', 'cake', 'bread'] as const;
export type ArtKind = (typeof ART_KINDS)[number];

/** A photo or drawing from the media library, resolved when the menu was published (`src/server/media/resolve.ts`). */
export interface ImageItem {
  kind: 'image';
  url: string;
  /** In the menu's default language; `alts` has the others. */
  alt: string;
  width: number;
  height: number;
  alts?: Partial<Record<Locale, string>>;
  /** `url 320w, url 640w, …` for each format the library made. */
  srcset?: { avif: string; webp: string };
  /** A tiny blurred WebP as a data URI, shown while the photo loads. */
  placeholder?: string;
  /** The library asset it came from, so restoring the revision to the draft links it again. */
  assetId?: string;
}

export interface ArtItem {
  kind: 'art';
  art: ArtKind;
  tone: string;
  /** Which 3D model draws this art, when the art kind alone is ambiguous. */
  model?: string;
  /** A scanned or modelled dish (a `.glb` file) drawn in place of the model once it has loaded; the model stands in until then. */
  scan?: string;
}

export type MediaItem =
  | ArtItem
  | ImageItem
  | { kind: 'video'; url: string; poster: string }
  | ModelItem;

/** A dish's own 3D model (a GLB from the library). A GLB has no picture of itself, so the poster is optional. */
export interface ModelItem {
  kind: 'model3d';
  url: string;
  poster?: string;
  /** The library model it came from, so restoring the revision to the draft links it again. */
  assetId?: string;
  /** Set on the guest menu only, when the plan also allows putting the dish on the table in AR (`immersive.ar`). */
  ar?: true;
}

/** What a product's draft row may hold: a library asset (photo) or model not yet resolved, or anything guests see. */
export type DraftMediaItem = MediaItem | { kind: 'asset'; assetId: string } | { kind: 'model'; assetId: string };

/** Same-origin paths and https URLs only. Protocol-relative and script URLs are rejected. */
export function isSafeMediaUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value.startsWith('//')) return false;
  return value.startsWith('/') || value.startsWith('https://');
}

/** A `srcset` value whose every candidate is a safe URL followed by a width (`/a.webp 320w`). */
function isSafeSrcset(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim() === '') return false;
  return value.split(',').every((candidate) => {
    const [url, width, ...rest] = candidate.trim().split(/\s+/);
    return rest.length === 0 && isSafeMediaUrl(url) && /^\d+w$/.test(width ?? '');
  });
}

const PLACEHOLDER = /^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/;
export const MAX_PLACEHOLDER_LENGTH = 1024;

function imageExtras(v: Record<string, unknown>): Partial<ImageItem> {
  const extras: Partial<ImageItem> = {};
  if (v.alts && typeof v.alts === 'object' && !Array.isArray(v.alts)) {
    const alts: Partial<Record<Locale, string>> = {};
    for (const [locale, text] of Object.entries(v.alts)) if (isLocale(locale) && typeof text === 'string') alts[locale] = text;
    extras.alts = alts;
  }
  const srcset = v.srcset as { avif?: unknown; webp?: unknown } | undefined;
  if (srcset && typeof srcset === 'object' && isSafeSrcset(srcset.avif) && isSafeSrcset(srcset.webp)) {
    extras.srcset = { avif: srcset.avif, webp: srcset.webp };
  }
  if (typeof v.placeholder === 'string' && v.placeholder.length <= MAX_PLACEHOLDER_LENGTH && PLACEHOLDER.test(v.placeholder)) {
    extras.placeholder = v.placeholder;
  }
  if (typeof v.assetId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v.assetId)) extras.assetId = v.assetId;
  return extras;
}

/**
 * What a product shows guests, from its stored media. Anything malformed or unsafe is dropped rather than thrown, and a
 * draft's unresolved library asset is never shown (publishing resolves it, or refuses).
 */
export function parseMedia(raw: unknown): MediaItem[] {
  if (!Array.isArray(raw)) return [];
  const items: MediaItem[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const v = entry as Record<string, unknown>;
    if (v.kind === 'art') {
      if ((ART_KINDS as readonly unknown[]).includes(v.art) && typeof v.tone === 'string' && /^#[0-9a-fA-F]{6}$/.test(v.tone)) {
        const model = typeof v.model === 'string' && /^[a-z]{2,24}$/.test(v.model) ? v.model : undefined;
        const scan = isSafeMediaUrl(v.scan) && /\.glb$/i.test(v.scan.split(/[?#]/)[0]!) ? v.scan : undefined;
        items.push({ kind: 'art', art: v.art as ArtKind, tone: v.tone, ...(model ? { model } : {}), ...(scan ? { scan } : {}) });
      }
    } else if (v.kind === 'image') {
      if (isSafeMediaUrl(v.url) && typeof v.alt === 'string' && Number.isFinite(v.width) && Number.isFinite(v.height)) {
        items.push({ kind: 'image', url: v.url, alt: v.alt, width: Number(v.width), height: Number(v.height), ...imageExtras(v) });
      }
    } else if (v.kind === 'video') {
      if (isSafeMediaUrl(v.url) && isSafeMediaUrl(v.poster)) items.push({ kind: 'video', url: v.url, poster: v.poster });
    } else if (v.kind === 'model3d') {
      if (isSafeMediaUrl(v.url)) {
        const assetId = typeof v.assetId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v.assetId) ? v.assetId : undefined;
        items.push({ kind: 'model3d', url: v.url, ...(isSafeMediaUrl(v.poster) ? { poster: v.poster } : {}), ...(assetId ? { assetId } : {}) });
      }
    }
  }
  return items;
}
