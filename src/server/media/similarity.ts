import sharp, { type Sharp } from 'sharp';

/**
 * How alike two renditions of one picture look, for choosing how hard to compress it (spec: smart image compression).
 * The score is the mean SSIM of their luminance; 1 is identical. Colour is left to the encoders, which keep it far better
 * than detail. A picture with transparency is scored as it is displayed: its luminance over black and over white, and
 * its alpha, the lowest of the three, and only where something is visible (the colour hidden under full transparency,
 * and areas that are transparent in both, do not count).
 */

/** One channel of an image, a byte per pixel, row by row. */
export interface Plane {
  data: Uint8Array;
  width: number;
  height: number;
}

/** An image already decoded: 8-bit pixels, row by row, with `channels` per pixel (2 and 4 have alpha). */
export interface RawImage {
  data: Uint8Array;
  width: number;
  height: number;
  channels: 1 | 2 | 3 | 4;
}

/** An encoded file, or pixels decoded once and compared many times. */
export type ImageInput = Uint8Array | RawImage;

const INPUT = { failOn: 'error', limitInputPixels: 50_000_000 } as const;
const WINDOW = 8;
const STRIDE = 4;
const C1 = (0.01 * 255) ** 2;
const C2 = (0.03 * 255) ** 2;

const isRaw = (input: ImageInput): input is RawImage => !(input instanceof Uint8Array);

/** The image, upright: an encoded file is turned by its orientation; raw pixels already are. */
function open(input: ImageInput): Sharp {
  if (!isRaw(input)) return sharp(input, INPUT).rotate();
  return sharp(input.data, { raw: { width: input.width, height: input.height, channels: input.channels } });
}

async function hasAlpha(input: ImageInput): Promise<boolean> {
  if (isRaw(input)) return input.channels === 2 || input.channels === 4;
  return (await sharp(input, INPUT).metadata()).hasAlpha;
}

/** One window's SSIM from its five sums over `n` pixels. */
function windowScore(n: number, sumA: number, sumB: number, sumAA: number, sumBB: number, sumAB: number): number {
  const meanA = sumA / n;
  const meanB = sumB / n;
  const varA = sumAA / n - meanA * meanA;
  const varB = sumBB / n - meanB * meanB;
  const cov = sumAB / n - meanA * meanB;
  return ((2 * meanA * meanB + C1) * (2 * cov + C2)) / ((meanA * meanA + meanB * meanB + C1) * (varA + varB + C2));
}

/** Sums of `plane` over its 4 × 4 blocks, row by row; pixels past the last whole block are left out. */
function blockSums(plane: Plane, columns: number, rows: number): Float64Array {
  const sums = new Float64Array(columns * rows);
  for (let y = 0; y < rows * STRIDE; y++) {
    const row = y * plane.width;
    const blockRow = Math.floor(y / STRIDE) * columns;
    for (let x = 0; x < columns * STRIDE; x++) sums[blockRow + Math.floor(x / STRIDE)] += plane.data[row + x]!;
  }
  return sums;
}

/**
 * Mean SSIM over 8 × 8 windows, 4 pixels apart. The windows are made of 2 × 2 blocks of 4 × 4 pixels, so each block's
 * sums are taken once (a 12 MP comparison is one pass over the pixels, not four). A plane smaller than one window is
 * compared as a single window of its own size. With `visibility` (the two images' alpha), a window that is fully
 * transparent in both is left out; when nothing is visible at all, the planes are alike.
 */
