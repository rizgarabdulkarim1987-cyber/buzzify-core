import sharp from 'sharp';
import type { IntakeStorage } from '@/server/pharmacy/intake/storage';

/** An in-memory adapter: counts what is stored, so "no second object" can be asserted. */
export function memoryIntakeStorage(): IntakeStorage & {
  objects: Map<string, { bytes: Uint8Array; mediaType: string }>;
  urls: { key: string; ttlSeconds: number }[];
} {
  const objects = new Map<string, { bytes: Uint8Array; mediaType: string }>();
  const urls: { key: string; ttlSeconds: number }[] = [];
  return {
    objects,
    urls,
    async put(key, bytes, mediaType) {
      objects.set(key, { bytes: new Uint8Array(bytes), mediaType });
    },
    async get(key) {
      return objects.get(key) ?? null;
    },
    async signedUrl(key, ttlSeconds) {
      urls.push({ key, ttlSeconds });
      return `memory://${key}?ttl=${ttlSeconds}`;
    },
    async delete(key) {
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
 * A text-like page: rows of small black blocks (glyph-sized: 3 to 9 px wide, 10 to 14 px tall on a 1600 px page) on white, like a printed invoice. Built from shapes, so it
 * does not depend on fonts installed on the machine. `seed` changes the page (and its sha256).
 */
export async function pageImage(opts: { width?: number; height?: number; seed?: number; ink?: number; paper?: number; format?: 'jpeg' | 'png' | 'webp' } = {}): Promise<Buffer> {
  const width = opts.width ?? 1600;
  const height = opts.height ?? 2200;
  const ink = opts.ink ?? 10;
  const paper = opts.paper ?? 250;
  const rand = lcg(opts.seed ?? 1);
  const rects: string[] = [];
  for (let row = 0; row < Math.floor(height / 24) - 2; row += 1) {
    let x = 60;
    const y = 50 + row * 24;
    while (x < width - 80) {
      const w = 3 + Math.floor(rand() * 7);
      rects.push(`<rect x="${x}" y="${y}" width="${w}" height="${10 + Math.floor(rand() * 5)}" fill="rgb(${ink},${ink},${ink})"/>`);
      x += w + 2 + Math.floor(rand() * 4);
      if (rand() < 0.15) x += 10;
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="rgb(${paper},${paper},${paper})"/>${rects.join('')}</svg>`;
  const image = sharp(Buffer.from(svg));
  const format = opts.format ?? 'jpeg';
  return format === 'png' ? image.png().toBuffer() : format === 'webp' ? image.webp().toBuffer() : image.jpeg({ quality: 92 }).toBuffer();
}

/** A page with a bytes-for-bytes different body of the same quality (for tests that need many different files). */
export const uniquePage = (seed: number, over: Parameters<typeof pageImage>[0] = {}) => pageImage({ ...over, seed });

/** A minimal PDF with `pages` page objects and plain (uncompressed) objects, which `countPdfPages` can count. */
export function pdfWithPages(pages: number, tag = ''): Buffer {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Count ${pages} /Kids [] >>`];
  for (let i = 0; i < pages; i += 1) objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>');
  const body = objects.map((o, i) => `${i + 1} 0 obj\n${o}\nendobj\n`).join('');
  return Buffer.from(`%PDF-1.4\n% ${tag}\n${body}trailer\n<< /Root 1 0 R >>\n%%EOF\n`, 'latin1');
}
