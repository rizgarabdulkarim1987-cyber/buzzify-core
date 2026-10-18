/**
 * What the media library accepts (spec 11, and stage 2 of the Template Studio for scene files): pictures in six types and
 * scene files in three, judged by their bytes rather than by their names, each kind with its own size limit.
 */

/** The limit for pictures. */
export const MEDIA_MAX_BYTES = 15 * 1024 * 1024;

export const PICTURE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/svg+xml', 'image/x-icon'] as const;
/** A GLB model, an MP4 video and a Lottie animation, for a template menu's background. */
export const SCENE_MIMES = ['model/gltf-binary', 'video/mp4', 'application/json'] as const;
export const MEDIA_MIMES = [...PICTURE_MIMES, ...SCENE_MIMES] as const;
export type MediaMime = (typeof MEDIA_MIMES)[number];
export type SceneMime = (typeof SCENE_MIMES)[number];

const SCENE_LIMITS: Record<SceneMime, number> = {
  'model/gltf-binary': 10 * 1024 * 1024,
  'video/mp4': 20 * 1024 * 1024,
  'application/json': 2 * 1024 * 1024,
};

/** The most an upload may be, whatever it turns out to be: the largest limit of any kind. */
export const UPLOAD_MAX_BYTES = Math.max(MEDIA_MAX_BYTES, ...Object.values(SCENE_LIMITS));

export function isSceneMime(mime: MediaMime): mime is SceneMime {
  return (SCENE_MIMES as readonly string[]).includes(mime);
}

/** The size limit of a type: a background must load on mobile data, so scene files have their own. */
export function maxBytesFor(mime: MediaMime): number {
  return isSceneMime(mime) ? SCENE_LIMITS[mime] : MEDIA_MAX_BYTES;
}

/** Types a browser may name a file with, for the ones it names in more than one way. */
const DECLARED_ALIASES: Record<string, MediaMime> = {
  'image/vnd.microsoft.icon': 'image/x-icon',
  'image/jpg': 'image/jpeg',
  'model/gltf+binary': 'model/gltf-binary',
};

/** MP4 brands, major or compatible. QuickTime's `qt  ` and HEIF's brands are not MP4. */
const MP4_BRANDS = new Set(['isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'M4V ', 'M4VH', 'M4VP', 'dash', 'mmp4', 'msnv']);

const ascii = (bytes: Uint8Array, from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));

const starts = (bytes: Uint8Array, signature: readonly number[]) => signature.every((value, i) => bytes[i] === value);

/** The brands an ISO base media file (AVIF, HEIC, MP4) names in its `ftyp` box: the major one, then the compatible ones. */
function ftypBrands(bytes: Uint8Array): string[] {
  if (bytes.length < 16 || ascii(bytes, 4, 8) !== 'ftyp') return [];
  const size = Math.min(bytes.length, (bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!);
  const brands = [ascii(bytes, 8, 12)];
  for (let at = 16; at + 4 <= size; at += 4) brands.push(ascii(bytes, at, at + 4));
  return brands;
}

/** AVIF is `avif`, `avis`, or listed as compatible; it wins over any MP4 brand beside it. */
const isAvif = (brands: string[]) => brands.includes('avif') || brands.includes('avis');

/** The first element of an XML document, after a BOM, the XML declaration, comments, a doctype and whitespace. */
function firstElement(text: string): string | null {
  let rest = text.replace(/^﻿/, '');
  for (;;) {
    rest = rest.trimStart();
    if (rest.startsWith('<?')) {
      const end = rest.indexOf('?>');
      if (end < 0) return null;
      rest = rest.slice(end + 2);
    } else if (rest.startsWith('<!--')) {
      const end = rest.indexOf('-->');
      if (end < 0) return null;
      rest = rest.slice(end + 3);
    } else if (/^<!doctype\s+svg\b/i.test(rest)) {
      const end = rest.indexOf('>');
      if (end < 0) return null;
      rest = rest.slice(end + 1);
    } else {
      const match = /^<([A-Za-z][\w:.-]*)/.exec(rest);
      return match ? match[1]!.toLowerCase() : null;
    }
  }
}

/**
 * The type of a file from its first bytes (the first 4 KB are enough), or null when it is not one the library accepts.
 * An SVG is a text file whose first element is `svg`: an HTML page that contains one is not. An MP4 names an MP4 brand in
 * its `ftyp` box, a GLB starts with `glTF`, and a Lottie animation is a JSON object (its own check decides whether it is
 * one).
 */
export function sniffMediaType(head: Uint8Array): MediaMime | null {
  if (starts(head, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (starts(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (head.length >= 12 && ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 12) === 'WEBP') return 'image/webp';
  const brands = ftypBrands(head);
  if (isAvif(brands)) return 'image/avif';
  if (brands.some((brand) => MP4_BRANDS.has(brand))) return 'video/mp4';
  if (starts(head, [0x00, 0x00, 0x01, 0x00]) && head.length >= 6 && (head[4]! | (head[5]! << 8)) > 0) return 'image/x-icon';
  if (head.length >= 12 && ascii(head, 0, 4) === 'glTF') return 'model/gltf-binary';

  const text = new TextDecoder('utf-8', { fatal: false }).decode(head.subarray(0, 4096));
  if (firstElement(text) === 'svg') return 'image/svg+xml';
  if (text.replace(/^﻿/, '').trimStart().startsWith('{')) return 'application/json';
  return null;
}

/** The declared type as the library names it, or null for one it does not accept. */
export function declaredMime(mime: string): MediaMime | null {
  const value = mime.trim().toLowerCase();
  if ((MEDIA_MIMES as readonly string[]).includes(value)) return value as MediaMime;
  return DECLARED_ALIASES[value] ?? null;
}

/** What a browser says about a file before uploading it: refused early, then checked again from its bytes. */
export function checkUploadRequest(request: { mime: string; bytes: number }): null | 'TYPE' | 'SIZE' {
  const mime = declaredMime(request.mime);
  if (mime === null) return 'TYPE';
  if (!Number.isInteger(request.bytes) || request.bytes <= 0 || request.bytes > maxBytesFor(mime)) return 'SIZE';
  return null;
}
