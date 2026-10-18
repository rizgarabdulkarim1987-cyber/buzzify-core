import { referenceOf, similarityTo, type ImageInput } from './similarity';

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
 * The qualities a search may choose from, per encoder, and where it starts: the fixed quality used before, which most
 * photos pass, so a search cut short by time is never worse than before. A floor is never gone below, whatever the score
 * says; a ceiling may be above the starting quality, because the promise is the look, not a smaller file every time.
 */
export const QUALITY = {
  jpeg: { floor: 60, start: 85, ceiling: 92 },
  webp: { floor: 55, start: 75, ceiling: 92 },
  avif: { floor: 35, start: 55, ceiling: 75 },
} as const satisfies Record<'jpeg' | 'webp' | 'avif', QualityBounds>;

export interface QualityBounds {
  floor: number;
  /** The first quality tried; clamped into the bounds. */
  start: number;
  ceiling: number;
}

export interface Found {
  quality: number;
  body: Buffer;
  /** The similarity of `body` to the source; NaN when the deadline had passed and nothing was compared. */
  score: number;
}

/**
 * The lowest whole quality within `bounds` whose output scores at least `threshold` against `source` (both seen at
 * `width` pixels wide), with at most `maxTries` encodes (5 by default). The starting quality is tried first; when it
 * passes, the floor next (a plain picture often passes there too), and when it fails, the ceiling next (a picture that
 * fails even there gets the ceiling); then a binary search between the last failure and the last pass. With too few
 * tries for an exact answer, the lowest passing quality tried is returned.
 */
export async function searchQuality(args: {
  source: ImageInput;
  width: number;
  bounds: QualityBounds;
  encode: (quality: number) => Promise<Buffer>;
  threshold?: number;
  maxTries?: number;
  /**
   * When to stop searching (a `Date.now()` value): past it, the lowest passing quality tried so far is kept, and a
   * search that has not started encodes the starting quality and nothing else, so a slow server still answers in time.
   */
  deadline?: number;
}): Promise<Found> {
  const { source, width, bounds, encode } = args;
  const threshold = args.threshold ?? VISUALLY_LOSSLESS;
  const ceiling = Math.max(bounds.floor, bounds.ceiling);
  const start = Math.min(ceiling, Math.max(bounds.floor, bounds.start));
  // Five tries find the quality to within about 2 steps, and keep a 12 MP photo's upload within seconds.
  const maxTries = Math.max(2, args.maxTries ?? 5);
  const late = () => args.deadline !== undefined && Date.now() > args.deadline;
  if (late()) return { quality: start, body: await encode(start), score: Number.NaN };
  let tries = 0;
  const reference = await referenceOf(source, width);
  const attempt = async (quality: number): Promise<Found> => {
    tries++;
    const body = await encode(quality);
    return { quality, body, score: await similarityTo(reference, body) };
  };

  const first = await attempt(start);
  // `low` failed (or is the floor, which is never gone below) and `best` passed at `high + 1`.
  let low: number;
  let best: Found;
  if (first.score >= threshold) {
    if (start === bounds.floor || late()) return first;
    const floor = await attempt(bounds.floor);
    if (floor.score >= threshold) return floor;
    low = bounds.floor;
    best = first;
  } else {
    if (start === ceiling || late()) return first;
    const top = await attempt(ceiling);
    if (top.score < threshold) return top;
    low = start;
    best = top;
  }
  let high = best.quality - 1;
  while (low + 1 <= high && tries < maxTries && !late()) {
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
