import { createHash } from 'node:crypto';
import sharp, { type Sharp } from 'sharp';
import type { MediaKind } from '@/generated/prisma/client';
import { maxBytesFor, sniffMediaType, UPLOAD_MAX_BYTES, type MediaMime } from '@/server/domain/media-type';
import { assetFolder, assetKey, IMMUTABLE_CACHE } from '@/server/storage/keys';
import type { Storage } from '@/server/storage/storage';
import { checkGlb, type GlbRefusal } from './glb';
import { checkLottie, type LottieRefusal } from './lottie';
import { readMp4, type Mp4Refusal } from './mp4';
import { sanitizeSvg } from './svg';

/**
 * Turning an upload into a library asset (spec 11): its real type from its bytes, its hash, and its variants. Photos
 * lose their metadata (a phone photo can carry where it was taken), stand upright, and are made into AVIF and WebP at
 * the widths the menu asks for, never larger than they are. SVGs are sanitized and also drawn as WebP for the places
 * that need pixels (favicons, social images, QR codes). Icons are kept as they are.
 *
 * Scene files (Template Studio stage 2) are checked by their own parsers and kept as uploaded, except a Lottie animation,
 * stored as its checked JSON. A video brings a poster frame (the Studio takes it in the browser), made into widths like
 * a photo.
 */

export type MediaRefusal = 'TYPE' | 'SIZE' | 'DIMENSIONS' | 'UNREADABLE' | 'SVG_UNSAFE' | 'POSTER' | GlbRefusal | Mp4Refusal | LottieRefusal;

export interface PreparedFile {
  variant: string;
  ext: 'avif' | 'webp' | 'png' | 'jpg' | 'svg' | 'ico' | 'glb' | 'mp4' | 'json';
  contentType: string;
  body: Uint8Array;
}

export interface PreparedAsset {
  kind: MediaKind;
  mime: MediaMime;
  /** SHA-256 of the bytes as uploaded, in hex. */
  contentHash: string;
  bytes: number;
  /** None for a model. */
  width: number | null;
  height: number | null;
  /** A video's or a Lottie animation's length. */
  durationMs: number | null;
  /** What a scene file holds (`MediaAsset.meta`); empty for pictures. */
  meta: Record<string, unknown>;
  /** A tiny blurred WebP as a data URI (a video's is of its poster); empty for SVGs, icons, models and Lottie. */
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
  /** A video's poster frame. */
  poster?: { avif: Record<string, string>; webp: Record<string, string> };
}

export const IMAGE_WIDTHS = [320, 640, 1080, 1600] as const;
export const SVG_WIDTHS = [320, 640] as const;
export const POSTER_WIDTHS = [320, 640, 1080] as const;
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

type Prepared = { ok: true; asset: PreparedAsset } | { ok: false; reason: MediaRefusal };

const hashOf = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** The size of a picture standing upright, or null when it is not a picture sharp can read. */
async function uprightSize(bytes: Uint8Array): Promise<{ width: number; height: number } | null> {
  try {
    const meta = await sharp(bytes, INPUT).metadata();
    if (!meta.width || !meta.height) return null;
    // Orientations 5 to 8 turn the picture a quarter: it stands upright with its sides swapped.
    const turned = (meta.orientation ?? 1) >= 5;
    return turned ? { width: meta.height, height: meta.width } : { width: meta.width, height: meta.height };
  } catch {
    return null;
  }
}

/** AVIF and WebP renditions at each width no wider than the picture (its own width when it is narrower than them all). */
async function widthFiles(bytes: Uint8Array, width: number, all: readonly number[], prefix: '' | 'poster-'): Promise<PreparedFile[]> {
  const widths: number[] = all.filter((w) => w <= width);
  if (widths.length === 0) widths.push(width);
  const files: PreparedFile[] = [];
  for (const w of widths) {
    const resized = () => sharp(bytes, INPUT).rotate().resize({ width: w, withoutEnlargement: true });
    files.push({ variant: `${prefix}avif-${w}`, ext: 'avif', contentType: 'image/avif', body: toBytes(await resized().avif({ quality: 55, effort: 4 }).toBuffer()) });
    files.push({ variant: `${prefix}webp-${w}`, ext: 'webp', contentType: 'image/webp', body: toBytes(await resized().webp({ quality: 75 }).toBuffer()) });
  }
  return files;
}

async function prepareModel(bytes: Uint8Array): Promise<Prepared> {
  const checked = await checkGlb(bytes);
  if (!checked.ok) return { ok: false, reason: checked.reason };
  return {
    ok: true,
    asset: {
      kind: 'MODEL',
      mime: 'model/gltf-binary',
      contentHash: hashOf(bytes),
      bytes: bytes.length,
      width: null,
      height: null,
      durationMs: null,
      meta: { ...checked.meta },
      placeholder: '',
      files: [{ variant: 'original', ext: 'glb', contentType: 'model/gltf-binary', body: bytes }],
    },
  };
}