export function ssim(a: Plane, b: Plane, visibility?: { a: Plane; b: Plane }): number {
  if (a.width !== b.width || a.height !== b.height || a.data.length !== b.data.length) {
    throw new Error('ssim compares planes of the same size');
  }
  const { width, height } = a;
  if (width < WINDOW || height < WINDOW) {
    if (visibility && visibility.a.data.every((v) => v === 0) && visibility.b.data.every((v) => v === 0)) return 1;
    let [sumA, sumB, sumAA, sumBB, sumAB] = [0, 0, 0, 0, 0];
    for (let i = 0; i < a.data.length; i++) {
      const va = a.data[i]!;
      const vb = b.data[i]!;
      sumA += va;
      sumB += vb;
      sumAA += va * va;
      sumBB += vb * vb;
      sumAB += va * vb;
    }
    return a.data.length === 0 ? 1 : windowScore(a.data.length, sumA, sumB, sumAA, sumBB, sumAB);
  }

  const columns = Math.floor(width / STRIDE);
  const rows = Math.floor(height / STRIDE);
  const blocks = columns * rows;
  const blockA = new Float64Array(blocks);
  const blockB = new Float64Array(blocks);
  const blockAA = new Float64Array(blocks);
  const blockBB = new Float64Array(blocks);
  const blockAB = new Float64Array(blocks);
  for (let y = 0; y < rows * STRIDE; y++) {
    const row = y * width;
    const blockRow = Math.floor(y / STRIDE) * columns;
    for (let x = 0; x < columns * STRIDE; x++) {
      const va = a.data[row + x]!;
      const vb = b.data[row + x]!;
      const block = blockRow + Math.floor(x / STRIDE);
      blockA[block] += va;
      blockB[block] += vb;
      blockAA[block] += va * va;
      blockBB[block] += vb * vb;
      blockAB[block] += va * vb;
    }
  }
  const seenA = visibility ? blockSums(visibility.a, columns, rows) : null;
  const seenB = visibility ? blockSums(visibility.b, columns, rows) : null;

  const n = WINDOW * WINDOW;
  let total = 0;
  let windows = 0;
  for (let by = 0; by + 1 < rows; by++) {
    for (let bx = 0; bx + 1 < columns; bx++) {
      const c0 = by * columns + bx;
      const c1 = c0 + 1;
      const c2 = c0 + columns;
      const c3 = c2 + 1;
      const sum = (values: Float64Array) => values[c0]! + values[c1]! + values[c2]! + values[c3]!;
      if (seenA && seenB && sum(seenA) === 0 && sum(seenB) === 0) continue;
      total += windowScore(n, sum(blockA), sum(blockB), sum(blockAA), sum(blockBB), sum(blockAB));
      windows++;
    }
  }
  return windows === 0 ? 1 : total / windows;
}

/** An image's planes: its luminance, and for one with alpha, its luminance over white and its alpha. */
export interface Planes {
  /** Over black when the image has alpha (premultiplied), else as it is. */
  luma: Plane;
  overWhite: Plane | null;
  alpha: Plane | null;
}

/**
 * An image's planes, upright and resized to `width` × `height` (when `height` is left out, to `width` with the image's
 * own proportions).
 */
export async function planesOf(image: ImageInput, width: number, height?: number): Promise<Planes> {
  // `fill` stretches to exactly the size given, so it is only for a given height; a width alone keeps the proportions.
  const base = open(image).resize(height === undefined ? { width } : { width, height, fit: 'fill' });
  const plane = async (pipeline: Sharp): Promise<Plane> => {
    const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
    return { data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), width: info.width, height: info.height };
  };
  if (!(await hasAlpha(image))) return { luma: await plane(base.clone().removeAlpha().greyscale()), overWhite: null, alpha: null };
  const [luma, overWhite, alpha] = await Promise.all([
    plane(base.clone().flatten({ background: '#000000' }).greyscale()),
    plane(base.clone().flatten({ background: '#ffffff' }).greyscale()),
    plane(base.clone().extractChannel('alpha')),
  ]);
  return { luma, overWhite, alpha };
}

/** An opaque plane: what a candidate without transparency is compared with where the source has some. */
function opaque(like: Plane): Plane {
  return { data: new Uint8Array(like.data.length).fill(255), width: like.width, height: like.height };
}

/** A source's planes at one width, read once and compared with many candidates. */
export type Reference = Planes;

/** `source` seen at `width` pixels wide (its own proportions), ready for `similarityTo`. */
export function referenceOf(source: ImageInput, width: number): Promise<Reference> {
  return planesOf(source, width);
}

/** How alike `candidate` looks to the reference, seen at the reference's size. */
export async function similarityTo(reference: Reference, candidate: ImageInput): Promise<number> {
  const to = await planesOf(candidate, reference.luma.width, reference.luma.height);
  if (!reference.alpha || !reference.overWhite) return ssim(reference.luma, to.luma);
  const alpha = to.alpha ?? opaque(reference.alpha);
  const visibility = { a: reference.alpha, b: alpha };
  return Math.min(
    ssim(reference.luma, to.luma, visibility),
    ssim(reference.overWhite, to.overWhite ?? to.luma, visibility),
    ssim(reference.alpha, alpha, visibility),
  );
}

/** How alike `candidate` looks to `source`, both seen at `width` pixels wide (the source's proportions). */
export async function similarity(source: ImageInput, candidate: ImageInput, width: number): Promise<number> {
  return similarityTo(await referenceOf(source, width), candidate);
}
