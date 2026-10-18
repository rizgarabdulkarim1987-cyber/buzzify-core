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

/** Mean SSIM over 8 × 8 windows, 4 pixels apart. */
export function ssim(a: Plane, b: Plane): number {
  if (a.width !== b.width || a.height !== b.height || a.data.length !== b.data.length) {
    throw new Error('ssim compares planes of the same size');
  }
  const { width, height } = a;
  // A plane smaller than one window is compared as a single window of its own size.
  const winX = Math.min(WINDOW, width);
  const winY = Math.min(WINDOW, height);
  const n = winX * winY;
  let total = 0;
  let windows = 0;
  for (let top = 0; top + winY <= height; top += STRIDE) {
    for (let left = 0; left + winX <= width; left += STRIDE) {
      let sumA = 0;
      let sumB = 0;
      let sumAA = 0;
      let sumBB = 0;
      let sumAB = 0;
      for (let y = top; y < top + winY; y++) {
        const row = y * width;
        for (let x = left; x < left + winX; x++) {
          const va = a.data[row + x]!;
          const vb = b.data[row + x]!;
          sumA += va;
          sumB += vb;
          sumAA += va * va;
          sumBB += vb * vb;
          sumAB += va * vb;
        }
      }
      const meanA = sumA / n;
      const meanB = sumB / n;
      const varA = sumAA / n - meanA * meanA;
      const varB = sumBB / n - meanB * meanB;
      const cov = sumAB / n - meanA * meanB;
      total += ((2 * meanA * meanB + C1) * (2 * cov + C2)) / ((meanA * meanA + meanB * meanB + C1) * (varA + varB + C2));
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

/**
 * How alike `candidate` looks to `source`, both seen at `width` pixels wide (the source's proportions): the lower of the
 * luminance score and, when the source has transparency, the alpha score.
 */
export async function similarity(source: Uint8Array | Buffer, candidate: Uint8Array | Buffer, width: number): Promise<number> {
  const from = await planesOf(source, width);
  const to = await planesOf(candidate, from.luma.width, from.luma.height);
  const luma = ssim(from.luma, to.luma);
  if (!from.alpha) return luma;
  return Math.min(luma, ssim(from.alpha, to.alpha ?? opaque(from.alpha)));
}
