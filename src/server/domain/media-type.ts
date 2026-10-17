/**
 * What the media library accepts (spec 11): six types, judged by their bytes rather than by their names, and 15 MB.
 */

export const MEDIA_MAX_BYTES = 15 * 1024 * 1024;

export const MEDIA_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/svg+xml', 'image/x-icon'] as const;
export type MediaMime = (typeof MEDIA_MIMES)[number];

/** Types a browser may name a file with, for the ones it names in more than one way. */
const DECLARED_ALIASES: Record<string, MediaMime> = { 'image/vnd.microsoft.icon': 'image/x-icon', 'image/jpg': 'image/jpeg' };

const ascii = (bytes: Uint8Array, from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));

const starts = (bytes: Uint8Array, signature: readonly number[]) => signature.every((value, i) => bytes[i] === value);

/** ISO base media files (AVIF, HEIC) name their brands in an `ftyp` box; AVIF is `avif`, `avis`, or listed as compatible. */
function isAvif(bytes: Uint8Array): boolean {
  if (bytes.length < 16 || ascii(bytes, 4, 8) !== 'ftyp') return false;
  const size = Math.min(bytes.length, (bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!);
  const brands = [ascii(bytes, 8, 12)];
  for (let at = 16; at + 4 <= size; at += 4) brands.push(ascii(bytes, at, at + 4));
  return brands.includes('avif') || brands.includes('avis');
}

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
 * An SVG is a text file whose first element is `svg`: an HTML page that contains one is not.
 */
export function sniffMediaType(head: Uint8Array): MediaMime | null {
  if (starts(head, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (starts(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (head.length >= 12 && ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 12) === 'WEBP') return 'image/webp';
  if (isAvif(head)) return 'image/avif';
  if (starts(head, [0x00, 0x00, 0x01, 0x00]) && head.length >= 6 && (head[4]! | (head[5]! << 8)) > 0) return 'image/x-icon';

  const text = new TextDecoder('utf-8', { fatal: false }).decode(head.subarray(0, 4096));
  if (firstElement(text) === 'svg') return 'image/svg+xml';
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
  if (declaredMime(request.mime) === null) return 'TYPE';
  if (!Number.isInteger(request.bytes) || request.bytes <= 0 || request.bytes > MEDIA_MAX_BYTES) return 'SIZE';
  return null;
}
