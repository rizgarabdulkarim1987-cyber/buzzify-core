import sharp from 'sharp';

/**
 * How alike two renditions of one picture look, for choosing how hard to compress it (spec: smart image compression).
 * The score is the mean SSIM of their luminance, and of their transparency when the source has any; 1 is identical.
 * Colour is left to the encoders, which keep it far better than detail.
 */

/** One channel of an image, a byte per pixel, row by row. */
export interface Plane {
  data: Uint8Array;
  width: number;
  height: number;
}

const INPUT = { failOn: 'error', limitInputPixels: 50_000_000 } as const;
const WINDOW = 8;
const STRIDE = 4;
const C1 = (0.01 * 255) ** 2;
const C2 = (0.03 * 255) ** 2;

/** One window's SSIM from its five sums over `n` pixels. */
function windowScore(n: number, sumA: number, sumB: number, sumAA: number, sumBB: number, sumAB: number): number {
  const meanA = sumA / n;
  const meanB = sumB / n;
  const varA = sumAA / n - meanA * meanA;
  const varB = sumBB / n - meanB * meanB;
  const cov = sumAB / n - meanA * meanB;
  return ((2 * meanA * meanB + C1) * (2 * cov + C2)) / ((meanA * meanA + meanB * meanB + C1) * (varA + varB + C2));
}

/**
 * Mean SSIM over 8 × 8 windows, 4 pixels apart. The windows are made of 2 × 2 blocks of 4 × 4 pixels, so each block's
 * sums are taken once (a 12 MP comparison is one pass over the pixels, not four). A plane smaller than one window is
 * compared as a single window of its own size.
 */
export function ssim(a: Plane, b: Plane): number {
  if (a.width !== b.width || a.height !== b.height || a.data.length !== b.data.length) {
    throw new Error('ssim compares planes of the same size');
  }
  const { width, height } = a;
  if (width < WINDOW || height < WINDOW) {
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
  const sums = [0, 1, 2, 3, 4].map(() => new Float64Array(blocks)) as [Float64Array, Float64Array, Float64Array, Float64Array, Float64Array];
  const [blockA, blockB, blockAA, blockBB, blockAB] = sums;
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

  const n = WINDOW * WINDOW;
  let total = 0;
  let windows = 0;
  for (let by = 0; by + 1 < rows; by++) {
    for (let bx = 0; bx + 1 < columns; bx++) {
      const corners = [by * columns + bx, by * columns + bx + 1, (by + 1) * columns + bx, (by + 1) * columns + bx + 1];
      const sum = (values: Float64Array) => values[corners[0]!]! + values[corners[1]!]! + values[corners[2]!]! + values[corners[3]!]!;
      total += windowScore(n, sum(blockA), sum(blockB), sum(blockAA), sum(blockBB), sum(blockAB));
      windows++;
    }
  }
  return windows === 0 ? 1 : total / windows;
}

/**
 * An image's luminance plane and, when it has transparency, its alpha plane: upright, and resized to `width` × `height`
 * (when `height` is left out, to `width` with the image's own proportions).
 */
export async function planesOf(image: Uint8Array | Buffer, width: number, height?: number): Promise<{ luma: Plane; alpha: Plane | null }> {
  // `fill` stretches to exactly the size given, so it is only for a given height; a width alone keeps the proportions.
  const base = sharp(image, INPUT)
    .rotate()
    .resize(height === undefined ? { width } : { width, height, fit: 'fill' });
  const meta = await sharp(image, INPUT).metadata();
  const luma = await base.clone().removeAlpha().greyscale().raw().toBuffer({ resolveWithObject: true });
  const plane = (data: Buffer, info: { width: number; height: number }): Plane => ({
    data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    width: info.width,
    height: info.height,
  });
  const alpha = meta.hasAlpha ? await base.clone().extractChannel('alpha').raw().toBuffer({ resolveWithObject: true }) : null;
  return { luma: plane(luma.data, luma.info), alpha: alpha ? plane(alpha.data, alpha.info) : null };
}

/** An opaque plane: what a candidate without transparency is compared with where the source has some. */
function opaque(like: Plane): Plane {
  return { data: new Uint8Array(like.data.length).fill(255), width: like.width, height: like.height };
}

/** A source's planes at one width, read once and compared with many candidates. */
export type Reference = Awaited<ReturnType<typeof planesOf>>;

/** `source` seen at `width` pixels wide (its own proportions), ready for `similarityTo`. */
export function referenceOf(source: Uint8Array | Buffer, width: number): Promise<Reference> {
  return planesOf(source, width);
}

/**
 * How alike `candidate` looks to the reference: the lower of the luminance score and, when the source has transparency,
 * the alpha score. The candidate is seen at the reference's size.
 */
export async function similarityTo(reference: Reference, candidate: Uint8Array | Buffer): Promise<number> {
  const to = await planesOf(candidate, reference.luma.width, reference.luma.height);
  const luma = ssim(reference.luma, to.luma);
  if (!reference.alpha) return luma;
  return Math.min(luma, ssim(reference.alpha, to.alpha ?? opaque(reference.alpha)));
}

/** How alike `candidate` looks to `source`, both seen at `width` pixels wide (the source's proportions). */
export async function similarity(source: Uint8Array | Buffer, candidate: Uint8Array | Buffer, width: number): Promise<number> {
  return similarityTo(await referenceOf(source, width), candidate);
}
