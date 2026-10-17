import { createHash } from 'node:crypto';
import sharp, { type Sharp } from 'sharp';
import type { MediaKind } from '@/generated/prisma/client';
import { MEDIA_MAX_BYTES, sniffMediaType, type MediaMime } from '@/server/domain/media-type';
import { assetFolder, assetKey, IMMUTABLE_CACHE } from '@/server/storage/keys';
import type { Storage } from '@/server/storage/storage';
import { sanitizeSvg } from './svg';

/**
 * Turning an upload into a library asset (spec 11): its real type from its bytes, its hash, and its variants. Photos
 * lose their metadata (a phone photo can carry where it was taken), stand upright, and are made into AVIF and WebP at
 * the widths the menu asks for, never larger than they are. SVGs are sanitized and also drawn as WebP for the places
 * that need pixels (favicons, social images, QR codes). Icons are kept as they are.
 */

export type MediaRefusal = 'TYPE' | 'SIZE' | 'DIMENSIONS' | 'UNREADABLE' | 'SVG_UNSAFE';

export interface PreparedFile {
  variant: string;
  ext: 'avif' | 'webp' | 'png' | 'jpg' | 'svg' | 'ico';
  contentType: string;
  body: Uint8Array;
}

export interface PreparedAsset {
  kind: MediaKind;
  mime: MediaMime;
  /** SHA-256 of the bytes as uploaded, in hex. */
  contentHash: string;
  bytes: number;
  width: number;
  height: number;
  /** A tiny blurred WebP as a data URI; empty for SVGs and icons. */
  placeholder: string;
  /** Always holds `original`. */
  files: PreparedFile[];
}

/** The storage keys of an asset's files, by variant. */
export interface AssetVariants {
  original: string;
  avif?: Record<string, string>;
  webp?: Record<string, string>;
  favicon?: Record<'32' | '180' | '512', string>;
}

export const IMAGE_WIDTHS = [320, 640, 1080, 1600] as const;
export const SVG_WIDTHS = [320, 640] as const;
const MAX_SIDE = 10_000;
const MAX_ASPECT = 8;
const MAX_PLACEHOLDER = 1024;

const INPUT = { failOn: 'error', limitInputPixels: 50_000_000, animated: false } as const;

const RASTER_EXT: Record<'image/jpeg' | 'image/png' | 'image/webp' | 'image/avif', PreparedFile['ext']> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

const toBytes = (buffer: Buffer) => new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);

/** The original again, in its own format, without its metadata. */
function reencode(image: Sharp, mime: keyof typeof RASTER_EXT): Sharp {
  switch (mime) {
    case 'image/jpeg':
      return image.jpeg({ quality: 90 });
    case 'image/png':
      return image.png();
    case 'image/webp':
      return image.webp({ quality: 90 });
    case 'image/avif':
      return image.avif({ quality: 70 });
  }
}

/** A tiny blurred WebP that stands in while the photo loads, at most 1,024 characters (smaller when it would be more). */
async function placeholderOf(bytes: Uint8Array): Promise<string> {
  for (const [width, quality] of [
    [16, 40],
    [8, 20],
  ] as const) {
    const tiny = await sharp(bytes, INPUT).rotate().resize({ width }).blur(1).webp({ quality }).toBuffer();
    const uri = `data:image/webp;base64,${tiny.toString('base64')}`;
    if (uri.length <= MAX_PLACEHOLDER) return uri;
  }
  return '';
}

/** Width and height of an icon's first image (a stored 0 means 256). */
function iconSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 22) return null;
  return { width: bytes[6] || 256, height: bytes[7] || 256 };
}

/** An SVG drawn at `width` pixels, sharp enough: drawn at a density that makes it at least that wide. */
function renderSvg(svg: string, svgWidth: number, width: number): Sharp {
  const density = Math.min(2400, Math.max(72, Math.ceil((72 * width) / svgWidth)));
  return sharp(Buffer.from(svg), { density }).resize({ width });
}

