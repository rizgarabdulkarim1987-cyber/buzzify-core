import { similarity } from './similarity';

/**
 * Choosing how hard to compress one image (spec: smart image compression): the lowest quality whose result a person
 * cannot tell from the source.
 */

/**
 * The lowest similarity (see `similarity`) at which a rendition still looks the same as its source.
 *
 * Calibrated on 2026-10-18 on two 1254 × 1254 product photos (a loaded nachos bag on a wooden table against black: fine
 * meat and chip texture, glossy sauce, printed lettering), compared at 1080 px and at 2× zoom against the source.
 * AVIF 45 (0.968) and WebP 65 (0.974) were the first to soften the meat texture visibly; AVIF 55 (0.980) and WebP 72
 * (0.977) showed no difference. The fixed settings used until then (AVIF 55, WebP 75) score about 0.98 at 1080 px and
 * 0.968 at 320 px, where every pixel carries more of the picture.
 */
export const VISUALLY_LOSSLESS = 0.975;

/**
 * The qualities a search may choose from, per encoder. A floor is never gone below, whatever the score says; a ceiling
 * may be above the fixed qualities used before, because the promise is the look, not a smaller file every time.
 */
export const QUALITY = {
  jpeg: { floor: 60, ceiling: 92 },
  webp: { floor: 55, ceiling: 92 },
  avif: { floor: 35, ceiling: 75 },
} as const satisfies Record<'jpeg' | 'webp' | 'avif', { floor: number; ceiling: number }>;

export interface QualityBounds {
  floor: number;
  ceiling: number;
}

export interface Found {
  quality: number;
  body: Buffer;
  score: number;
}

/**
 * The lowest whole quality within `bounds` whose output scores at least `threshold` against `source` (both seen at
 * `width` pixels wide), with at most `maxTries` encodes. The floor is tried first (a plain picture often passes there),
 * then the ceiling (a picture that fails even there gets the ceiling), then a binary search between them. With too few
 * tries for an exact answer, the lowest passing quality tried is returned.
 */
export async function searchQuality(args: {
  source: Uint8Array | Buffer;
  width: number;
  bounds: QualityBounds;
  encode: (quality: number) => Promise<Buffer>;
  threshold?: number;
  maxTries?: number;
}): Promise<Found> {
  const { source, width, bounds, encode } = args;
  const threshold = args.threshold ?? VISUALLY_LOSSLESS;
  const maxTries = Math.max(2, args.maxTries ?? 6);
  let tries = 0;
  const attempt = async (quality: number): Promise<Found> => {
    tries++;
    const body = await encode(quality);
    return { quality, body, score: await similarity(source, body, width) };
  };

  const floor = await attempt(bounds.floor);
  if (floor.score >= threshold || bounds.ceiling <= bounds.floor) return floor;
  let best = await attempt(bounds.ceiling);
  if (best.score < threshold) return best;

  // `low` failed and `best` (at `high + 1`) passed; the untried candidates are `low + 1` to `high`.
  let low = bounds.floor;
  let high = bounds.ceiling - 1;
  while (low + 1 <= high && tries < maxTries) {
    const middle = Math.floor((low + 1 + high) / 2);
    const tried = await attempt(middle);
    if (tried.score >= threshold) {
      best = tried;
      high = middle - 1;
    } else {
      low = middle;
    }
  }
  return best;
}
