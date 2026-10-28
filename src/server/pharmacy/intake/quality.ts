import sharp from 'sharp';
import { qualityDecision, type QualityMetrics, type QualityReason } from '@/server/domain/pharmacy/intake';

/**
 * The pixel metrics of an uploaded invoice photo (R5-6), measured BEFORE any AI call. The image is turned upright by its
 * EXIF orientation, reduced to grey and, if its long edge is over 1568 px, shrunk to that: the size the model reads at, so a
 * photo is judged by what the model will see, and one already smaller is not enlarged. Sharpness is a per-tile score (see
 * `QUALITY_LIMITS`, which holds the measured table). The decision is the pure `qualityDecision`.
 */

/** The long edge the model reads an image at; a larger photo is shrunk to it, a smaller one is left alone. */
const MODEL_LONG_EDGE_PX = 1568;
/** A decompression bomb guard: more pixels than this is refused as unreadable. */
const MAX_INPUT_PIXELS = 50_000_000;
/** Side of a sharpness tile. */
const TILE_PX = 64;
/** A tile whose grey level spread (standard deviation) is below this holds no ink and is ignored. */
const FLAT_TILE_STD = 12;

export class ImageUnreadableError extends Error {
  readonly code = 'IMAGE_UNREADABLE';
  constructor() {
    super('The image could not be read');
    this.name = 'ImageUnreadableError';
  }
}

/**
 * The median, over the tiles that hold ink, of the tile's Laplacian variance divided by its grey-level variance. 0 when no tile
 * holds ink (a blank or smeared page has nothing sharp to read).
 */
function tileSharpness(grey: Uint8Array, width: number, height: number): number {
  const scores: number[] = [];
  for (let top = 0; top + TILE_PX <= height; top += TILE_PX) {
    for (let left = 0; left + TILE_PX <= width; left += TILE_PX) {
      let sum = 0;
      let sumSquares = 0;
      let lapSum = 0;
      let lapSquares = 0;
      let lapCount = 0;
      for (let y = top; y < top + TILE_PX; y += 1) {
        const row = y * width;
        for (let x = left; x < left + TILE_PX; x += 1) {
          const i = row + x;
          const v = grey[i]!;
          sum += v;
          sumSquares += v * v;
          if (y > 0 && y < height - 1 && x > 0 && x < width - 1) {
            const lap = grey[i - width]! + grey[i + width]! + grey[i - 1]! + grey[i + 1]! - 4 * v;
            lapSum += lap;
            lapSquares += lap * lap;
            lapCount += 1;
          }
        }
      }
      const n = TILE_PX * TILE_PX;
      const mean = sum / n;
      const variance = Math.max(0, sumSquares / n - mean * mean);
      if (Math.sqrt(variance) < FLAT_TILE_STD || lapCount === 0) continue;
      const lapMean = lapSum / lapCount;
      scores.push((lapSquares / lapCount - lapMean * lapMean) / variance);
    }
  }
  if (scores.length === 0) return 0;
  scores.sort((a, b) => a - b);
  const mid = scores.length >> 1;
  return scores.length % 2 === 1 ? scores[mid]! : (scores[mid - 1]! + scores[mid]!) / 2;
}

/** Width, height (as displayed, after EXIF rotation), sharpness, mean grey level and contrast (standard deviation). */
export async function imageQualityMetrics(bytes: Uint8Array): Promise<QualityMetrics> {
  try {
    const input = sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS });
    const meta = await input.metadata();
    if (!meta.width || !meta.height) throw new ImageUnreadableError();
    const turned = (meta.orientation ?? 1) >= 5;
    const width = turned ? meta.height : meta.width;
    const height = turned ? meta.width : meta.height;
    const { data, info } = await input
      .rotate()
      .greyscale()
      .resize(MODEL_LONG_EDGE_PX, MODEL_LONG_EDGE_PX, { fit: 'inside', withoutEnlargement: true })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const pixels = info.width * info.height;
    let sum = 0;
    let sumSquares = 0;
    for (let i = 0; i < pixels; i += 1) {
      const v = data[i]!;
      sum += v;
      sumSquares += v * v;
    }
    const meanLuma = sum / pixels;
    return {
      width,
      height,
      sharpness: tileSharpness(data, info.width, info.height),
      meanLuma,
      contrast: Math.sqrt(Math.max(0, sumSquares / pixels - meanLuma * meanLuma)),
    };
  } catch (error) {
    if (error instanceof ImageUnreadableError) throw error;
    throw new ImageUnreadableError();
  }
}

export interface QualityAssessment {
  ok: boolean;
  reasons: QualityReason[];
  /** The numbers behind the decision; null for a PDF (no pixel metrics). */
  metrics: QualityMetrics | null;
}

/** The gate: metrics for an image, then the decision. A PDF skips it. An image that cannot be decoded throws `ImageUnreadableError`. */
export async function assessQuality(bytes: Uint8Array, mediaType: string): Promise<QualityAssessment> {
  if (mediaType === 'application/pdf') return { ok: true, reasons: [], metrics: null };
  const metrics = await imageQualityMetrics(bytes);
  return { ...qualityDecision(metrics, mediaType), metrics };
}
