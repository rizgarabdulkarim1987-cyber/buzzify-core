/**
 * Client side of the AI Doctor's photo: shrink and re-encode the picked file in the browser so that the request stays under the
 * Server Actions' 1 MB body default (no config change) and far under the server's own 4 MB bound (`checkPhoto`). The long side is
 * at most 1600 px and the JPEG quality steps down, then the size, until the base64 is under `PHOTO_BASE64_TARGET`. One photo per
 * request. The photo is only ever in memory here: it is never stored. Client-only (canvas), so the browser parts sit behind `PhotoEnv`.
 */

export const PHOTO_LONG_SIDE = 1600;
/** Base64 characters, safely below the 1 MB body default once the rest of the request is added. */
export const PHOTO_BASE64_TARGET = 900_000;
/** A picked file larger than this is not even decoded. */
const MAX_PICKED_BYTES = 25 * 1024 * 1024;
const MIN_LONG_SIDE = 400;
const QUALITIES = [0.85, 0.75, 0.65, 0.55, 0.45];
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];

export type DoctorPhotoCode = 'TYPE' | 'SIZE' | 'DECODE';
export class DoctorPhotoError extends Error {
  constructor(readonly code: DoctorPhotoCode) {
    super(code);
    this.name = 'DoctorPhotoError';
  }
}

export interface PhotoImage { width: number; height: number; close?(): void }
export interface PhotoEnv {
  decode(file: File): Promise<PhotoImage>;
  /** The image drawn at `width` x `height` and encoded as JPEG at `quality`. */
  encode(image: PhotoImage, width: number, height: number, quality: number): Promise<Blob>;
}

export function fitWithin(width: number, height: number, longSide: number): { width: number; height: number } {
  const scale = Math.min(1, longSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

const browserEnv: PhotoEnv = {
  decode: (file) => createImageBitmap(file) as Promise<PhotoImage>,
  async encode(image, width, height, quality) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas');
    ctx.fillStyle = '#fff'; // a transparent PNG must not turn black in JPEG
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(image as unknown as CanvasImageSource, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) throw new Error('no encode');
    return blob;
  },
};

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export async function prepareDoctorPhoto(file: File, env: PhotoEnv = browserEnv): Promise<{ mime: 'image/jpeg'; base64: string }> {
  if (!ALLOWED.includes(file.type)) throw new DoctorPhotoError('TYPE');
  if (file.size > MAX_PICKED_BYTES) throw new DoctorPhotoError('SIZE');
  let image: PhotoImage;
  try {
    image = await env.decode(file);
  } catch {
    throw new DoctorPhotoError('DECODE');
  }
  try {
    const start = Math.min(PHOTO_LONG_SIDE, Math.max(image.width, image.height));
    for (let longSide = start; ; longSide = Math.floor(longSide * 0.8)) {
      const { width, height } = fitWithin(image.width, image.height, longSide);
      for (const quality of QUALITIES) {
        let blob: Blob;
        try {
          blob = await env.encode(image, width, height, quality);
        } catch {
          throw new DoctorPhotoError('DECODE');
        }
        if (blob.size > (PHOTO_BASE64_TARGET * 3) / 4) continue; // cannot fit once base64 (4/3): skip the conversion
        const base64 = await toBase64(blob);
        if (base64.length <= PHOTO_BASE64_TARGET) return { mime: 'image/jpeg', base64 };
      }
      if (longSide < MIN_LONG_SIDE) break;
    }
    throw new DoctorPhotoError('SIZE');
  } finally {
    image.close?.();
  }
}
