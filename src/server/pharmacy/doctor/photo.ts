/**
 * The one server-side check of a photo sent to the AI Doctor. The declared type is only a claim of the caller: the type is read
 * from the first bytes (JPEG FF D8 FF, PNG 89 50 4E 47, WebP "RIFF" .... "WEBP"), and anything else (an executable, a GIF, text)
 * is refused whatever it says it is. The sniffed type is what goes to the model. Nothing here writes the photo anywhere.
 */

export const PHOTO_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type PhotoMime = (typeof PHOTO_MIMES)[number];

/** The largest photo accepted, decoded. The client shrinks far below it (about 0.7 MB); this is the server's upper bound. */
export const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
/** The base64 length of `MAX_PHOTO_BYTES` (a cheap pre-check, and the action input's length cap). */
export const MAX_PHOTO_BASE64_CHARS = Math.ceil(MAX_PHOTO_BYTES / 3) * 4;

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export type PhotoCheck = { ok: true; mime: PhotoMime } | { ok: false; code: 'TYPE' | 'SIZE' };

function sniff(b: Buffer): PhotoMime | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export function checkPhoto(input: { mime: string; base64: string }): PhotoCheck {
  if (!(PHOTO_MIMES as readonly string[]).includes(input.mime)) return { ok: false, code: 'TYPE' };
  if (input.base64.length > MAX_PHOTO_BASE64_CHARS) return { ok: false, code: 'SIZE' };
  if (input.base64.length === 0 || input.base64.length % 4 !== 0 || !BASE64.test(input.base64)) return { ok: false, code: 'TYPE' };
  const bytes = Buffer.from(input.base64, 'base64');
  if (bytes.length > MAX_PHOTO_BYTES) return { ok: false, code: 'SIZE' };
  const mime = sniff(bytes);
  return mime ? { ok: true, mime } : { ok: false, code: 'TYPE' };
}
