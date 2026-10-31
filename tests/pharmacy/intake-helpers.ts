import sharp from 'sharp';
import type { IntakeStorage } from '@/server/pharmacy/intake/storage';

/** An in-memory adapter: counts what is stored, so "no second object" can be asserted. */
export function memoryIntakeStorage(): IntakeStorage & {
  objects: Map<string, { bytes: Uint8Array; mediaType: string }>;
  urls: { key: string; ttlSeconds: number; inline: boolean }[];
  /** Test hooks: run inside `put` (before the object is kept) and `delete`; a throw from either fails that call. */
  hooks: { onPut?: (key: string) => Promise<void> | void; onDelete?: (key: string) => Promise<void> | void };
} {
  const objects = new Map<string, { bytes: Uint8Array; mediaType: string }>();
  const urls: { key: string; ttlSeconds: number; inline: boolean }[] = [];
  const hooks: { onPut?: (key: string) => Promise<void> | void; onDelete?: (key: string) => Promise<void> | void } = {};
  return {
    objects,
    urls,
    hooks,
    async put(key, bytes, mediaType) {
      await hooks.onPut?.(key);
      objects.set(key, { bytes: new Uint8Array(bytes), mediaType });
    },
    async get(key) {
      return objects.get(key) ?? null;
    },
    async signedUrl(key, ttlSeconds, options) {
      urls.push({ key, ttlSeconds, inline: options?.inline === true });
      return `memory://${key}?ttl=${ttlSeconds}`;
    },
    async delete(key) {
      await hooks.onDelete?.(key);
      objects.delete(key);
    },
  };
}

/** A small deterministic generator, so every run draws the same page. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

/**
 * A text-like page: rows of small black blocks (glyph-sized: 3 to 9 px wide, 10 to 14 px tall at `scale` 1) on white, like a printed invoice. Built from shapes, so it
 * does not depend on fonts installed on the machine. `seed` changes the page (and its sha256). `scale` multiplies every size
 * of the drawing (glyphs, row pitch, margins): a photo of the same page taken at 1000, 1600 or 3000 px wide is `scale`
 * 0.625, 1 or 1.875. `lines` limits the text to that many rows and leaves the rest of the page blank (a sparse invoice).
 */
export async function pageImage(opts: { width?: number; height?: number; seed?: number; ink?: number; paper?: number; format?: 'jpeg' | 'png' | 'webp'; scale?: number; lines?: number } = {}): Promise<Buffer> {
  const width = opts.width ?? 1600;
  const height = opts.height ?? 2200;
  const ink = opts.ink ?? 10;
  const paper = opts.paper ?? 250;
  const k = opts.scale ?? 1;
  const rand = lcg(opts.seed ?? 1);
  const rects: string[] = [];
  const rows = Math.min(Math.floor(height / (24 * k)) - 2, opts.lines ?? Infinity);
  for (let row = 0; row < rows; row += 1) {
    let x = 60 * k;
    const y = (50 + row * 24) * k;
    while (x < width - 80 * k) {
      const w = (3 + Math.floor(rand() * 7)) * k;
      rects.push(`<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${((10 + Math.floor(rand() * 5)) * k).toFixed(2)}" fill="rgb(${ink},${ink},${ink})"/>`);
      x += (w / k + 2 + Math.floor(rand() * 4)) * k;
      if (rand() < 0.15) x += 10 * k;
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="rgb(${paper},${paper},${paper})"/>${rects.join('')}</svg>`;
  const image = sharp(Buffer.from(svg));
  const format = opts.format ?? 'jpeg';
  return format === 'png' ? image.png().toBuffer() : format === 'webp' ? image.webp().toBuffer() : image.jpeg({ quality: 92 }).toBuffer();
}

/**
 * The page of a photo taken `width` px wide and out of focus: the drawing at `scale` = width / 1600, blurred by `sigma` px at
 * the 1600 px size (`sigma` 3 is a clearly unreadable photo, 0.7 a slightly soft one). The blur is scaled with the photo, so
 * the same defocus is the same severity at 1000, 1600 and 3000 px.
 */
export async function photoOfPage(opts: { width: number; seed?: number; sigma?: number; lines?: number }): Promise<Buffer> {
  const scale = opts.width / 1600;
  const base = await pageImage({ width: opts.width, height: Math.round(opts.width * 1.4), scale, seed: opts.seed ?? 7, lines: opts.lines, format: 'png' });
  const sigma = (opts.sigma ?? 0) * scale;
  return (sigma > 0.3 ? sharp(base).blur(sigma) : sharp(base)).jpeg({ quality: 92 }).toBuffer();
}

/** The blurred invoice the upload tests use: a 1600 px photo at sigma 3, which the gate must refuse. */
export const blurredPage = (seed: number): Promise<Buffer> => photoOfPage({ width: 1600, seed, sigma: 3 });

/** A page with a bytes-for-bytes different body of the same quality (for tests that need many different files). */
export const uniquePage = (seed: number, over: Parameters<typeof pageImage>[0] = {}) => pageImage({ ...over, seed });

/** A minimal PDF with `pages` page objects and plain (uncompressed) objects, which `countPdfPages` can count. */
export function pdfWithPages(pages: number, tag = ''): Buffer {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Count ${pages} /Kids [] >>`];
  for (let i = 0; i < pages; i += 1) objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>');
  const body = objects.map((o, i) => `${i + 1} 0 obj\n${o}\nendobj\n`).join('');
  return Buffer.from(`%PDF-1.4\n% ${tag}\n${body}trailer\n<< /Root 1 0 R >>\n%%EOF\n`, 'latin1');
}