async function prepareLottie(bytes: Uint8Array): Promise<Prepared> {
  const checked = await checkLottie(bytes);
  if (!checked.ok) return { ok: false, reason: checked.reason };
  const { width, height, durationMs, frameRate, layers } = checked.info;
  return {
    ok: true,
    asset: {
      kind: 'LOTTIE',
      mime: 'application/json',
      contentHash: hashOf(bytes),
      bytes: bytes.length,
      width,
      height,
      durationMs,
      meta: { frameRate, layers },
      placeholder: '',
      files: [{ variant: 'original', ext: 'json', contentType: 'application/json', body: new TextEncoder().encode(checked.json) }],
    },
  };
}

/** A video and its poster frame: the poster must be a photo, and becomes widths and the placeholder. */
async function prepareVideo(bytes: Uint8Array, poster: Uint8Array | undefined): Promise<Prepared> {
  const read = readMp4(bytes);
  if (!read.ok) return { ok: false, reason: read.reason };
  if (!poster || poster.length > maxBytesFor('image/jpeg')) return { ok: false, reason: 'POSTER' };
  const posterType = sniffMediaType(poster.subarray(0, 4096));
  if (posterType !== 'image/jpeg' && posterType !== 'image/png' && posterType !== 'image/webp') return { ok: false, reason: 'POSTER' };
  const size = await uprightSize(poster);
  if (!size || Math.max(size.width, size.height) > MAX_SIDE) return { ok: false, reason: 'POSTER' };
  try {
    const { durationMs, width, height, codec, hasAudio } = read.info;
    return {
      ok: true,
      asset: {
        kind: 'VIDEO',
        mime: 'video/mp4',
        contentHash: hashOf(bytes),
        bytes: bytes.length,
        width,
        height,
        durationMs,
        meta: { codec, hasAudio },
        placeholder: await placeholderOf(poster),
        files: [{ variant: 'original', ext: 'mp4', contentType: 'video/mp4', body: bytes }, ...(await widthFiles(poster, size.width, POSTER_WIDTHS, 'poster-'))],
      },
    };
  } catch {
    return { ok: false, reason: 'POSTER' };
  }
}

async function prepareRaster(bytes: Uint8Array, mime: keyof typeof RASTER_EXT): Promise<Prepared> {
  const size = await uprightSize(bytes);
  if (!size) return { ok: false, reason: 'UNREADABLE' };
  const { width, height } = size;
  if (Math.max(width, height) > MAX_SIDE || Math.max(width, height) > MAX_ASPECT * Math.min(width, height)) {
    return { ok: false, reason: 'DIMENSIONS' };
  }

  try {
    const upright = () => sharp(bytes, INPUT).rotate();
    const files: PreparedFile[] = [
      { variant: 'original', ext: RASTER_EXT[mime], contentType: mime, body: toBytes(await reencode(upright(), mime).toBuffer()) },
      ...(await widthFiles(bytes, width, IMAGE_WIDTHS, '')),
    ];
    return {
      ok: true,
      asset: {
        kind: 'IMAGE',
        mime,
        contentHash: hashOf(bytes),
        bytes: bytes.length,
        width,
        height,
        durationMs: null,
        meta: {},
        placeholder: await placeholderOf(bytes),
        files,
      },
    };
  } catch {
    return { ok: false, reason: 'UNREADABLE' };
  }
}

/**
 * Checks an upload and makes everything the library stores for it; nothing is written anywhere. A video needs its
 * `poster` frame; any other file ignores one. Each kind is held to its own size limit once its bytes say what it is.
 */
export async function prepareAsset(bytes: Uint8Array, poster?: Uint8Array): Promise<Prepared> {
  if (bytes.length > UPLOAD_MAX_BYTES) return { ok: false, reason: 'SIZE' };
  const mime = sniffMediaType(bytes.subarray(0, 4096));
  if (mime === null) return { ok: false, reason: 'TYPE' };
  if (bytes.length > maxBytesFor(mime)) return { ok: false, reason: 'SIZE' };
  if (mime === 'model/gltf-binary') return prepareModel(bytes);
  if (mime === 'video/mp4') return prepareVideo(bytes, poster);
  if (mime === 'application/json') return prepareLottie(bytes);
  const contentHash = hashOf(bytes);

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
      return {
        ok: true,
        asset: { kind: 'SVG', mime, contentHash, bytes: bytes.length, width: clean.width, height: clean.height, durationMs: null, meta: {}, placeholder: '', files },
      };
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
        durationMs: null,
        meta: {},
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
    if (file.variant.startsWith('poster-')) {
      const [, format, width] = file.variant.split('-') as [string, 'avif' | 'webp', string];
      (variants.poster ??= { avif: {}, webp: {} })[format][width] = key;
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