async function prepareRaster(bytes: Uint8Array, mime: keyof typeof RASTER_EXT): Promise<{ ok: true; asset: PreparedAsset } | { ok: false; reason: MediaRefusal }> {
  let width: number;
  let height: number;
  try {
    const meta = await sharp(bytes, INPUT).metadata();
    if (!meta.width || !meta.height) return { ok: false, reason: 'UNREADABLE' };
    // Orientations 5 to 8 turn the picture a quarter: it stands upright with its sides swapped.
    const turned = (meta.orientation ?? 1) >= 5;
    width = turned ? meta.height : meta.width;
    height = turned ? meta.width : meta.height;
  } catch {
    return { ok: false, reason: 'UNREADABLE' };
  }
  if (Math.max(width, height) > MAX_SIDE || Math.max(width, height) > MAX_ASPECT * Math.min(width, height)) {
    return { ok: false, reason: 'DIMENSIONS' };
  }

  try {
    const upright = () => sharp(bytes, INPUT).rotate();
    const widths: number[] = IMAGE_WIDTHS.filter((w) => w <= width);
    if (widths.length === 0) widths.push(width);
    const files: PreparedFile[] = [
      { variant: 'original', ext: RASTER_EXT[mime], contentType: mime, body: toBytes(await reencode(upright(), mime).toBuffer()) },
    ];
    for (const w of widths) {
      const resized = () => upright().resize({ width: w, withoutEnlargement: true });
      files.push({ variant: `avif-${w}`, ext: 'avif', contentType: 'image/avif', body: toBytes(await resized().avif({ quality: 55, effort: 4 }).toBuffer()) });
      files.push({ variant: `webp-${w}`, ext: 'webp', contentType: 'image/webp', body: toBytes(await resized().webp({ quality: 75 }).toBuffer()) });
    }
    return {
      ok: true,
      asset: {
        kind: 'IMAGE',
        mime,
        contentHash: createHash('sha256').update(bytes).digest('hex'),
        bytes: bytes.length,
        width,
        height,
        placeholder: await placeholderOf(bytes),
        files,
      },
    };
  } catch {
    return { ok: false, reason: 'UNREADABLE' };
  }
}

/** Checks an upload and makes everything the library stores for it; nothing is written anywhere. */
export async function prepareAsset(bytes: Uint8Array): Promise<{ ok: true; asset: PreparedAsset } | { ok: false; reason: MediaRefusal }> {
  if (bytes.length > MEDIA_MAX_BYTES) return { ok: false, reason: 'SIZE' };
  const mime = sniffMediaType(bytes.subarray(0, 4096));
  if (mime === null) return { ok: false, reason: 'TYPE' };
  const contentHash = createHash('sha256').update(bytes).digest('hex');

  if (mime === 'image/svg+xml') {
    const clean = sanitizeSvg(new TextDecoder('utf-8').decode(bytes));
    if (!clean) return { ok: false, reason: 'SVG_UNSAFE' };
    try {
      const files: PreparedFile[] = [
        { variant: 'original', ext: 'svg', contentType: 'image/svg+xml', body: new TextEncoder().encode(clean.svg) },
      ];
      for (const w of SVG_WIDTHS) {
        files.push({ variant: `webp-${w}`, ext: 'webp', contentType: 'image/webp', body: toBytes(await renderSvg(clean.svg, clean.width, w).webp({ quality: 85 }).toBuffer()) });
      }
      return { ok: true, asset: { kind: 'SVG', mime, contentHash, bytes: bytes.length, width: clean.width, height: clean.height, placeholder: '', files } };
    } catch {
      return { ok: false, reason: 'SVG_UNSAFE' };
    }
  }

  if (mime === 'image/x-icon') {
    const size = iconSize(bytes);
    if (!size) return { ok: false, reason: 'UNREADABLE' };
    return {
      ok: true,
      asset: {
        kind: 'ICON',
        mime,
        contentHash,
        bytes: bytes.length,
        ...size,
        placeholder: '',
        files: [{ variant: 'original', ext: 'ico', contentType: 'image/x-icon', body: bytes }],
      },
    };
  }

  return prepareRaster(bytes, mime);
}

/** Writes an asset's files under its library and hash, cached forever, and says where they are. */
export async function storeAsset(
  storage: Storage,
  owner: { restaurantId: string | null },
  asset: PreparedAsset,
): Promise<{ storageKey: string; variants: AssetVariants; storedBytes: number }> {
  const variants: AssetVariants = { original: '' };
  let storedBytes = 0;
  for (const file of asset.files) {
    const key = assetKey(owner, asset.contentHash, file.variant, file.ext);
    await storage.put(key, file.body, { contentType: file.contentType, cacheControl: IMMUTABLE_CACHE });
    storedBytes += file.body.length;
    if (file.variant === 'original') {
      variants.original = key;
      continue;
    }
    const [format, width] = file.variant.split('-') as ['avif' | 'webp', string];
    (variants[format] ??= {})[width] = key;
  }
  return { storageKey: assetFolder(owner, asset.contentHash), variants, storedBytes };
}

export const FAVICON_SIZES = ['32', '180', '512'] as const;

/** Square PNG favicons drawn from a logo, the logo fitted inside on a transparent ground. */
export async function faviconFiles(asset: { kind: MediaKind; original: Uint8Array }): Promise<Record<'32' | '180' | '512', Uint8Array>> {
  if (asset.kind === 'ICON') throw new Error('An icon is used as the favicon as it is');
  const files = {} as Record<'32' | '180' | '512', Uint8Array>;
  for (const size of FAVICON_SIZES) {
    const px = Number(size);
    const source = asset.kind === 'SVG' ? sharp(Buffer.from(asset.original), { density: 600 }) : sharp(asset.original, INPUT).rotate();
    const png = await source
      .resize(px, px, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .ensureAlpha()
      .png()
      .toBuffer();
    files[size] = toBytes(png);
  }
  return files;
}
